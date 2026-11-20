/**
 * 일정 동기화(서버가 기준)가 지금 어떤 상태인지 한 줄로 (2026-11-20).
 *
 * ── 왜 ──
 * 율하 보현 점장 · 현지 부원장 웹에 수업이 하나도 안 떴다. 스위치는 "전체", 폰은 최신, 로그인 ·
 * Firebase 는 정상. 그런데 앱은 받기 상태(syncState)를 기억만 하고 **어디에도 보여 주지 않았다** --
 * 받기가 실패했는지, 받았는데 회원을 못 찾아 버렸는지, 아예 시작을 안 했는지 아무도 가를 수
 * 없었다 (CLAUDE.md 1 · 4: 실패를 숨기지 않는다, 코드와 함께).
 *
 * 순수 함수다. 문구 · 색은 여기서만 정한다.
 */

import { SYNC_WINDOW } from "./schedule-sync.js";

const RANGE = `${SYNC_WINDOW.pastDays}일 전 ~ ${SYNC_WINDOW.futureDays}일 뒤`;

export const SYNC_STATUS_TONE = Object.freeze({ GOOD: "good", WARN: "warn", BAD: "bad", MUTED: "muted" });

const count = (value) => (Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : 0);

/**
 * @param {{
 *   enabled?: boolean, state?: string, errorCode?: string,
 *   received?: number | null, unmatched?: number, organizationMode?: boolean,
 * }} input
 * @returns {{ tone: string, label: string, detail: string } | null} 센터 소속이 아니면 null
 */
export function scheduleSyncStatus(input = {}) {
  if (!input.organizationMode) return null;
  const state = String(input.state || "");
  const code = String(input.errorCode || "").trim();
  if (!input.enabled || state === "off") {
    return { tone: SYNC_STATUS_TONE.MUTED, label: "꺼짐", detail: "이 계정은 다른 기기의 수업 일정을 받지 않아요. 대표의 일정 동기화 스위치를 확인해 주세요." };
  }
  if (state === "error") {
    return { tone: SYNC_STATUS_TONE.BAD, label: "받지 못함", detail: `다른 기기의 수업 일정을 받지 못했어요 (코드 ${code || "unknown"})` };
  }
  if (state === "idle") {
    return { tone: SYNC_STATUS_TONE.MUTED, label: "준비 중", detail: "회원 명부를 읽은 뒤 일정을 받기 시작해요." };
  }
  const received = input.received === null || input.received === undefined ? null : count(input.received);
  if (received === null) {
    return { tone: SYNC_STATUS_TONE.MUTED, label: "받는 중", detail: "서버에서 내 수업 일정을 받고 있어요." };
  }
  const unmatched = count(input.unmatched);
  if (unmatched > 0) {
    return {
      tone: SYNC_STATUS_TONE.WARN,
      label: `받음 ${received}건`,
      detail: `서버의 내 수업 ${received}건을 받았어요. 회원 ${unmatched}명을 이 화면의 명부에서 찾지 못해 그 수업은 그리지 못했어요 (코드 unmatched_clients)`,
    };
  }
  if (received === 0) {
    return {
      tone: SYNC_STATUS_TONE.WARN,
      label: "받음 0건",
      detail: `서버에 내 수업 일정이 없어요 (${RANGE}). 폰에서 넣은 수업이 서버로 올라가지 않았을 수 있어요 (코드 server_empty)`,
    };
  }
  return {
    tone: SYNC_STATUS_TONE.GOOD,
    label: `받음 ${received}건`,
    detail: `서버의 내 수업 ${received}건을 받았어요 (${RANGE}, 확정 전 수업만 새로 그려요).`,
  };
}
