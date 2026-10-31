/**
 * 일정을 서버에 보낼 것인가 · 처음 열 때 무엇을 올릴 것인가 (2026-10-31, 폰 출시 전).
 * **순수 함수다.**
 *
 * ── 폰은 스위치 하나로 보내기 · 받기를 함께 ──
 * 폰 출시 직후 폰에만 있던 일정이 한꺼번에 서버로 올라가면, 센터가 PC 에 넣어 둔 같은
 * 수업과 겹쳐 회원 앱에 두 번 보인다. 그래서 **폰은 스위치가 켜진 계정만** 보내고
 * 받는다. 꺼진 계정의 폰은 지금(1.1.43)처럼 기기에만 저장한다. 웹은 3단계부터 늘
 * 보내 왔고 회원 앱 달력이 그것에 달려 있어 그대로 둔다.
 * (확정 -- 원장 차감 -- 은 일정 동기화가 아니다. 스위치와 상관없이 지금처럼 한다.)
 *
 * ── 스위치가 켜진 계정의 첫 실행 ──
 * 서버 일정을 먼저 받는다 → 같은 날 · 시각 · 회원인 서버 수업이 있는 기기 일정은 "중복
 * 의심" 으로 보여 주고 **올리지 않는다** → 나머지만 올린다. 지우지는 않는다.
 */

export const INITIAL_SYNC = Object.freeze({
  /** 스위치를 아직 못 읽었다. 기다린다. */
  WAIT: "wait",
  /** 폰 · 스위치 꺼짐: 아무것도 올리지 않는다. */
  SKIP: "skip",
  /** 웹 · 스위치 꺼짐: 지금처럼 바로 올린다 (받기는 없다). */
  UPLOAD_NOW: "upload_now",
  /** 스위치 켜짐: 처음 받은 뒤 중복을 빼고 올린다. */
  AFTER_PULL: "after_pull",
});

/** 이 기기가 일정을 서버에 보내도 되는가. 스위치를 못 읽은 폰은 보내지 않는다. */
export function schedulePublishAllowed({ native = false, syncOn = false } = {}) {
  return !native || syncOn === true;
}

/** 앱을 열 때 맞추기를 어떻게 할 것인가. */
export function initialSyncMode({ native = false, syncOn = false, configLoaded = false } = {}) {
  if (!configLoaded) return INITIAL_SYNC.WAIT;
  if (syncOn) return INITIAL_SYNC.AFTER_PULL;
  if (native) return INITIAL_SYNC.SKIP;
  return INITIAL_SYNC.UPLOAD_NOW;
}

/**
 * 처음 받은 뒤 올릴 것. 서버의 다른 수업과 겹치는(중복 의심) 기기 일정은 남긴다.
 * @param {{ upcoming: Array<any>, duplicates: Array<{ serverId: string, localId: string }> }} input
 */
export function initialUploadPlan({ upcoming = [], duplicates = [] } = {}) {
  const held = new Set((Array.isArray(duplicates) ? duplicates : []).map((pair) => String(pair?.localId || "")));
  const list = Array.isArray(upcoming) ? upcoming : [];
  return {
    upload: list.filter((entry) => !held.has(String(entry?.id || ""))),
    held: list.filter((entry) => held.has(String(entry?.id || ""))),
  };
}

/**
 * 본인 일정 · 메모(3단계)를 서버와 주고받아도 되는가. **웹 · 폰 모두 스위치가 켜진
 * 계정만** -- 센터 수업과 달리 웹도 꺼지면 아무것도 쓰지 않는다. 스위치는
 * runtimeConfig/privateSync (센터 수업과 따로, 처음에는 꺼짐).
 */
export function privateSyncAllowed({ syncOn = false } = {}) {
  return syncOn === true;
}
