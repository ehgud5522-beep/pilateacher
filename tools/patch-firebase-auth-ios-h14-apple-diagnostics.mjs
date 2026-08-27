// H-14: make an Apple sign-in failure on iOS say where it failed.
//
// Two things in the plugin hide the cause today.
//
// 1. `handleFailedSignIn` runs NSError.code through a FirebaseAuth code table.
//    An ASAuthorizationError (domain com.apple.AuthenticationServices.
//    AuthorizationError, codes 1000-1005) is not in that table, so the mapping
//    returns nil and the call is rejected with a message and no code at all -
//    the domain and the real code never cross the bridge.
//
// 2. `authorizationController(didCompleteWithAuthorization:)` returns silently
//    on four paths (unexpected credential type, missing identity token,
//    undecodable token, missing flow state) and calls fatalError on a fifth
//    (missing nonce). The JS promise is left unsettled, so the app waits out its
//    30 s timeout and reports a timeout no matter which of the five happened.
//
// This patch reports; it does not change how a credential is built or used. The
// flow has already failed at each of these points - it just could not say so.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginDir = path.join(root, "node_modules", "@capacitor-firebase", "authentication", "ios", "Plugin");
const MARKER = "PilaTeacherAppleSignIn";

const edits = [
  {
    file: path.join(pluginDir, "FirebaseAuthentication.swift"),
    before: `        let code = FirebaseAuthenticationHelper.createErrorCode(error: error)
        savedCall.reject(errorMessage, code)`,
    after: `        var code = FirebaseAuthenticationHelper.createErrorCode(error: error)
        // ${MARKER}: keep the originating layer's own domain and code when the
        // FirebaseAuth table has no mapping for it, instead of rejecting with none.
        if code == nil, let nsError = error as NSError? {
            code = "native:\\(nsError.domain):\\(nsError.code)"
        }
        if let nsError = error as NSError? {
            savedCall.reject(errorMessage, code, error, [
                "errorDomain": nsError.domain,
                "errorCode": nsError.code
            ])
            return
        }
        savedCall.reject(errorMessage, code)`,
  },
  {
    file: path.join(pluginDir, "Handlers", "AppleAuthProviderHandler.swift"),
    before: `    func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        guard let appleIDCredential = authorization.credential as? ASAuthorizationAppleIDCredential else {
            return
        }
        guard let nonce = currentNonce else {
            fatalError("Invalid state: A login callback was received, but no login request was sent.")
        }
        guard let appleIDToken = appleIDCredential.identityToken else {
            print("Unable to fetch identity token")
            return
        }`,
    after: `    // ${MARKER}: each of these paths used to end the flow without settling the
    // JavaScript promise, so the app could only ever report a 30 s timeout.
    // Reporting the stage does not change what the flow does - it had already
    // failed here. No token, nonce or authorization code is included.
    fileprivate func reportAppleFailure(_ stage: String, _ code: Int) {
        let error = NSError(domain: "${MARKER}", code: code, userInfo: [NSLocalizedDescriptionKey: stage])
        if self.isLink == true {
            self.pluginImplementation.handleFailedLink(message: stage, error: error)
        } else {
            self.pluginImplementation.handleFailedSignIn(message: stage, error: error)
        }
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        guard let appleIDCredential = authorization.credential as? ASAuthorizationAppleIDCredential else {
            self.reportAppleFailure("apple_credential_type_unexpected", 1)
            return
        }
        guard let nonce = currentNonce else {
            self.reportAppleFailure("apple_nonce_missing", 2)
            return
        }
        guard let appleIDToken = appleIDCredential.identityToken else {
            self.reportAppleFailure("apple_identity_token_missing", 3)
            return
        }`,
  },
  {
    file: path.join(pluginDir, "Handlers", "AppleAuthProviderHandler.swift"),
    before: `        guard let idTokenString = String(data: appleIDToken, encoding: .utf8) else {
            print("Unable to serialize token string from data: \\(appleIDToken.debugDescription)")
            return
        }`,
    after: `        guard let idTokenString = String(data: appleIDToken, encoding: .utf8) else {
            self.reportAppleFailure("apple_identity_token_undecodable", 4)
            return
        }`,
  },
  {
    file: path.join(pluginDir, "Handlers", "AppleAuthProviderHandler.swift"),
    before: `        guard let isLink = self.isLink else {
            return
        }
        if isLink == true {
            self.pluginImplementation.handleSuccessfulLink(`,
    after: `        guard let isLink = self.isLink else {
            self.reportAppleFailure("apple_flow_state_missing", 5)
            return
        }
        if isLink == true {
            self.pluginImplementation.handleSuccessfulLink(`,
  },
];

let applied = 0;
for (const edit of edits) {
  const source = await readFile(edit.file, "utf8");
  if (source.includes(edit.after)) continue;
  if (!source.includes(edit.before)) {
    throw new Error(`Firebase Authentication iOS source changed; H-14 Apple diagnostics patch was not applied to ${path.basename(edit.file)}`);
  }
  await writeFile(edit.file, source.replace(edit.before, edit.after), "utf8");
  applied += 1;
}

console.log(applied
  ? `[postinstall] Firebase Authentication iOS Apple sign-in diagnostics patch applied (${applied} edit(s))`
  : "[postinstall] Firebase Authentication iOS Apple sign-in diagnostics patch already applied");
