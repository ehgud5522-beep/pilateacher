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
    "NSSpeechRecognitionUsageDescription",
):
    require(str(info.get(permission_key, "")).strip(), f"{permission_key} is missing")
require("Default" in (entitlements.get("com.apple.developer.applesignin") or []),
        "Sign in with Apple entitlement is missing")

project = (root / "ios/App/App.xcodeproj/project.pbxproj").read_text(encoding="utf-8")
require("GoogleService-Info.plist in Resources" in project,
        "GoogleService-Info.plist is not in Copy Bundle Resources")
require("CODE_SIGN_ENTITLEMENTS = App/App.entitlements" in project,
        "App.entitlements is not assigned to the target")
require("com.apple.SignInWithApple" in project,
        "Sign in with Apple capability is missing")
require("CapApp-SPM" not in project,
        "the App target still references CapApp-SPM; use the CocoaPods workspace")

podfile_path = root / "ios/App/Podfile"
require(podfile_path.is_file(), "ios/App/Podfile is missing")
podfile = podfile_path.read_text(encoding="utf-8")
for pod_name in (
    "Capacitor",
    "CapacitorCordova",
    "CapacitorCommunitySpeechRecognition",
    "CapacitorFirebaseAuthentication",
    "CapgoCameraPreview",
):
    require(re.search(rf"pod\s+['\"]{re.escape(pod_name)}['\"]", podfile),
            f"{pod_name} is missing from the Podfile")
require(not (root / "ios/App/CapApp-SPM").exists(),
        "obsolete CapApp-SPM directory is still present")

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
require('customClass="CAPBridgeViewController"' in storyboard,
        "standard Capacitor bridge controller is not configured")

package_json = json.loads((root / "package.json").read_text(encoding="utf-8"))
require(package_json.get("dependencies", {}).get("@capgo/camera-preview") == "8.11.2",
        "camera preview version changed; review the no-location patch")
postinstall = package_json.get("scripts", {}).get("postinstall", "")
require("node tools/patch-camera-preview-ios-no-location.mjs" in postinstall,
        "camera preview no-location postinstall is missing")
require("node tools/patch-firebase-auth-ios-first-login-profile.mjs" in postinstall,
        "Firebase Authentication first-login profile postinstall is missing")

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

require(not (root / "ios/App/App/cert_key.pem").exists(),
        "cert_key.pem must not be bundled")
print("Firebase launch order: validated")
print("Firebase duplicate initialization guards: validated")
print("CocoaPods plugin graph: validated (speech, auth, camera)")
print("Camera preview iOS location APIs: absent after deterministic patch")
print("Info.plist location permission keys: absent")
print("ITSAppUsesNonExemptEncryption: Boolean false")
