#!/usr/bin/env python3
import json
import pathlib
import plistlib
import re
import sys


root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()


def fail(message):
    print(f"iOS release source validation failed: {message}", file=sys.stderr)
    raise SystemExit(1)


def require(condition, message):
    if not condition:
        fail(message)


def load_plist(relative_path):
    path = root / relative_path
    require(path.is_file() and path.stat().st_size > 0, f"missing {relative_path}")
    try:
        with path.open("rb") as plist_file:
            return plistlib.load(plist_file)
    except (OSError, plistlib.InvalidFileException) as error:
        fail(f"invalid {relative_path}: {error}")


info = load_plist("ios/App/App/Info.plist")
load_plist("ios/App/App/GoogleService-Info.plist")
entitlements = load_plist("ios/App/App/App.entitlements")
location_keys = sorted(key for key in info if key.startswith("NSLocation"))
require(not location_keys, f"unused location permission keys found: {location_keys}")
require(info.get("ITSAppUsesNonExemptEncryption") is False,
        "ITSAppUsesNonExemptEncryption must be Boolean false")
for permission_key in (
    "NSCameraUsageDescription",
    "NSPhotoLibraryUsageDescription",
    "NSPhotoLibraryAddUsageDescription",
    "NSMicrophoneUsageDescription",
):
    require(str(info.get(permission_key, "")).strip(), f"{permission_key} is missing")
expected_usage_descriptions = {
    "NSCameraUsageDescription": "회원의 체형 사진을 촬영하고 측정 결과 코드를 읽기 위해 카메라를 사용합니다.",
    "NSMicrophoneUsageDescription": "수업 직후 음성으로 기록을 남기기 위해 마이크를 사용합니다",
}
for permission_key, expected in expected_usage_descriptions.items():
    actual = str(info.get(permission_key, "")).strip()
    require(actual == expected,
            f"{permission_key} is {actual!r}, expected {expected!r}")
    print(f"{permission_key}: {actual}")
require("Default" in (entitlements.get("com.apple.developer.applesignin") or []),
        "Sign in with Apple entitlement is missing")

project = (root / "ios/App/App.xcodeproj/project.pbxproj").read_text(encoding="utf-8")
require("GoogleService-Info.plist in Resources" in project,
        "GoogleService-Info.plist is not in Copy Bundle Resources")
require("CODE_SIGN_ENTITLEMENTS = App/App.entitlements" in project,
        "App.entitlements is not assigned to the target")
require("com.apple.SignInWithApple" in project,
        "Sign in with Apple capability is missing")

app_delegate = (root / "ios/App/App/AppDelegate.swift").read_text(encoding="utf-8")
app_delegate_code = re.sub(r"//.*", "", app_delegate)
launch_signature = "didFinishLaunchingWithOptions launchOptions"
launch_start = app_delegate_code.find(launch_signature)
launch_return = app_delegate_code.find("return true", launch_start)
launch_configure = app_delegate_code.find("configureFirebaseSafely()", launch_start)
require(launch_start >= 0, "didFinishLaunchingWithOptions was not found")
require(launch_start < launch_configure < launch_return,
        "configureFirebaseSafely() is not called before launch returns")
require("guard FirebaseApp.app() == nil else { return }" in app_delegate_code,
        "FirebaseApp nil guard is missing")
require("FirebaseOptions(contentsOfFile: path)" in app_delegate_code,
        "bundle Firebase plist is not loaded explicitly")
require(not re.search(r"FirebaseApp\.configure\s*\(\s*\)", app_delegate_code),
        "AppDelegate contains parameterless FirebaseApp.configure()")

auth_plugin = (
    root / "node_modules/@capacitor-firebase/authentication/ios/Plugin/FirebaseAuthentication.swift"
).read_text(encoding="utf-8")
plugin_guard = auth_plugin.find("if FirebaseApp.app() == nil")
plugin_configure = auth_plugin.find("FirebaseApp.configure()", plugin_guard)
require(plugin_guard >= 0 and plugin_configure > plugin_guard,
        "Firebase Authentication plugin initialization guard changed")

storyboard = (root / "ios/App/App/Base.lproj/Main.storyboard").read_text(encoding="utf-8")
require('customClass="PilaTeacherBridgeViewController"' in storyboard,
        "PilaTeacher Capacitor bridge controller is not configured")
require("class PilaTeacherBridgeViewController: CAPBridgeViewController" in app_delegate,
        "PilaTeacher bridge controller no longer inherits CAPBridgeViewController")

package_json = json.loads((root / "package.json").read_text(encoding="utf-8"))
require(package_json.get("dependencies", {}).get("@capgo/camera-preview") == "8.11.2",
        "camera preview version changed; review the no-location patch")
postinstall = package_json.get("scripts", {}).get("postinstall", "")
require("node tools/patch-camera-preview-ios-no-location.mjs" in postinstall,
        "camera preview no-location postinstall is missing")
require("node tools/patch-camera-preview-ios-session-safety.mjs" in postinstall,
        "camera preview session-safety postinstall is missing")
require("node tools/patch-firebase-auth-ios-first-login-profile.mjs" in postinstall,
        "Firebase Authentication first-login profile postinstall is missing")
require("node tools/patch-audio-recorder-h5.mjs" in postinstall,
        "audio recorder H-5 postinstall is missing")
require(postinstall.index("patch-camera-preview-ios-session-safety.mjs") >
        postinstall.index("patch-camera-preview-ios-no-location.mjs"),
        "camera preview session-safety patch does not run after its base patch")
require(postinstall.index("patch-audio-recorder-h5.mjs") >
        postinstall.index("patch-audio-recorder-h4.mjs"),
        "audio recorder H-5 patch does not run after its H-4 prerequisite")

capacitor_config = json.loads((root / "capacitor.config.json").read_text(encoding="utf-8"))
auth_providers = capacitor_config.get("plugins", {}).get("FirebaseAuthentication", {}).get("providers", [])
require("apple.com" in auth_providers, "Firebase Authentication Apple provider is missing")
synced_capacitor_config = json.loads((root / "ios/App/App/capacitor.config.json").read_text(encoding="utf-8"))
synced_auth_providers = synced_capacitor_config.get("plugins", {}).get("FirebaseAuthentication", {}).get("providers", [])
require("apple.com" in synced_auth_providers, "synced iOS Firebase Authentication Apple provider is missing")
auth_helper = (
    root / "node_modules/@capacitor-firebase/authentication/ios/Plugin/FirebaseAuthenticationHelper.swift"
).read_text(encoding="utf-8")
require('result["firstTimeDisplayName"] = displayName' in auth_helper,
        "Firebase Authentication first-login display name patch is missing")

camera_sources = root / "node_modules/@capgo/camera-preview/ios/Sources"
forbidden_location_tokens = (
    "import CoreLocation",
    "CLLocationManager",
    "CLLocation",
    "CLHeading",
    "requestWhenInUseAuthorization",
    "requestAlwaysAuthorization",
    "startUpdatingLocation",
    "NSLocationWhenInUseUsageDescription",
    "NSLocationAlwaysUsageDescription",
    "NSLocationAlwaysAndWhenInUseUsageDescription",
)
for swift_file in camera_sources.rglob("*.swift"):
    source = swift_file.read_text(encoding="utf-8")
    found = [token for token in forbidden_location_tokens if token in source]
    require(not found, f"{swift_file.relative_to(root)} still contains {found}")

audio_recorder = (
    root / "node_modules/@capgo/capacitor-audio-recorder/ios/Sources/CapacitorAudioRecorderPlugin/CapacitorAudioRecorderPlugin.swift"
).read_text(encoding="utf-8")
require("PILATEACHER_H5_SESSION_PER_START" in audio_recorder,
        "audio recorder H-5 patch is not installed")
require("configureAndActivateAudioSession()" in audio_recorder,
        "audio session is not configured immediately before recording")
require("AVSampleRateKey: 44_100.0" in audio_recorder and
        "AVNumberOfChannelsKey: 1" in audio_recorder and
        "kAudioFormatMPEG4AAC" in audio_recorder,
        "audio recorder safe m4a settings are missing")
require("configureCategoryOnce" not in audio_recorder and
        "categoryConfigured" not in audio_recorder,
        "load-time audio category configuration remains installed")

camera_controller = (
    camera_sources / "CapgoCameraPreviewPlugin/CameraController.swift"
).read_text(encoding="utf-8")
camera_plugin = (
    camera_sources / "CapgoCameraPreviewPlugin/Plugin.swift"
).read_text(encoding="utf-8")
require("PILATEACHER_H5_CAMERA_SESSION_SAFETY" in camera_controller and
        "PILATEACHER_H5_CAMERA_SESSION_SAFETY" in camera_plugin,
        "camera preview H-5 session-safety patch is not installed")
require("requestPilaTeacherSafeCleanup" in camera_controller and
        "restorePilaTeacherAudioSessionAfterCamera" in camera_plugin,
        "camera teardown or audio-session restoration is missing")

require(not (root / "ios/App/App/cert_key.pem").exists(),
        "cert_key.pem must not be bundled")
print("Firebase launch order: validated")
print("Firebase duplicate initialization guards: validated")
print("Camera preview iOS location APIs: absent after deterministic patch")
print("Audio recorder H-5 per-start session: validated")
print("Camera preview H-5 teardown and audio isolation: validated")
print("Info.plist location permission keys: absent")
print("ITSAppUsesNonExemptEncryption: Boolean false")
