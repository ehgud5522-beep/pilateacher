import { onIdTokenChanged, signInWithCredential } from "firebase/auth";
import { AUTH_OPERATION_TIMEOUT_CODE } from "./apple-sign-in.js";
import { AUTH_STAGES, readAuthErrorIdentity } from "./auth-diagnostics.js";

/**
 * Recover when Firebase has installed a new user but its sign-in promise has
 * not settled. This cannot recover an exchange that never updates local auth.
 *
 * The second window observes the SAME request: a timeout does not cancel the
 * SDK operation, and resubmitting an Apple credential can reuse its nonce.
 * Existing sessions (including sessions restored during startup) never count
 * as this login. Same-account sign-ins must complete through the SDK promise.
 *
 * @param {import("firebase/auth").Auth} auth
 * @param {import("firebase/auth").AuthCredential} credential
 * @param {(stage: string, outcome: string, details: Record<string, any>) => void} [log]
 */
export function signInWithCredentialSafe(auth, credential, log, {
  hardMs = 45000,
  settleMs = 3000,
  signIn = signInWithCredential,
  subscribe = onIdTokenChanged,
} = {}) {
  return new Promise((resolve, reject) => {
    let done = false;
    let started = false;
    let initialUid = null;
    let tryNo = 1;
    let operationError = null;
    let unsubscribe = null;
    let hardTimer = null;
    let settleTimer = null;
    let stateTimer = null;

    const record = (name, details = {}) => {
      try { log?.(name, "info", details); } catch (_error) { /* Diagnostics must not block login. */ }
    };
    const cleanup = () => {
      clearTimeout(hardTimer);
      clearTimeout(settleTimer);
      clearTimeout(stateTimer);
      try { unsubscribe?.(); } catch (_error) { /* Always settle even if disposal fails. */ }
      unsubscribe = null;
    };
    const finish = (user, via) => {
      if (done) return;
      done = true;
      cleanup();
      record(AUTH_STAGES.FIREBASE_SIGN_IN_SETTLED, { via, tryNo, message: `${via} · 시도 ${tryNo}` });
      resolve(user);
    };
    const fail = (error) => {
      if (done) return;
      done = true;
      cleanup();
      reject(error);
    };
    const recoveredUser = () => {
      const user = auth.currentUser;
      return started && user && user.uid !== initialUid
        && user.providerData?.some((item) => item.providerId === credential.providerId)
        ? user : null;
    };
    const checkDeadline = () => {
      if (done) return;
      const user = recoveredUser();
      if (user) { finish(user, "timeout_but_signed_in"); return; }
      // Preserve a real SDK rejection rather than replacing it with a timeout.
      if (operationError) { fail(operationError); return; }
      if (started && tryNo === 1) {
        tryNo = 2;
        record(AUTH_STAGES.FIREBASE_SIGN_IN_RETRY, {
          tryNo, message: "인증 상태 재확인 · 시도 2 · 추가 인증 요청 없음",
        });
        hardTimer = setTimeout(checkDeadline, hardMs);
        return;
      }
      fail(Object.assign(new Error("Authentication did not respond in time."), {
        code: AUTH_OPERATION_TIMEOUT_CODE,
        authStage: started ? "firebase_credential_exchange" : "firebase_auth_state_init",
        provider: credential.providerId === "apple.com" ? "apple" : "google",
      }));
    };

    hardTimer = setTimeout(checkDeadline, hardMs);
    Promise.resolve().then(async () => {
      // Include persistence initialization in the deadline, and snapshot only
      // after it settles so the initial listener notification cannot win.
      await auth.authStateReady();
      if (done) return;
      initialUid = auth.currentUser?.uid ?? null;
      try {
        unsubscribe = subscribe(auth, () => {
          if (done || !recoveredUser()) return;
          clearTimeout(stateTimer);
          stateTimer = setTimeout(() => {
            const user = recoveredUser();
            if (user) finish(user, "authstate");
          }, 0);
        });
      } catch (error) {
        record(AUTH_STAGES.AUTHSTATE_LISTENER_FAILED, readAuthErrorIdentity(error));
      }
      started = true;
      // Handle both synchronous throws and eventual rejection after recovery.
      return signIn(auth, credential);
    }).then((result) => {
      if (done) return;
      if (result?.user) finish(result.user, "promise");
      else fail(Object.assign(new Error("Authentication returned no user."), { code: "auth/internal-error" }));
    }).catch((error) => {
      if (done) return;
      if (!started) { fail(error); return; }
      operationError = error;
      settleTimer = setTimeout(() => {
        const user = recoveredUser();
        if (user) finish(user, "promise_error_but_signed_in");
        else fail(error);
      }, settleMs);
    });
  });
}
