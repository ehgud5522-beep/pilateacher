/* ===================================================================
   필라티쳐 — Firebase 연결
   config 는 pilateacher 프로젝트 값입니다.
   (Analytics 는 뺐습니다 - 개인정보 신고가 '수집 안 함'으로 유지됩니다)

   회원 사진 클라우드 백업은 별도 동의를 받은 경우에만 사용자 전용 경로로 업로드합니다.
   =================================================================== */

import { initializeApp } from "firebase/app";
import { Capacitor } from "@capacitor/core";
import { FirebaseAuthentication } from "@capacitor-firebase/authentication";
import {
  initializeAuth, browserLocalPersistence, browserPopupRedirectResolver,
  onAuthStateChanged, signOut,
  GoogleAuthProvider, OAuthProvider, signInWithPopup,
  EmailAuthProvider, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  reauthenticateWithCredential, reauthenticateWithPopup, revokeAccessToken, updateProfile,
} from "firebase/auth";
import { getFirestore, collection, deleteDoc, doc, getDoc, getDocs, runTransaction, setDoc, serverTimestamp } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { getStorage, ref as storageRef, uploadBytes, getBlob } from "firebase/storage";
import { withAuthTimeout } from "../features/auth/apple-sign-in.js";
import { signInWithCredentialSafe } from "../features/auth/credential-sign-in.js";
import { AUTH_FEATURES, AUTH_STAGES } from "../features/auth/auth-diagnostics.js";
import { setAuthInstance } from "../features/auth/auth-instance.js";
import { attachAuthFetchBridge, recordAuthInitEvent } from "../features/auth/auth-init-log.js";
import { measureAuthInitialization, recoverAuthStorage } from "../features/auth/auth-init-guard.js";
import { googleNativeSignInOptions } from "../features/auth/google-sign-in.js";
import { CLOUD_BACKUP_VERSION, backupCounts, evaluateOverwriteRisk, sanitizeFirestorePayload } from "../features/backup/cloud-backup.js";

const firebaseConfig = {
  apiKey: "AIzaSyABFqCur9nKHUuD_-EvvRNtxVbEhif9gjs",
  authDomain: "pilateacher.firebaseapp.com",
  projectId: "pilateacher",
  storageBucket: "pilateacher.firebasestorage.app",
  messagingSenderId: "452402660812",
  appId: "1:452402660812:web:2a17593756c4141d144969",
};

export const fbReady = !!(firebaseConfig.apiKey && firebaseConfig.projectId);
export const fbCurrentUserId = () => String(auth?.currentUser?.uid || "");

let app = null, auth = null, fs = null, functions = null, storage = null;
/* How many sign-in requests are in flight. The one-shot storage recovery
   reloads the web view, which must never happen while the teacher is looking
   at the Apple authorization sheet. */
let authRequestsInFlight = 0;
const authInitLog = (stage, details = {}) => recordAuthInitEvent(stage, {
  feature: AUTH_FEATURES.INITIALIZATION, provider: "firebase", ...details,
});
if (fbReady) {
  app = initializeApp(firebaseConfig);
  /* getAuth() is deliberately not used.
     It puts indexedDBLocalPersistence first and attaches
     browserPopupRedirectResolver, and on iOS the resolver is initialized
     proactively *inside* Auth's initialization promise - it loads the
     cross-origin auth iframe with a 30-60s timeout. Every sign-in call, Apple
     and e-mail alike, queues behind that promise, so a web view that stalls on
     either the IndexedDB cycle or that iframe produces exactly what this device
     reports: 45 seconds of silence, no HTTP request and no Firebase code.
     Native sign-in comes from the Capacitor plugin, so neither is needed here,
     and localStorage is the store this device measured as working. */
  auth = initializeAuth(app, { persistence: browserLocalPersistence });
  setAuthInstance(auth);
  attachAuthFetchBridge();
  /* Floats on purpose: this measures the boot, it does not gate it. */
  measureAuthInitialization(auth, {
    log: authInitLog,
    onTimeout: () => recoverAuthStorage({
      isBusy: () => authRequestsInFlight > 0,
      log: authInitLog,
    }),
  });
  fs = getFirestore(app);
  functions = getFunctions(app, "asia-northeast3");
  storage = getStorage(app);
}

const trackAuthRequest = async (run) => {
  authRequestsInFlight += 1;
  try { return await run(); }
  finally { authRequestsInFlight -= 1; }
};

const AUTH_REQUEST_TIMEOUT_MS = 20000;
const FIRESTORE_READ_TIMEOUT_MS = 8000;
const FIRESTORE_WRITE_TIMEOUT_MS = 12000;
export const AI_CONSENT_POLICY_VERSION = "2026-08-23";
export const AI_CONSENT_SCOPES = Object.freeze([
  "analyzeBody",
  "summarizeVoice",
  "recommendSequence",
  "generateReport",
]);

const shape = (u) => ({
  id: u.uid,
  email: u.email || "",
  name: u.displayName || "",
  photo: u.photoURL || "",
});

/* 앱(안드로이드·iOS)인지 판별 — 웹이면 false
   ⚠️ @capacitor/core 를 import 하지 않고 전역에서 읽는다.
      앱에서는 Capacitor 가 window.Capacitor 를 심어 주고,
      웹(볼트 미리보기·브라우저)에서는 없으므로 false 가 된다.
      이렇게 해야 웹 쪽 번들러가 Capacitor 패키지를 찾지 않아 에러가 안 난다. */
const isNative = () => {
  try { return Capacitor.isNativePlatform(); }
  catch (e) { return false; }
};
/* 네이티브 로그인 플러그인 — cap sync 로 앱에 심어지면 여기서 잡힌다 */
const nativeAuth = () => {
  return FirebaseAuthentication;
};
const nativePlatform = () => {
  try { return Capacitor.getPlatform(); }
  catch (e) { return "web"; }
};

const providerObject = (provider) => {
  if (provider === "google") return new GoogleAuthProvider();
  if (provider === "apple") {
    const apple = new OAuthProvider("apple.com");
    apple.addScope("email");
    apple.addScope("name");
    return apple;
  }
  throw Object.assign(new Error("Unsupported authentication provider."), { code: "auth/unsupported-provider" });
};

const requireNativeCredential = (provider, result) => {
  const idToken = result?.credential?.idToken;
  const nonce = result?.credential?.nonce;
  if (!idToken) {
    throw Object.assign(new Error("The native identity provider did not return an ID token."), {
      code: "auth/missing-id-token",
      authStage: "native_credential",
      provider,
    });
  }
  if (provider === "apple" && !nonce) {
    throw Object.assign(new Error("Apple Sign In did not return the nonce required by Firebase."), {
      code: "auth/missing-nonce",
      authStage: "native_credential",
      provider,
    });
  }
  return {
    credential: provider === "apple"
      ? new OAuthProvider("apple.com").credential({ idToken, rawNonce: nonce })
      : GoogleAuthProvider.credential(idToken),
    authorizationCode: provider === "apple" ? result?.credential?.authorizationCode || "" : "",
    firstName: result?.firstTimeDisplayName || result?.user?.displayName || "",
    firstEmail: result?.user?.email || "",
  };
};

/* ---------------- 로그인 ----------------
   앱에서는 팝업이 뜨지 않으므로 네이티브 로그인 화면을 쓴다.
   웹(브라우저)에서는 기존 팝업 방식 그대로. */
/**
 * `onStage` receives one record per step of the native sign-in so a failure can
 * be located at the stage that produced it. It never receives a token, a nonce,
 * a credential or an authorization code - only whether each was present.
 */
export async function fbSignInSocial(provider, options = {}) {
  return trackAuthRequest(() => runSignInSocial(provider, options));
}

async function runSignInSocial(provider, { onStage = () => {} } = {}) {
  if (provider !== "google" && provider !== "apple") providerObject(provider);
  const native = isNative();
  const NA = nativeAuth();
  const stage = (name, details = {}) => { try { onStage(name, { provider, ...details }); } catch (_error) {} };
  if (native) {
    if (!NA) {
      stage(AUTH_STAGES.NATIVE_PLUGIN_MISSING, { outcome: "failed", errorDomain: "capacitor_plugin", errorCode: "auth/native-plugin-unavailable" });
      throw Object.assign(new Error("Firebase Authentication native plugin is unavailable."), {
        code: "auth/native-plugin-unavailable",
        authStage: "native_configuration",
        provider,
      });
    }
    let startedAt = Date.now();
    stage(AUTH_STAGES.NATIVE_AUTHORIZATION_STARTED);
    let res;
    try {
      res = await withAuthTimeout(
        () => provider === "apple"
          ? NA.signInWithApple({ skipNativeAuth: true })
          : NA.signInWithGoogle(googleNativeSignInOptions(nativePlatform())),
        { timeoutMs: 30000, provider, stage: "native_credential" },
      );
    } catch (error) {
      stage(AUTH_STAGES.NATIVE_AUTHORIZATION_FAILED, { outcome: "failed", error, elapsedMs: Date.now() - startedAt });
      throw error;
    }
    stage(AUTH_STAGES.NATIVE_AUTHORIZATION_SUCCEEDED, { elapsedMs: Date.now() - startedAt });
    stage(AUTH_STAGES.CREDENTIAL_INSPECTED, {
      hasIdToken: Boolean(res?.credential?.idToken),
      hasNonce: Boolean(res?.credential?.nonce),
      hasAuthorizationCode: Boolean(res?.credential?.authorizationCode),
    });
    let nativeCredential;
    try {
      nativeCredential = requireNativeCredential(provider, res);
    } catch (error) {
      stage(AUTH_STAGES.CREDENTIAL_REJECTED, { outcome: "failed", error });
      throw error;
    }
    stage(AUTH_STAGES.FIREBASE_CREDENTIAL_CREATED);
    startedAt = Date.now();
    stage(AUTH_STAGES.FIREBASE_SIGN_IN_STARTED);
    let signedInUser;
    try {
      signedInUser = await signInWithCredentialSafe(
        auth, nativeCredential.credential,
        (name, outcome, details) => stage(name, { outcome, ...details }),
      );
    } catch (error) {
      stage(AUTH_STAGES.FIREBASE_AUTH_FAILED, { outcome: "failed", error, elapsedMs: Date.now() - startedAt });
      throw error;
    }
    stage(AUTH_STAGES.FIREBASE_AUTH_SUCCEEDED, { outcome: "succeeded", elapsedMs: Date.now() - startedAt });
    const user = shape(signedInUser);
    return {
      ...user,
      name: user.name || nativeCredential.firstName,
      email: user.email || nativeCredential.firstEmail,
      provider,
    };
  }
  /* The resolver is passed here instead of being attached to the instance, so
     the browser popup keeps working without putting the auth iframe in the
     startup path of every device. */
  const res = await withAuthTimeout(
    () => signInWithPopup(auth, providerObject(provider), browserPopupRedirectResolver),
    { timeoutMs: AUTH_REQUEST_TIMEOUT_MS, provider, stage: "web_popup" },
  );
  return { ...shape(res.user), provider };
}

export async function fbReauthenticate(provider, password = "") {
  return trackAuthRequest(() => runReauthenticate(provider, password));
}

async function runReauthenticate(provider, password = "") {
  const user = auth?.currentUser;
  if (!user) throw Object.assign(new Error("No signed-in user."), { code: "auth/unauthenticated" });
  if (provider === "email") {
    if (!user.email || !password) throw Object.assign(new Error("Password is required."), { code: "auth/password-required" });
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
    await user.getIdToken(true);
    return { provider, authorizationCode: "" };
  }
  const native = isNative();
  const NA = nativeAuth();
  if (native) {
    if (!NA) throw Object.assign(new Error("Firebase Authentication native plugin is unavailable."), { code: "auth/native-plugin-unavailable" });
    const res = await withAuthTimeout(
      () => provider === "apple"
        ? NA.signInWithApple({ skipNativeAuth: true })
        : NA.signInWithGoogle(googleNativeSignInOptions(nativePlatform())),
      { timeoutMs: 30000, provider, stage: "native_reauthentication" },
    );
    const nativeCredential = requireNativeCredential(provider, res);
    await withAuthTimeout(
      () => reauthenticateWithCredential(user, nativeCredential.credential),
      { timeoutMs: 20000, provider, stage: "firebase_reauthentication" },
    );
    await user.getIdToken(true);
    if (provider === "apple" && !nativeCredential.authorizationCode) {
      throw Object.assign(new Error("Apple Sign In did not return an authorization code for revocation."), {
        code: "auth/missing-authorization-code",
        authStage: "provider_revocation",
        provider,
      });
    }
    return { provider, authorizationCode: nativeCredential.authorizationCode };
  }
  await reauthenticateWithPopup(user, providerObject(provider), browserPopupRedirectResolver);
  await user.getIdToken(true);
  return { provider, authorizationCode: "" };
}

export async function fbRevokeAppleAccess(authorizationCode) {
  if (!authorizationCode) return;
  if (!auth) throw Object.assign(new Error("Firebase Authentication is unavailable."), { code: "auth/unauthenticated" });
  await withAuthTimeout(
    () => revokeAccessToken(auth, authorizationCode),
    { timeoutMs: 20000, provider: "apple", stage: "provider_revocation" },
  );
}

export async function fbDeleteCurrentUserAccount() {
  if (!functions || !auth?.currentUser) throw Object.assign(new Error("Authentication is required."), { code: "auth/unauthenticated" });
  const call = httpsCallable(functions, "deleteCurrentUserAccount");
  const response = await call({ confirmation: "delete_current_user" });
  return response?.data || null;
}

/**
 * Wraps one email request so the diagnostics can say whether the SDK answered,
 * refused, or never came back - and how long it took. No address or password is
 * passed to `onStage`.
 */
async function runEmailAuthRequest(operation, { authStage, onStage }) {
  const stage = (name, details = {}) => { try { onStage(name, { feature: AUTH_FEATURES.EMAIL_SIGN_IN, provider: "email", ...details }); } catch (_error) {} };
  const startedAt = Date.now();
  stage(AUTH_STAGES.EMAIL_REQUEST_START, { message: authStage });
  authRequestsInFlight += 1;
  try {
    const result = await withAuthTimeout(operation, { timeoutMs: AUTH_REQUEST_TIMEOUT_MS, provider: "email", stage: authStage });
    stage(AUTH_STAGES.EMAIL_AUTH_SUCCEEDED, { outcome: "succeeded", elapsedMs: Date.now() - startedAt });
    return result;
  } catch (error) {
    stage(AUTH_STAGES.EMAIL_AUTH_FAILED, { outcome: "failed", error, elapsedMs: Date.now() - startedAt, message: authStage });
    throw error;
  } finally {
    authRequestsInFlight -= 1;
  }
}

export async function fbSignUpEmail(email, pw, name, { onStage = () => {} } = {}) {
  const res = await runEmailAuthRequest(
    () => createUserWithEmailAndPassword(auth, email, pw),
    { authStage: "email_sign_up", onStage },
  );
  if (name) { try { await updateProfile(res.user, { displayName: name }); } catch (e) {} }
  return { ...shape(res.user), name: name || "", provider: "email" };
}

export async function fbSignInEmail(email, pw, { onStage = () => {} } = {}) {
  const res = await runEmailAuthRequest(
    () => signInWithEmailAndPassword(auth, email, pw),
    { authStage: "email_sign_in", onStage },
  );
  return { ...shape(res.user), provider: "email" };
}

/** The public Web API key, so a probe can exercise the exact route the SDK uses. */
export const fbAuthApiKey = firebaseConfig.apiKey;

export async function fbSignOut() {
  const NA = nativeAuth();
  if (NA) { try { await NA.signOut(); } catch (e) {} }
  if (auth) await signOut(auth);
}

/* 로그인 상태가 바뀔 때마다 호출됩니다. 반환값은 해제 함수 */
export function fbOnAuth(cb) {
  if (!auth) return () => {};
  return onAuthStateChanged(auth, (u) => {
    if (!u) { cb(null); return; }
    const provider = (u.providerData && u.providerData[0] && u.providerData[0].providerId) || "";
    cb({
      ...shape(u),
      provider: provider.indexOf("google") >= 0 ? "google"
        : provider.indexOf("apple") >= 0 ? "apple" : "email",
    });
  });
}

/* ---------------- 강사 프로필 ---------------- */
export async function fbLoadProfile(uid) {
  if (!fs || !uid) return null;
  try {
    const snap = await withAuthTimeout(
      () => getDoc(doc(fs, "users", uid)),
      { timeoutMs: FIRESTORE_READ_TIMEOUT_MS, provider: "firebase", stage: "profile_read" },
    );
    return snap.exists() ? snap.data() : null;
  } catch (e) { return null; }
}

export async function fbSaveProfile(uid, profile) {
  if (!fs || !uid) return;
  await withAuthTimeout(
    () => setDoc(doc(fs, "users", uid), { ...profile, updatedAt: serverTimestamp() }, { merge: true }),
    { timeoutMs: FIRESTORE_WRITE_TIMEOUT_MS, provider: "firebase", stage: "profile_write" },
  );
}

/* ---------------- 자동 클라우드 백업 ---------------- */
const deviceTag = () => {
  try {
    const ua = navigator.userAgent || "";
    return /iPad/.test(ua) ? "iPad" : /iPhone/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android" : "기타";
  } catch (e) { return "기타"; }
};

export async function fbPushBackup(uid, data, options = {}) {
  if (!fs || !uid || !data) return;
  // The in-memory app database can hold keys whose value is `undefined`; only
  // the localStorage copy ever passes through JSON. Firestore rejects the whole
  // write for those with code "invalid-argument", so drop them at this boundary.
  const payload = sanitizeFirestorePayload(data);
  const photoManifest = sanitizeFirestorePayload(options.photoManifest || []);
  const photoGraph = sanitizeFirestorePayload(options.photoGraph || {});
  const counts = backupCounts(payload, photoManifest, photoGraph);
  await withAuthTimeout(
    () => runTransaction(fs, async (transaction) => {
      const backupRef = doc(fs, "users", uid, "backup", "latest");
      const snapshot = await transaction.get(backupRef);
      const current = snapshot.exists() ? snapshot.data() : null;
      const risk = current ? evaluateOverwriteRisk(payload, current) : { blocked: false, reasons: [] };
      if (risk.blocked && options.allowDestructiveOverwrite !== true) {
        const error = new Error("Cloud backup overwrite was blocked.");
        Object.assign(error, { code: "backup/overwrite-blocked", reasons: risk.reasons, risk });
        throw error;
      }
      transaction.set(backupRef, {
        schemaVersion: CLOUD_BACKUP_VERSION,
        data: payload,
        device: deviceTag(),
        at: serverTimestamp(),
        members: counts.members,
        counts: { ...counts, photos: Number.isFinite(Number(options.photoCount)) ? Math.max(0, Number(options.photoCount)) : Math.max(0, Number(current?.counts?.photos) || 0) },
        photoPending: Math.max(0, Number(options.photoPending) || 0),
        storageUsage: options.storageUsage && typeof options.storageUsage === "object" ? sanitizeFirestorePayload(options.storageUsage) : current?.storageUsage || null,
        photoGraph: options.photoGraph && typeof options.photoGraph === "object" ? photoGraph : current?.photoGraph || {},
      });
    }),
    { timeoutMs: FIRESTORE_WRITE_TIMEOUT_MS, provider: "firebase", stage: "backup_write" },
  );
  return { counts };
}

export async function fbPullBackup(uid) {
  if (!fs || !uid) return null;
  try {
    const snap = await withAuthTimeout(
      () => getDoc(doc(fs, "users", uid, "backup", "latest")),
      { timeoutMs: FIRESTORE_READ_TIMEOUT_MS, provider: "firebase", stage: "backup_read" },
    );
    return snap.exists() ? snap.data() : null;
  } catch (e) { return null; }
}

const assertOwnPhotoPath = (uid, photoId) => {
  const currentUid = auth?.currentUser?.uid;
  const safeUid = String(uid || "").trim();
  const safePhotoId = String(photoId || "").trim().replace(/[^A-Za-z0-9._:-]/g, "_").slice(0, 160);
  if (!safeUid || currentUid !== safeUid || !safePhotoId) throw Object.assign(new Error("Photo backup authentication is required."), { code: "auth/unauthenticated" });
  return { safeUid, safePhotoId };
};

const firestoreSafe = (value) => JSON.parse(JSON.stringify(value ?? null));

const diagnosticDocumentId = (value) => String(value || "")
  .replace(/[^A-Za-z0-9._:-]/g, "_")
  .slice(0, 160);

export async function fbSendDiagnosticReport(uid, report) {
  const currentUid = auth?.currentUser?.uid;
  const safeUid = String(uid || "").trim();
  if (!fs || !safeUid || currentUid !== safeUid) throw Object.assign(new Error("Authentication is required."), { code: "auth/unauthenticated" });
  const reportId = diagnosticDocumentId(String(Date.now()));
  const payload = firestoreSafe(report || {});
  await withAuthTimeout(
    () => setDoc(doc(fs, "diagnostics", safeUid, "reports", reportId), {
      ...payload,
      uid: safeUid,
      uploadedAt: serverTimestamp(),
    }, { merge: false }),
    { timeoutMs: FIRESTORE_WRITE_TIMEOUT_MS, provider: "firebase", stage: "diagnostic_report_write" },
  );
  return { reportId, path: `diagnostics/${safeUid}/reports/${reportId}` };
}

const pilotMetricDate = (date = new Date()) => {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(date); }
  catch (_error) { return date.toISOString().slice(0, 10); }
};

export async function fbWritePilotMetricAttempt(details = {}) {
  const currentUid = auth?.currentUser?.uid;
  const attemptId = diagnosticDocumentId(details.requestId);
  if (!fs || !currentUid || !attemptId) return null;
  const allowedFlags = new Set(["no_speech", "low_confidence", "tail_dropped"]);
  const flags = [...new Set((details.flags || []).map((flag) => String(flag || "")).filter((flag) => allowedFlags.has(flag)))].slice(0, 3);
  const result = ["ok", "no_speech", "low_confidence", "failed"].includes(details.result) ? details.result : "failed";
  const payload = {
    schemaVersion: 1,
    uid: currentUid,
    date: pilotMetricDate(),
    result,
    flags,
    confirmed: details.confirmed === true,
    latencyMs: Math.max(0, Math.min(120000, Math.round(Number(details.latencyMs) || 0))),
    source: String(details.source || "server_audio").replace(/[^A-Za-z0-9._:-]/g, "_").slice(0, 40),
    updatedAt: serverTimestamp(),
  };
  await withAuthTimeout(
    () => setDoc(doc(fs, "pilotMetrics", currentUid, "attempts", attemptId), payload, { merge: true }),
    { timeoutMs: FIRESTORE_WRITE_TIMEOUT_MS, provider: "firebase", stage: "pilot_metric_write" },
  );
  return { attemptId };
}

export async function fbListPhotoBackups(uid) {
  if (!fs || !uid || auth?.currentUser?.uid !== uid) return [];
  const snapshot = await withAuthTimeout(
    () => getDocs(collection(fs, "users", uid, "photoBackups")),
    { timeoutMs: FIRESTORE_READ_TIMEOUT_MS, provider: "firebase", stage: "photo_manifest_read" },
  );
  return snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
}

export async function fbUploadPhotoBackup(uid, item, optimized = null) {
  if (!fs || !storage) throw Object.assign(new Error("Cloud photo backup is unavailable."), { code: "backup/unavailable" });
  const { safeUid, safePhotoId } = assertOwnPhotoPath(uid, item?.photoId);
  const imagePath = `users/${safeUid}/photos/${safePhotoId}/image.jpg`;
  const thumbnailPath = `users/${safeUid}/photos/${safePhotoId}/thumb.jpg`;
  let imageBytes = Math.max(0, Number(item?.imageBytes) || 0);
  let thumbnailBytes = Math.max(0, Number(item?.thumbnailBytes) || 0);
  if (optimized?.image?.blob && optimized?.thumbnail?.blob) {
    const metadata = { contentType: "image/jpeg", cacheControl: "private,max-age=3600", customMetadata: { photoId: safePhotoId } };
    const [imageResult, thumbnailResult] = await Promise.all([
      uploadBytes(storageRef(storage, imagePath), optimized.image.blob, metadata),
      uploadBytes(storageRef(storage, thumbnailPath), optimized.thumbnail.blob, metadata),
    ]);
    imageBytes = imageResult.metadata.size || optimized.image.blob.size;
    thumbnailBytes = thumbnailResult.metadata.size || optimized.thumbnail.blob.size;
  } else if (!item?.storagePath || !item?.thumbnailPath) {
    throw Object.assign(new Error("Local photo data is required for the first cloud upload."), { code: "backup/photo-missing" });
  }
  const payload = {
    schemaVersion: 1,
    photoId: safePhotoId,
    memberId: String(item?.memberId || "").slice(0, 160),
    assessmentId: String(item?.assessmentId || "").slice(0, 160),
    bucketKey: String(item?.bucketKey || "").slice(0, 80),
    view: String(item?.view || "").slice(0, 40),
    date: String(item?.date || "").slice(0, 40),
    width: Math.max(0, Number(optimized?.image?.width || item?.width) || 0),
    height: Math.max(0, Number(optimized?.image?.height || item?.height) || 0),
    storagePath: item?.storagePath || imagePath,
    thumbnailPath: item?.thumbnailPath || thumbnailPath,
    imageBytes,
    thumbnailBytes,
    status: "active",
    record: firestoreSafe(item?.record || {}),
    references: firestoreSafe(Array.isArray(item?.references) ? item.references.slice(0, 20) : []),
    uploadedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    deletedAt: null,
    purgeAfter: null,
  };
  await withAuthTimeout(
    () => setDoc(doc(fs, "users", safeUid, "photoBackups", safePhotoId), payload, { merge: false }),
    { timeoutMs: 30000, provider: "firebase", stage: "photo_backup_write" },
  );
  return { ...payload, uploadedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
}

export async function fbDownloadPhotoBackup(uid, item, thumbnail = false) {
  if (!storage) throw Object.assign(new Error("Cloud photo backup is unavailable."), { code: "backup/unavailable" });
  assertOwnPhotoPath(uid, item?.photoId);
  const path = thumbnail ? item?.thumbnailPath : item?.storagePath;
  if (!path) throw Object.assign(new Error("Cloud photo path is missing."), { code: "backup/photo-missing" });
  return withAuthTimeout(
    () => getBlob(storageRef(storage, path)),
    { timeoutMs: 30000, provider: "firebase", stage: thumbnail ? "photo_thumbnail_download" : "photo_download" },
  );
}

export async function fbSoftDeletePhotoBackup(uid, photoId) {
  if (!fs) return;
  const ids = assertOwnPhotoPath(uid, photoId);
  const purgeAfter = new Date(Date.now() + 30 * 86400000);
  const imagePath = `users/${ids.safeUid}/photos/${ids.safePhotoId}/image.jpg`;
  const thumbnailPath = `users/${ids.safeUid}/photos/${ids.safePhotoId}/thumb.jpg`;
  await withAuthTimeout(
    () => setDoc(doc(fs, "users", ids.safeUid, "photoBackups", ids.safePhotoId), {
      schemaVersion: 1,
      photoId: ids.safePhotoId,
      memberId: "",
      assessmentId: "",
      bucketKey: "",
      view: "",
      date: "",
      width: 0,
      height: 0,
      storagePath: imagePath,
      thumbnailPath,
      imageBytes: 0,
      thumbnailBytes: 0,
      status: "deleted",
      record: {},
      references: [],
      deletedAt: serverTimestamp(),
      purgeAfter,
      updatedAt: serverTimestamp(),
    }, { merge: true }),
    { timeoutMs: FIRESTORE_WRITE_TIMEOUT_MS, provider: "firebase", stage: "photo_soft_delete" },
  );
}

export async function fbPurgeExpiredPhotoBackups() {
  if (!functions || !auth?.currentUser) return { purged: 0 };
  const call = httpsCallable(functions, "purgeExpiredPhotoBackups");
  const response = await call({});
  return response?.data || { purged: 0 };
}

/* ---------------- AI 처리 동의 (사진·전사·회원정보는 저장하지 않음) ---------------- */
const aiConsentMemberId = (value) => {
  const memberId = String(value || "").trim();
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(memberId)) {
    throw Object.assign(new Error("A valid member id is required."), { code: "ai/invalid-member-id" });
  }
  return memberId;
};

const normalizeAIConsentScopes = (values) => {
  const requested = Array.isArray(values) ? values : AI_CONSENT_SCOPES;
  const allowed = new Set(AI_CONSENT_SCOPES);
  const scopes = [...new Set(requested.map((value) => String(value || "").trim()).filter((value) => allowed.has(value)))];
  if (!scopes.length) throw Object.assign(new Error("At least one AI consent scope is required."), { code: "ai/invalid-consent-scope" });
  return scopes;
};

export async function fbLoadAIConsent(memberId) {
  const user = auth?.currentUser;
  if (!fs || !user) return null;
  const safeMemberId = aiConsentMemberId(memberId);
  try {
    const snap = await withAuthTimeout(
      () => getDoc(doc(fs, "users", user.uid, "aiConsents", safeMemberId)),
      { timeoutMs: FIRESTORE_READ_TIMEOUT_MS, provider: "firebase", stage: "ai_consent_read" },
    );
    return snap.exists() ? snap.data() : null;
  } catch (error) {
    if (error?.code === "ai/invalid-member-id") throw error;
    return null;
  }
}

export async function fbGrantAIConsent(memberId, scopes = AI_CONSENT_SCOPES) {
  const user = auth?.currentUser;
  if (!fs || !user) throw Object.assign(new Error("Authentication is required."), { code: "auth/unauthenticated" });
  const safeMemberId = aiConsentMemberId(memberId);
  const safeScopes = normalizeAIConsentScopes(scopes);
  await withAuthTimeout(
    () => setDoc(doc(fs, "users", user.uid, "aiConsents", safeMemberId), {
      status: "granted",
      policyVersion: AI_CONSENT_POLICY_VERSION,
      scopes: safeScopes,
      grantedAt: serverTimestamp(),
      revokedAt: null,
      updatedAt: serverTimestamp(),
    }, { merge: false }),
    { timeoutMs: FIRESTORE_WRITE_TIMEOUT_MS, provider: "firebase", stage: "ai_consent_write" },
  );
  return { status: "granted", policyVersion: AI_CONSENT_POLICY_VERSION, scopes: safeScopes };
}

export async function fbRevokeAIConsent(memberId) {
  const user = auth?.currentUser;
  if (!fs || !user) throw Object.assign(new Error("Authentication is required."), { code: "auth/unauthenticated" });
  const safeMemberId = aiConsentMemberId(memberId);
  await withAuthTimeout(
    () => setDoc(doc(fs, "users", user.uid, "aiConsents", safeMemberId), {
      status: "revoked",
      policyVersion: AI_CONSENT_POLICY_VERSION,
      scopes: [],
      revokedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true }),
    { timeoutMs: FIRESTORE_WRITE_TIMEOUT_MS, provider: "firebase", stage: "ai_consent_revoke" },
  );
}

export async function fbDeleteAIConsent(memberId) {
  const user = auth?.currentUser;
  if (!fs || !user) return false;
  const safeMemberId = aiConsentMemberId(memberId);
  await withAuthTimeout(
    () => deleteDoc(doc(fs, "users", user.uid, "aiConsents", safeMemberId)),
    { timeoutMs: FIRESTORE_WRITE_TIMEOUT_MS, provider: "firebase", stage: "ai_consent_delete" },
  );
  return true;
}

export async function fbLoadAIRecordingStatus() {
  if (!fs || !auth?.currentUser) return { status: "normal", reasonCode: "", updatedAt: "" };
  try {
    const snap = await withAuthTimeout(
      () => getDoc(doc(fs, "runtimeConfig", "aiRecording")),
      { timeoutMs: FIRESTORE_READ_TIMEOUT_MS, provider: "firebase", stage: "ai_recording_status_read" },
    );
    if (!snap.exists()) return { status: "normal", reasonCode: "", updatedAt: "" };
    const data = snap.data() || {};
    return {
      status: ["normal", "degraded", "off"].includes(data.status) ? data.status : "normal",
      reasonCode: String(data.reasonCode || ""),
      updatedAt: typeof data.updatedAt?.toDate === "function" ? data.updatedAt.toDate().toISOString() : String(data.updatedAt || ""),
    };
  } catch (_error) {
    return null;
  }
}
