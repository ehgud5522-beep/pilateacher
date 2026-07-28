/* ===================================================================
   필라티쳐 — Firebase 연결
   config 는 pilateacher 프로젝트 값입니다.
   (Analytics 는 뺐습니다 - 개인정보 신고가 '수집 안 함'으로 유지됩니다)

   ⚠️ 회원 사진(비포애프터·체형분석)은 여기로 절대 올라가지 않습니다.
   =================================================================== */

import { initializeApp } from "firebase/app";
import {
  getAuth, onAuthStateChanged, signOut,
  GoogleAuthProvider, OAuthProvider, signInWithPopup, signInWithCredential,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile,
} from "firebase/auth";
import { getFirestore, doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyABFqCur9nKHUuD_-EvvRNtxVbEhif9gjs",
  authDomain: "pilateacher.firebaseapp.com",
  projectId: "pilateacher",
  storageBucket: "pilateacher.firebasestorage.app",
  messagingSenderId: "452402660812",
  appId: "1:452402660812:web:2a17593756c4141d144969",
};

export const fbReady = !!(firebaseConfig.apiKey && firebaseConfig.projectId);

let app = null, auth = null, fs = null;
if (fbReady) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  fs = getFirestore(app);
}

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
const cap = () => {
  try { return (typeof window !== "undefined" && window.Capacitor) || null; } catch (e) { return null; }
};
const isNative = () => {
  const c = cap();
  try { return !!(c && typeof c.isNativePlatform === "function" && c.isNativePlatform()); }
  catch (e) { return false; }
};
/* 네이티브 로그인 플러그인 — cap sync 로 앱에 심어지면 여기서 잡힌다 */
const nativeAuth = () => {
  const c = cap();
  return (c && c.Plugins && c.Plugins.FirebaseAuthentication) || null;
};

/* ---------------- 로그인 ----------------
   앱에서는 팝업이 뜨지 않으므로 네이티브 로그인 화면을 쓴다.
   웹(브라우저)에서는 기존 팝업 방식 그대로. */
export async function fbSignInSocial(provider) {
  const NA = nativeAuth();
  if (isNative() && NA) {
    const res = provider === "apple"
      ? await NA.signInWithApple({ skipNativeAuth: true })
      : await NA.signInWithGoogle({ skipNativeAuth: true });
    const cred = provider === "apple"
      ? new OAuthProvider("apple.com").credential({
          idToken: res?.credential?.idToken,
          rawNonce: res?.credential?.nonce,
        })
      : GoogleAuthProvider.credential(res?.credential?.idToken);
    const out = await signInWithCredential(auth, cred);
    return { ...shape(out.user), provider };
  }
  let p;
  if (provider === "google") {
    p = new GoogleAuthProvider();
  } else if (provider === "apple") {
    p = new OAuthProvider("apple.com");
    p.addScope("email");
    p.addScope("name");
  } else {
    throw new Error("unsupported provider");
  }
  const res = await signInWithPopup(auth, p);
  return { ...shape(res.user), provider };
}

export async function fbSignUpEmail(email, pw, name) {
  const res = await createUserWithEmailAndPassword(auth, email, pw);
  if (name) { try { await updateProfile(res.user, { displayName: name }); } catch (e) {} }
  return { ...shape(res.user), name: name || "", provider: "email" };
}

export async function fbSignInEmail(email, pw) {
  const res = await signInWithEmailAndPassword(auth, email, pw);
  return { ...shape(res.user), provider: "email" };
}

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
    const snap = await getDoc(doc(fs, "users", uid));
    return snap.exists() ? snap.data() : null;
  } catch (e) { return null; }
}

export async function fbSaveProfile(uid, profile) {
  if (!fs || !uid) return;
  await setDoc(doc(fs, "users", uid), { ...profile, updatedAt: serverTimestamp() }, { merge: true });
}

/* ---------------- 백업 (사진 제외) ---------------- */
const deviceTag = () => {
  try {
    const ua = navigator.userAgent || "";
    return /iPad/.test(ua) ? "iPad" : /iPhone/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android" : "기타";
  } catch (e) { return "기타"; }
};

export async function fbPushBackup(uid, data) {
  if (!fs || !uid || !data) return;
  await setDoc(doc(fs, "users", uid, "backup", "latest"), {
    data,
    device: deviceTag(),
    at: serverTimestamp(),
    members: Array.isArray(data.members) ? data.members.length : 0,
  });
}

export async function fbPullBackup(uid) {
  if (!fs || !uid) return null;
  try {
    const snap = await getDoc(doc(fs, "users", uid, "backup", "latest"));
    return snap.exists() ? snap.data() : null;
  } catch (e) { return null; }
}
