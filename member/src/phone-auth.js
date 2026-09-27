/**
 * 문자 인증. 웹과 네이티브가 **다른 길로 같은 자리**에 도착한다.
 *
 * 도착지는 하나다 -- Firebase **JS SDK** 의 로그인 세션. Firestore 규칙이 보는
 * 토큰과 화면이 읽는 사용자가 같아야 하기 때문이고, 그래서 네이티브에서도
 * `skipNativeAuth: true` 로 둔다. 네이티브는 문자를 보내고 `verificationId` 를
 * 받아 오는 일만 하고, 로그인 자체는 JS 가 한다.
 *
 * ── 왜 네이티브를 쓰나 ──
 * 웹 길은 reCAPTCHA 를 태운다. 앱 안의 웹뷰에서 그것이 뜨면 잔여 횟수 하나를
 * 보려는 사람에게 너무 큰 문턱이고, 실패하면 이유도 안 보인다. 네이티브 길은
 * Play Integrity(Android)·APNs(iOS)로 조용히 끝난다.
 *
 * ── 네이티브 API 는 리스너다 ──
 * 웹의 `signInWithPhoneNumber` 는 `ConfirmationResult` 를 돌려주지만,
 * 플러그인의 같은 이름 메서드는 `Promise<void>` 이고 결과가 이벤트로 온다.
 *
 *   phoneCodeSent              → verificationId. 보통 길.
 *   phoneVerificationCompleted → 문자를 앱이 읽었거나(자동 입력),
 *                                문자 없이 끝났거나(즉시 인증).
 *   phoneVerificationFailed    → message 만 온다. 코드가 없다.
 *
 * ── 즉시 인증이라는 구멍 ──
 * **Android 는 문자 없이 인증이 끝날 수 있다.** 그때 플러그인은
 * `phoneCodeSent` 없이 `phoneVerificationCompleted` 를 던지는데, 거기 실린
 * 자격은 JS 로 넘어오면서 `providerId` 하나만 남는다 --
 * `FirebaseAuthenticationHelper.createCredentialResult` 가 `OAuthCredential`
 * 만 풀어 쓰고 전화 자격은 풀지 않기 때문이다. `verificationId` 도
 * `verificationCode` 도 없다.
 *
 * 즉 **그 갈래에서는 JS 로 로그인할 재료가 없다.** 그냥 두면 화면이 영영
 * "확인하는 중" 이다. 그래서 이것을 고유한 코드로 올려 보내고, 부르는 쪽이
 * 웹 길로 되돌아간다 -- 웹 길은 reCAPTCHA 를 태우는 대신 언제나
 * `ConfirmationResult` 를 준다.
 */

/** 이 단계에서 날 수 있는 실패. 화면이 종류별로 다른 말을 하게 한다. */
export const PHONE_FAILURE = {
  /** 즉시 인증이 끝났는데 JS 가 쓸 재료가 없다. 웹 길로 되돌아간다. */
  INSTANT_UNUSABLE: "phone_instant_verification_unusable",
  /** 네이티브가 인증을 거절했다. 원본 문구를 그대로 들고 온다. */
  NATIVE_FAILED: "phone_native_verification_failed",
  /** 문자는 보냈다는데 verificationId 가 비어 있다. */
  NO_VERIFICATION_ID: "phone_verification_id_missing",
};

/** 진단에 남길 계층. 원본 코드를 이것으로 대체하지 않는다. */
export const PHONE_ERROR_DOMAIN = "capacitor_firebase_phone";

const text = (value) => String(value ?? "").trim();

/** 코드를 달고 던진다. 코드 없는 실패를 만들지 않는다. */
export function phoneAuthError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  error.errorDomain = PHONE_ERROR_DOMAIN;
  return error;
}

/**
 * 지금 네이티브 길로 가야 하는가.
 *
 * @param {{ isNativePlatform?: () => boolean }} [capacitor]
 */
export function isNativePhoneAuth(capacitor) {
  try {
    return Boolean(capacitor?.isNativePlatform?.());
  } catch (_error) {
    /* 판정에 실패하면 웹 길이다 -- 그쪽은 어디서나 돈다. */
    return false;
  }
}

/**
 * 네이티브로 문자를 보내고, 웹과 같은 모양의 `pending` 을 돌려준다.
 *
 * 돌려주는 것에 `.confirm(code)` 가 있어서 부르는 쪽은 웹인지 네이티브인지
 * 몰라도 된다.
 *
 * @param {object} options
 * @param {object} options.plugin `FirebaseAuthentication`
 * @param {(verificationId: string, code: string) => Promise<unknown>} options.signInWithCode
 *   JS SDK 로 실제 로그인하는 함수.
 * @param {string} options.phoneNumber E.164
 * @param {(code: string) => void} [options.onAutoCode] 문자를 앱이 읽었을 때.
 * @param {number} [options.timeout] 초. 0 이면 자동 읽기를 끈다 (Android).
 */
export async function startNativePhoneSignIn({
  plugin, signInWithCode, phoneNumber, onAutoCode, timeout = 60,
}) {
  const handles = [];
  let verificationId = "";
  let settled = false;
  /* 인증이 리스너가 붙기 전에 끝날 수 있다 -- `addListener` 의 핸들은
     마이크로태스크로 오는데 `phoneVerificationFailed` 는 그 전에 난다.
     그때 걷을 목록이 비어 있으면 리스너가 그대로 남고, 다음 시도에서 같은
     이벤트를 두 번 받는다. 그래서 "걷었다" 를 상태로 들고 있다가 늦게
     도착한 핸들도 그 자리에서 걷는다. */
  let detached = false;

  const removeHandle = async (handle) => {
    try { await handle?.remove?.(); } catch (_error) { /* 이미 떨어졌다 */ }
  };

  const detach = async () => {
    detached = true;
    const pending = handles.splice(0, handles.length);
    for (const handle of pending) await removeHandle(handle);
  };

  return new Promise((resolve, reject) => {
    const finish = (run) => (value) => {
      if (settled) return;
      settled = true;
      run(value);
    };

    /* 실패는 리스너를 걷고 끝낸다. 성공은 **걷지 않는다** -- 자동 입력
       이벤트가 `phoneCodeSent` 뒤에 오기 때문이다. 그것까지 받고 나서
       `pending.cancel()` 로 걷는다. */
    const fail = finish((error) => { detach(); reject(error); });
    const succeed = finish(resolve);

    const attach = (name, handler) =>
      Promise.resolve(plugin.addListener(name, handler))
        .then((handle) => {
          if (detached) return removeHandle(handle);
          handles.push(handle);
          return undefined;
        })
        .catch((error) => fail(phoneAuthError(PHONE_FAILURE.NATIVE_FAILED, text(error?.message))));

    attach("phoneCodeSent", (event) => {
      verificationId = text(event?.verificationId);
      if (!verificationId) {
        fail(phoneAuthError(PHONE_FAILURE.NO_VERIFICATION_ID,
          "문자는 보냈다는데 verificationId 가 비어 있습니다."));
        return;
      }
      succeed({
        verificationId,
        confirm: (code) => signInWithCode(verificationId, text(code)),
        cancel: detach,
      });
    });

    attach("phoneVerificationCompleted", (event) => {
      const code = text(event?.verificationCode);
      /* 문자를 앱이 읽었다. verificationId 는 이미 왔고, 화면이 직접 채운다. */
      if (code && verificationId) {
        onAutoCode?.(code);
        return;
      }
      /* 즉시 인증이다 -- 문자가 오지 않았으므로 verificationId 도 없다.
         여기서 멈추면 화면이 영영 기다린다. */
      if (!verificationId) {
        fail(phoneAuthError(PHONE_FAILURE.INSTANT_UNUSABLE,
          "네이티브가 문자 없이 인증을 마쳐 JS 로 이어받을 자격이 없습니다."));
      }
    });

    attach("phoneVerificationFailed", (event) => {
      /* 이 이벤트에는 코드가 없고 문구만 있다. 정제하지 말고 그대로 들고
         간다 -- 이것이 원인을 확정할 수 있는 유일한 재료다. */
      fail(phoneAuthError(PHONE_FAILURE.NATIVE_FAILED, text(event?.message)));
    });

    Promise.resolve(plugin.signInWithPhoneNumber({ phoneNumber, timeout }))
      .catch((error) => fail(phoneAuthError(PHONE_FAILURE.NATIVE_FAILED, text(error?.message))));
  });
}

/** 웹 길로 되돌아가야 하는 실패인가. */
export function shouldFallBackToWeb(error) {
  return text(error?.code) === PHONE_FAILURE.INSTANT_UNUSABLE;
}

/**
 * 화면에 보일 말. **코드는 언제나 함께 보인다** -- 코드 없는
 * "오류가 발생했습니다" 는 회원도 센터도 아무것도 할 수 없게 만든다.
 */
export function phoneFailureMessage(code) {
  const known = {
    "auth/invalid-verification-code": "인증번호가 맞지 않아요. 다시 입력해 주세요.",
    "auth/code-expired": "인증번호가 만료됐어요. 다시 받아 주세요.",
    "auth/invalid-phone-number": "번호를 다시 확인해 주세요.",
    "auth/too-many-requests": "잠시 뒤에 다시 시도해 주세요.",
    "auth/network-request-failed": "연결이 불안정해요. 잠시 뒤에 다시 시도해 주세요.",
    [PHONE_FAILURE.NO_VERIFICATION_ID]: "문자를 보내지 못했어요. 다시 시도해 주세요.",
    [PHONE_FAILURE.NATIVE_FAILED]: "지금 인증하지 못했어요. 잠시 뒤에 다시 시도해 주세요.",
  }[text(code)];
  if (known) return known;
  return `지금 확인하지 못했어요. (코드 ${text(code) || "unknown"})`;
}
