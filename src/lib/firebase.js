/* ===================================================================
   필라티쳐 — Firebase 연결
   ⚠️ 회원 사진(비포애프터·체형분석)은 여기로 절대 올라가지 않습니다.
   =================================================================== */

import { initializeApp } from "firebase/app";
import {
  getAuth, onAuthStateChanged, signOut,
  GoogleAuthProvider, OAuthProvider, signInWithPopup,
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

/* ---------------- 로그인 ---------------- */
export async function fbSignInSocial(provider) {
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
  if (auth) await signOut(auth);
}

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
