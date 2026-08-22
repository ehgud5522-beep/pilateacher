# App Review build 48 launch crash

## Review incident

- Submission: `8184251d-52c5-40d1-8193-a8c1704a9cfa`
- Rejected build: `1.0 (48)`
- Review OS: iOS/iPadOS 26.6.1
- Crash: `EXC_CRASH (SIGABRT)` on the main thread during launch

## Confirmed crash signature

Both supplied reports terminate while Capacitor is registering native plugins:

1. `+[FIRApp configure]`
2. `CapacitorBridge.loadPlugin(type:)`
3. `CapacitorBridge.registerPlugins()`
4. `CAPBridgeViewController.loadView()`

The app aborts before the first web view is displayed. This is the same class of
Firebase launch failure that the previously approved build 42 guarded against.

## Root cause

The build 48 CocoaPods migration removed three launch-critical pieces together:

- the explicit `configureFirebaseSafely()` call in `AppDelegate`;
- `GoogleService-Info.plist` from the application target's bundle resources;
- the CI source checks that required both items.

`CapacitorFirebaseAuthentication` then attempted parameterless Firebase
configuration while the Capacitor bridge loaded. With no bundled Firebase plist,
Firebase raised an Objective-C exception and iOS aborted the app.

## Corrective action

- Restore safe Firebase initialization before `didFinishLaunching` returns.
- Keep `GoogleService-Info.plist` in Copy Bundle Resources.
- Keep Sign in with Apple entitlements and URL scheme configuration.
- Use CocoaPods for speech recognition, Firebase Authentication, and camera preview.
- Require microphone and speech-recognition usage descriptions.
- Fail Codemagic before archive creation if any launch requirement regresses.
- Validate the exported IPA contains the Firebase plist and a matching dSYM.

## Verification gate

`tools/ios/validate_release_source.py` now blocks a release when:

- Firebase is not configured before the Capacitor bridge loads;
- the Firebase plist is absent from the app target;
- CocoaPods or any required native plugin is missing;
- the obsolete SPM target is reintroduced;
- Apple Sign In, permission descriptions, or release metadata are incomplete.
