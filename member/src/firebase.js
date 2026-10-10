/**
 * 회원 앱의 Firebase. 강사 앱과 **같은 프로젝트, 다른 번들**이다.
 *
 * 여기 있는 것은 셋뿐이다: 전화번호 인증 · 연결 함수 호출 · Firestore 핸들.
 * 강사 앱의 `src/lib/firebase.js` 는 1,000줄이 넘고 백업·사진·AI 동의까지
 * 들고 있다 -- 회원이 그것을 내려받을 이유가 없다.
 */

import { initializeApp } from "firebase/app";
import {
  RecaptchaVerifier, getAuth, onAuthStateChanged, signInWithPhoneNumber, signOut,
} from "firebase/auth";
import { getFirestore } from "firebase/firestore/lite";
import { getFunctions, httpsCallable } from "firebase/functions";
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
export const auth = getAuth(app);
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

/** 로그아웃. 다음 사람이 이 기기에서 인증할 때 쓸 reCAPTCHA 도 새로 만든다. */
export async function signOutMember() {
  resetRecaptcha();
  await signOut(auth);
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
