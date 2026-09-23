/**
 * 회원 앱의 Firebase. 강사 앱과 **같은 프로젝트, 다른 번들**이다.
 *
 * 여기 있는 것은 셋뿐이다: 전화번호 인증 · 연결 함수 호출 · Firestore 핸들.
 * 강사 앱의 `src/lib/firebase.js` 는 1,000줄이 넘고 백업·사진·AI 동의까지
 * 들고 있다 -- 회원이 그것을 내려받을 이유가 없다.
 */

import { initializeApp } from "firebase/app";
import {
  RecaptchaVerifier, getAuth, onAuthStateChanged, signInWithPhoneNumber,
} from "firebase/auth";
import { getFirestore } from "firebase/firestore/lite";
import { getFunctions, httpsCallable } from "firebase/functions";

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
export const auth = getAuth(app);
export const db = getFirestore(app);
const functions = getFunctions(app, "asia-northeast3");

/** 한국 번호를 E.164 로. 서버는 토큰의 번호만 믿으므로 여기 값은 편의다. */
export function toE164(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("82")) return `+${digits}`;
  if (digits.startsWith("0")) return `+82${digits.slice(1)}`;
  return `+82${digits}`;
}

/* reCAPTCHA 는 보이지 않게 둔다. 회원에게 "로봇이 아닙니다" 를 시키는 화면은
   잔여 횟수 하나를 보려는 사람에게 너무 큰 문턱이다. 검증 자체는 그대로 돈다. */
let verifier = null;
export function recaptcha(containerId = "recaptcha") {
  if (!verifier) {
    verifier = new RecaptchaVerifier(auth, containerId, { size: "invisible" });
  }
  return verifier;
}

/** 인증번호를 보낸다. 돌려받은 것으로 `confirm(code)` 를 부른다. */
export function sendCode(phone, containerId = "recaptcha") {
  return signInWithPhoneNumber(auth, toE164(phone), recaptcha(containerId));
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
