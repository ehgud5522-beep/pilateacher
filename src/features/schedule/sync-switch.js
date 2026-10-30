/**
 * 일정 동기화 스위치 (2026-10-31, 서버 기준 동기화 2단계). **순수 함수다.**
 *
 * 서버의 일정을 받아 기기에 합치는 것(서버가 기준)을 계정마다 켠다. 대표 결정:
 * 대표 → 강사 한 명 → 전체. 폰도 쓰는 계정은 폰이 새 빌드를 받은 뒤에 켠다
 * (Android 프로덕션 100% · 최소 버전 강제) -- 옛 폰은 일정을 서버에 보내지 않는다.
 *
 * 스위치가 막는 것은 **받기**뿐이다. 보내기(회원 앱에 일정을 올리는 것, 3단계)는
 * 스위치와 상관없이 늘 한다 -- 그것이 꺼지면 회원 앱의 달력이 빈다.
 *
 * **못 읽으면 꺼진 것이다.** 서버가 기기 일정을 바꾸기 시작하는 자리라, 모르면
 * 켜지 않는다. 확정 게이트(settlement-gate.js)와 반대다.
 */

export const SCHEDULE_SYNC_MODE = Object.freeze({ OFF: "off", LISTED: "listed", ALL: "all" });

const text = (value) => String(value ?? "").trim();

export function readScheduleSyncConfig(raw) {
  const mode = Object.values(SCHEDULE_SYNC_MODE).includes(text(raw?.mode)) ? text(raw.mode) : SCHEDULE_SYNC_MODE.OFF;
  const userIds = [...new Set((Array.isArray(raw?.userIds) ? raw.userIds : []).map(text).filter(Boolean))];
  return { mode, userIds };
}

/** 이 계정에 받기를 켤 것인가. */
export function scheduleSyncEnabledFor(raw, userId) {
  const config = readScheduleSyncConfig(raw);
  if (config.mode === SCHEDULE_SYNC_MODE.ALL) return true;
  if (config.mode === SCHEDULE_SYNC_MODE.LISTED) return config.userIds.includes(text(userId));
  return false;
}
