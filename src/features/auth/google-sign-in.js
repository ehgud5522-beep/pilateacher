/**
 * Credential Manager is still inconsistent on some Android builds and can
 * leave the Capacitor bridge waiting without a result. The legacy Google
 * Sign-In activity is less modern, but gives this app a deterministic result
 * (success, cancellation, or error) on the Android versions we support.
 */
export function googleNativeSignInOptions(platform) {
  if (platform === "android") {
    return Object.freeze({ skipNativeAuth: true, useCredentialManager: false });
  }
  return Object.freeze({ skipNativeAuth: true });
}

