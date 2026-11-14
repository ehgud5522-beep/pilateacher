/**
 * 회원 화면의 세션업 안내 (2026-11-15, 대표 결정). **순수 함수다.**
 *
 * 세션업 = 지금 회원권에 횟수를 더하는 것. 회당 금액이 옛 회차까지 합쳐 다시
 * 나뉘어서(functions/shared/session-up.mjs sessionUpUnitPrice), 다 쓰고 따로 새로
 * 등록하는 것보다 저렴하다 -- 그래서 기간이 있다:
 *
 *   총회차(서비스 제외) 10회 이상 → 6회차까지, 미만 → 3회차까지
 *
 * 회원이 그 기간을 모르면 끝나고 나서야 듣는다. 회원권 카드에 "몇 번 남았는지"
 * 와 "왜 이득인지" 를 함께 적는다.
 *
 * 숫자는 서버 투영의 sessionUpLeft · sessionUpLimit 를 쓴다 (서버는 serviceUsed
 * 까지 보고 센다). 옛 투영에 그 값이 없으면 같은 공유 모듈로 회원권 숫자에서
 * 센다 -- 강사 화면과 한 식이다.
 *
 * left 는 **지금을 포함한** 남은 기회다. 1 이면 지금이 마지막, 0 이면 끝 -- 끝난
 * 회원권에는 아무것도 띄우지 않는다 (지난 혜택을 매번 상기시키지 않는다).
 */
import { sessionUpWindowOf } from "../../functions/shared/session-up.mjs";

export const SESSION_UP_VALUE = "세션업은 지금 회원권에 횟수를 더하는 방식이라, 다 쓰고 새로 등록하는 것보다 회당 금액이 저렴해요.";
export const SESSION_UP_ASK = "원하시면 담당 선생님이나 센터에 말씀해 주세요.";

const count = (value) => (Number.isInteger(Number(value)) && Number(value) >= 0 ? Number(value) : 0);

/** @returns {null | { left: number, limit: number, used: number, last: boolean, title: string, detail: string }} */
export function sessionUpNotice(pass, now = new Date()) {
  if (!pass || String(pass.status ?? "") !== "active") return null;
  /* 만료된 회원권은 늘릴 수 없다 -- 상태가 아직 active 로 남아 있어도 띄우지 않는다. */
  const expires = pass.expiresAt ? new Date(pass.expiresAt?.toDate ? pass.expiresAt.toDate() : pass.expiresAt) : null;
  if (expires && !Number.isNaN(expires.getTime()) && expires.getTime() < now.getTime()) return null;
  if (count(pass.totalSessions) <= 0 || count(pass.remainingCount) <= 0) return null;
  const fromServer = Number.isInteger(pass.sessionUpLeft) && Number.isInteger(pass.sessionUpLimit);
  const window = fromServer ? { left: pass.sessionUpLeft, limit: pass.sessionUpLimit } : sessionUpWindowOf(pass);
  const { left, limit } = window;
  if (!(left > 0) || !(limit > 0)) return null;
  const used = Math.max(0, limit - left + 1);
  const last = left === 1;
  return {
    left, limit, used, last,
    title: last ? "이번이 세션업 마지막 기회예요" : `세션업 기회 ${left}회 남았어요`,
    detail: last
      ? `${limit}회차 수업까지 세션업할 수 있어요 · 다음 수업이 차감되면 기간이 끝나요`
      : `${limit}회차 수업까지 세션업할 수 있어요 · 지금 ${used}회 사용`,
  };
}
