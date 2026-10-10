/**
 * 회원 앱의 Firebase. 강사 앱과 **같은 프로젝트, 다른 번들**이다.
 *
 * 여기 있는 것은 셋뿐이다: 전화번호 인증 · 연결 함수 호출 · Firestore 핸들.
 * 강사 앱의 `src/lib/firebase.js` 는 1,000줄이 넘고 백업·사진·AI 동의까지
 * 들고 있다 -- 회원이 그것을 내려받을 이유가 없다.
 */

import { initializeApp } from "firebase/app";
import {
  PhoneAuthProvider, RecaptchaVerifier, browserLocalPersistence, getAuth,
  initializeAuth, onAuthStateChanged, signInWithCredential, signInWithPhoneNumber, signOut,
} from "firebase/auth";
import { getFirestore } from "firebase/firestore/lite";
import { getFunctions, httpsCallable } from "firebase/functions";
import { isNativePhoneAuth, shouldFallBackToWeb, startNativePhoneSignIn } from "./phone-auth.js";
import { toE164 } from "./phone.js";

/* 강사 앱과 같은 값이다 (src/lib/firebase.js). 웹 apiKey 는 비밀이 아니다 --
   문을 지키는 것은 규칙과 인증이다. */
const firebaseConfig = {
  apiKey: "AIzaSyABFqCur9nKHUuD_-EvvRNtxVbEhif9gjs",
  authDomain: "pilateacher.firebaseapp.com",
  projectId: "pilateacher",
  storageBucket: "pilateacher.firebasestorage.app",
  messagingSenderId: "452402660812",
  appId: "1:452402660812:web:2a17593756c4141d144969",
};

const app = initializeApp(firebaseConfig);

/**
 * 앱에서는 `getAuth()` 를 쓰지 않는다.
 *
 * `getAuth()` 는 `indexedDBLocalPersistence` 를 맨 앞에 두고
 * `browserPopupRedirectResolver` 를 함께 단다. **iOS 웹뷰에서 그 리졸버는
 * Auth 초기화 약속 안에서 미리 켜지면서 교차 출처 iframe 을 30~60초
 * 시간제한으로 불러온다.** 그동안 `onAuthStateChanged` 가 한 번도 불리지
 * 않고, 화면은 "잠시만요…" 에 머문다 -- TestFlight 빌드에서 실제로 그랬다.
 *
 * 리졸버는 이 앱에 필요 없다. 회원 로그인은 네이티브 플러그인이나 웹
 * reCAPTCHA 로 오고, 둘 다 팝업·리다이렉트를 쓰지 않는다.
 *
 * ── 왜 indexedDB 가 아니라 localStorage 인가 ──
 * 강사 앱이 같은 자리에서 같은 증상을 겪고 남긴 것이다 (src/lib/firebase.js):
 * 멈추는 곳이 iframe 이거나 **IndexedDB 순환**이었고, 이 기기에서 실제로
 * 도는 것으로 측정된 저장소가 localStorage 였다. 측정된 쪽을 따른다.
 *
 * 웹은 그대로 `getAuth()` 다. 브라우저에서는 이 문제가 없고, 굳이 바꾸면
 * 지금 도는 것을 확인 없이 건드리는 것이 된다.
 */
export const auth = isNativeRuntime()
  ? initializeAuth(app, { persistence: browserLocalPersistence })
  : getAuth(app);

/** 네이티브인가. 판정에 실패하면 웹이다 -- 그쪽은 어디서나 돈다. */
function isNativeRuntime() {
  try { return Boolean(capacitor()?.isNativePlatform?.()); }
  catch (_error) { return false; }
}
export const db = getFirestore(app);
const functions = getFunctions(app, "asia-northeast3");

/* reCAPTCHA 는 보이지 않게 둔다. 회원에게 "로봇이 아닙니다" 를 시키는 화면은
   잔여 횟수 하나를 보려는 사람에게 너무 큰 문턱이다. 검증 자체는 그대로 돈다.

   하나만 만든다. 누를 때마다 새로 만들면 같은 자리에 위젯이 겹쳐 "already
   been rendered" 로 진다. 다만 붙어 있던 자리(#recaptcha)가 화면에서 사라졌으면
   -- 로그인 화면이 다시 그려졌으면 -- 그 verifier 는 떨어진 요소를 붙들고
   있으므로 새로 만든다. 위젯은 매번 새 자식 요소에 그린다: clear() 뒤에도
   같은 요소에 다시 그리면 grecaptcha 가 거부하는 경우가 있다. */
let verifier = null;
let verifierHost = null;
export function recaptcha(containerId = "recaptcha") {
  const host = document.getElementById(containerId);
  if (verifier && verifierHost && host && verifierHost.parentNode === host) return verifier;
  resetRecaptcha();
  if (!host) throw Object.assign(new Error("recaptcha container missing"), { code: "member/recaptcha-container-missing" });
  verifierHost = document.createElement("div");
  host.appendChild(verifierHost);
  verifier = new RecaptchaVerifier(auth, verifierHost, { size: "invisible" });
  return verifier;
}

/** 실패한 verifier 를 걷어낸다. 다음 recaptcha() 가 새로 만든다. */
export function resetRecaptcha() {
  try {
    verifier?.clear();
  } catch (_error) {
    /* 이미 걷혔거나 그려지기 전이다. 어느 쪽이든 새로 만들면 된다. */
  }
  verifierHost?.remove();
  verifier = null;
  verifierHost = null;
}

/** 인증번호를 보낸다. 돌려받은 것으로 `confirm(code)` 를 부른다. */
export function sendCode(phone, containerId = "recaptcha") {
  return signInWithPhoneNumber(auth, toE164(phone), recaptcha(containerId));
}

/**
 * 문자 인증을 시작한다. **화면은 웹인지 앱인지 몰라도 된다** -- 돌려주는
 * 것에 `.confirm(code)` 가 있는 것은 두 길이 같다.
 *
 * 앱에서는 네이티브로 보낸다. 웹뷰 안의 reCAPTCHA 는 잔여 횟수 하나를 보려는
 * 사람에게 너무 큰 문턱이고, 실패해도 이유가 안 보인다.
 *
 * 다만 Android 는 문자 없이 인증이 끝날 수 있는데(즉시 인증) 그때 JS 로
 * 이어받을 자격이 넘어오지 않는다 (phone-auth.js 머리말). 그 한 갈래에서만
 * 웹 길로 되돌아간다.
 */
export async function startPhoneSignIn(phone, options = {}) {
  const e164 = toE164(phone);
  if (isNativePhoneAuth(capacitor())) {
    const { FirebaseAuthentication } = await import("@capacitor-firebase/authentication");
    try {
      return await startNativePhoneSignIn({
        plugin: FirebaseAuthentication,
        phoneNumber: e164,
        onAutoCode: options.onAutoCode,
        signInWithCode: (verificationId, code) =>
          signInWithCredential(auth, PhoneAuthProvider.credential(verificationId, code)),
      });
    } catch (error) {
      if (!shouldFallBackToWeb(error)) throw error;
      /* 즉시 인증이 끝났는데 이어받을 재료가 없다. 웹 길은 reCAPTCHA 를
         태우는 대신 언제나 ConfirmationResult 를 준다 -- 문턱을 무르는 것이
         막힌 화면보다 낫다. */
    }
  }
  return sendCode(e164, options.containerId);
}

/** 네이티브 여부를 묻는 자리. 웹 빌드에서는 없는 것이 정상이다. */
function capacitor() {
  return typeof globalThis === "undefined" ? null : globalThis.Capacitor || null;
}

/** 로그인 상태. 되돌려주는 함수를 부르면 구독이 끊긴다. */
export const watchAuth = (handler) => onAuthStateChanged(auth, handler);

/**
 * 인증된 번호로 자기 회원 문서를 찾아 잇는다.
 *
 * 번호를 실어 보내지 않는다 -- 서버는 `request.auth.token.phone_number` 만
 * 믿고, 보낸 번호는 읽지도 않는다.
 */
export async function linkMemberAccount() {
  const call = httpsCallable(functions, "linkMemberAccount");
  const response = await call({});
  return response?.data || null;
}

/**
 * 자기 계정을 지운다. **대상을 보내지 않는다** -- 서버는 토큰의 uid 만 쓰고,
 * 보낸 값은 읽지도 않는다.
 */
export async function deleteMemberAccount() {
  const call = httpsCallable(functions, "deleteMemberAccount");
  const response = await call({});
  return response?.data || null;
}

/**
 * 로그아웃. 다음 사람이 이 기기에서 인증할 때 쓸 reCAPTCHA 도 새로 만든다.
 *
 * 회원이 누른 로그아웃은 실패를 던진다 -- 끊기지 않았는데 조용히 넘어가면
 * 화면이 그대로라 회원은 버튼이 고장 났다고 읽는다 (App 이 코드와 함께 알린다).
 * 계정 삭제 뒤에는 `{ quiet: true }` 로 부른다. 서버에서 이미 지운 계정이라
 * 막힐 이유가 없고, 막혀도 다음 새로고침에 세션이 사라진다.
 */
export async function signOutMember({ quiet = false } = {}) {
  resetRecaptcha();
  try {
    await signOut(auth);
  } catch (error) {
    if (!quiet) throw error;
  }
}
