#!/usr/bin/env python3
import datetime
import json
import os
import pathlib
import plistlib
import re
import subprocess
import sys
import tempfile
import zipfile


root = pathlib.Path(os.environ["CM_BUILD_DIR"]).resolve()
expected_bundle_id = "com.pilateacher.app"
expected_build = os.environ["BUILD_NUMBER"]
expected_version = os.environ["VITE_APP_VERSION"]
expected_usage_descriptions = {
    "NSCameraUsageDescription": "회원의 체형 사진을 촬영하고 측정 결과 코드를 읽기 위해 카메라를 사용합니다.",
    "NSMicrophoneUsageDescription": "수업 직후 음성으로 기록을 남기기 위해 마이크를 사용합니다",
}


def fail(message):
    print(f"Release artifact validation failed: {message}", file=sys.stderr)
    raise SystemExit(1)


def load_plist(path):
    if not path.is_file() or path.stat().st_size == 0:
        fail(f"required plist is missing or empty: {path}")
    try:
        with path.open("rb") as plist_file:
            return plistlib.load(plist_file)
    except (OSError, plistlib.InvalidFileException) as error:
        fail(f"invalid plist {path}: {error}")


def validate_google_plist(path, label):
    data = load_plist(path)
    for key in ("GOOGLE_APP_ID", "CLIENT_ID", "REVERSED_CLIENT_ID", "PROJECT_ID"):
        if not str(data.get(key, "")).strip():
            fail(f"{label} GoogleService-Info.plist is missing {key}")
        print(f"{label} {key}: present")
    if data.get("BUNDLE_ID") != expected_bundle_id:
        fail(f"{label} GoogleService-Info.plist BUNDLE_ID mismatch")
    print(f"{label} BUNDLE_ID: matches {expected_bundle_id}")


def validate_app_info(path, label):
    info = load_plist(path)
    for key, expected in {
        "CFBundleIdentifier": expected_bundle_id,
        "CFBundleShortVersionString": expected_version,
        "CFBundleVersion": expected_build,
    }.items():
        actual = str(info.get(key, ""))
        if actual != expected:
            fail(f"{label} {key} is {actual!r}, expected {expected!r}")
    location_keys = sorted(key for key in info if key.startswith("NSLocation"))
    if location_keys:
        fail(f"{label} contains unused location permission keys: {location_keys}")
    if info.get("ITSAppUsesNonExemptEncryption") is not False:
        fail(f"{label} ITSAppUsesNonExemptEncryption is not Boolean false")
    for key, expected in expected_usage_descriptions.items():
        actual = str(info.get(key, "")).strip()
        if actual != expected:
            fail(f"{label} {key} is {actual!r}, expected {expected!r}")
        print(f"{label} {key}: {actual}")
    executable = str(info.get("CFBundleExecutable", "")).strip()
    if not executable:
        fail(f"{label} CFBundleExecutable is empty")
    print(f"{label} location permission keys: absent")
    print(f"{label} ITSAppUsesNonExemptEncryption: Boolean false")
    return executable


def command_output(command, path):
    try:
        return subprocess.check_output(
            [*command, str(path)], text=True, stderr=subprocess.STDOUT
        )
    except (OSError, subprocess.CalledProcessError) as error:
        fail(f"{' '.join(command)} failed for {path.name}: {error}")


def binary_uuids(path):
    output = command_output(["xcrun", "dwarfdump", "--uuid"], path)
    matches = re.findall(r"UUID:\s*([0-9A-Fa-f-]+)\s*\(([^)]+)\)", output)
    if not matches:
        fail(f"no Mach-O UUID found for {path}")
    return {architecture: uuid.upper() for uuid, architecture in matches}


def app_owned_binaries(app_path, executable):
    binaries = [app_path / executable]
    frameworks = app_path / "Frameworks"
    if frameworks.is_dir():
        for framework in sorted(frameworks.glob("*.framework")):
            framework_info = load_plist(framework / "Info.plist")
            framework_executable = framework_info.get("CFBundleExecutable")
            if framework_executable:
                binaries.append(framework / framework_executable)
        binaries.extend(sorted(frameworks.glob("*.dylib")))
    return binaries


def validate_no_location_symbols(app_path, executable, label):
    forbidden = (
        "CoreLocation.framework",
        "CLLocationManager",
        "requestWhenInUseAuthorization",
        "requestAlwaysAuthorization",
        "startUpdatingLocation",
        "NSLocationWhenInUseUsageDescription",
        "NSLocationAlwaysUsageDescription",
        "NSLocationAlwaysAndWhenInUseUsageDescription",
    )
    binaries = app_owned_binaries(app_path, executable)
    print(f"{label} app-owned binaries ({len(binaries)}):")
    for binary in binaries:
        if not binary.is_file() or binary.stat().st_size == 0:
            fail(f"missing app-owned binary: {binary}")
        print(f"- {binary.relative_to(app_path)}")
        inspection = "\n".join((
            command_output(["otool", "-L"], binary),
            command_output(["nm", "-u"], binary),
            command_output(["strings"], binary),
        ))
        found = [token for token in forbidden if token in inspection]
        if found:
            fail(f"{label} binary {binary.name} contains location references: {found}")
    print(f"{label} location framework/API references: not detected")


ipa_candidates = sorted((root / "build/ios/ipa").glob("*.ipa"))
if len(ipa_candidates) != 1:
    fail(f"expected exactly one IPA, found {len(ipa_candidates)}")
ipa_path = ipa_candidates[0]

archive_candidates = []
for archive_root in (root / "build", pathlib.Path.home() / "Library/Developer/Xcode/Archives"):
    if archive_root.exists():
        archive_candidates.extend(archive_root.rglob("*.xcarchive"))
archive_candidates = list({path.resolve(): path for path in archive_candidates}.values())
matching_archives = []
for archive_path in archive_candidates:
    for app_path in (archive_path / "Products/Applications").glob("*.app"):
        try:
            info = load_plist(app_path / "Info.plist")
        except SystemExit:
            continue
        if (info.get("CFBundleIdentifier") == expected_bundle_id and
                str(info.get("CFBundleVersion", "")) == expected_build):
            matching_archives.append((archive_path, app_path))
if not matching_archives:
    fail("no xcarchive matches the expected bundle ID and build number")
matching_archives.sort(key=lambda item: item[0].stat().st_mtime)
archive_path, archive_app = matching_archives[-1]

archive_executable = validate_app_info(archive_app / "Info.plist", "Archive")
validate_google_plist(archive_app / "GoogleService-Info.plist", "Archive")
validate_no_location_symbols(archive_app, archive_executable, "Archive")
archive_binary = archive_app / archive_executable
archive_uuids = binary_uuids(archive_binary)

dsym_path = archive_path / "dSYMs" / f"{archive_app.name}.dSYM"
dsym_binary = dsym_path / "Contents/Resources/DWARF" / archive_executable
dsym_uuids = binary_uuids(dsym_binary)

with tempfile.TemporaryDirectory(prefix="pilateacher-ipa-") as temp_directory:
    temp_path = pathlib.Path(temp_directory)
    with zipfile.ZipFile(ipa_path) as ipa_zip:
        ipa_zip.extractall(temp_path)
    ipa_apps = list((temp_path / "Payload").glob("*.app"))
    if len(ipa_apps) != 1:
        fail(f"expected one Payload app, found {len(ipa_apps)}")
    ipa_app = ipa_apps[0]
    ipa_executable = validate_app_info(ipa_app / "Info.plist", "IPA")
    validate_google_plist(ipa_app / "GoogleService-Info.plist", "IPA")
    validate_no_location_symbols(ipa_app, ipa_executable, "IPA")
    ipa_uuids = binary_uuids(ipa_app / ipa_executable)

if ipa_uuids != archive_uuids:
    fail(f"IPA UUIDs {ipa_uuids!r} do not match archive UUIDs {archive_uuids!r}")
if ipa_uuids != dsym_uuids:
    fail(f"App UUIDs {ipa_uuids!r} do not match dSYM UUIDs {dsym_uuids!r}")
for architecture in sorted(ipa_uuids):
    print(f"App UUID ({architecture}): {ipa_uuids[architecture]}")
    print(f"dSYM UUID ({architecture}): {dsym_uuids[architecture]}")

metadata_directory = root / "build/ios/metadata"
metadata_directory.mkdir(parents=True, exist_ok=True)
build_info = {
    "commitSha": os.environ["VITE_BUILD_COMMIT"],
    "branch": os.environ["VITE_BUILD_BRANCH"],
    "buildNumber": expected_build,
    "version": expected_version,
    "bundleId": expected_bundle_id,
    "appUuid": ipa_uuids,
    "dSymUuid": dsym_uuids,
    "buildDate": datetime.datetime.now(datetime.timezone.utc).isoformat(),
}
(metadata_directory / "build-info.json").write_text(
    json.dumps(build_info, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
)
(metadata_directory / "archive-path.txt").write_text(str(archive_path), encoding="utf-8")
print(f"Validated IPA: {ipa_path}")
print(f"Validated archive: {archive_path}")
print(f"Build information: {metadata_directory / 'build-info.json'}")
