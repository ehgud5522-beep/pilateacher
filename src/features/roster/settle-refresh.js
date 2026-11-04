/**
 * 수업 확정 · 되돌리기 뒤에 명단에서 무엇을 다시 읽는가 (2026-11-04 대표).
 *
 * ── 왜 ──
 * 확정할 때마다 명단 전체를 다시 읽었다 -- 회원 · 회원권 전부 · 누적 전부 ·
 * 상품 · 지점 · 강사, 강사 한 명에게 2,350건쯤. 수업 여섯 건이면 하루 만 건을
 * 넘는다. 확정이 실제로 바꾸는 것은 셋뿐이다:
 *
 *   그 회원권        잔여 · 서비스 사용 (듀엣이면 한 장을 둘이 쓴다)
 *   그 누적 문서     {강사}_{회원}. 듀엣이면 두 회원 몫
 *
 * 그래서 그 회원권 id 와 누적 문서만 다시 읽는다. 읽지 못하거나 회원권이 없어졌으면
 * 부르는 쪽이 전처럼 전체를 다시 읽는다 -- 옛 숫자를 보여 주는 것보다 낫다.
 *
 * 판정과 합치기만 여기 있다. 읽기는 pass-repository.js 의 readSettledRosterDocs.
 */

import { passClientIds } from "../../data/schema/pass-clients.js";

const text = (value) => String(value ?? "").trim();

/**
 * 다시 읽을 문서. 확정은 deductions(회원권 id), 되돌리기는 보정한 원장 항목에서
 * 온다 -- 둘 다 "어느 회원권 · 어느 강사" 만 알면 된다.
 *
 * 회원권을 명단에서 못 찾으면 그 회원권의 회원도 모른다. 누적은 빠지고 회원권만
 * 읽는다 -- 다시 읽은 회원권이 회원을 알려 주지만, 그 누적까지 쫓지는 않는다.
 *
 * @param {Array<{ passId: string, instructorId?: string }>} touched
 * @param {Array<any>} passes 명단이 들고 있는 회원권
 * @param {string} [fallbackInstructorId] 항목에 강사가 없을 때 (확정은 지금 강사)
 */
export function settleRefreshTargets(touched, passes, fallbackInstructorId = "") {
  const passIds = [];
  const totals = [];
  for (const item of Array.isArray(touched) ? touched : []) {
    const passId = text(item?.passId);
    if (!passId) continue;
    if (!passIds.includes(passId)) passIds.push(passId);
    const instructorId = text(item?.instructorId) || text(fallbackInstructorId);
    const pass = (Array.isArray(passes) ? passes : []).find((candidate) => text(candidate?.id) === passId);
    if (!instructorId || !pass) continue;
    for (const clientId of passClientIds(pass)) {
      if (!totals.some((total) => total.instructorId === instructorId && total.clientId === clientId)) {
        totals.push({ instructorId, clientId });
      }
    }
  }
  return { passIds, totals };
}

/**
 * id 로 합친다. 다시 읽은 것이 이긴다 -- 나머지는 들고 있던 그대로.
 *
 * @template {{ id?: string }} T
 * @param {Array<T>} current @param {Array<T>} fresh
 * @returns {Array<T>}
 */
export function mergeById(current, fresh) {
  const byId = new Map((Array.isArray(current) ? current : []).map((item) => [text(item?.id), item]));
  for (const item of Array.isArray(fresh) ? fresh : []) byId.set(text(item?.id), item);
  return [...byId.values()];
}

/**
 * 한 번의 가벼운 다시 읽기. 성공하면 합친 회원권 · 누적, 아니면 fallback 신호.
 *
 * @param {{
 *   targets: { passIds: Array<string>, totals: Array<{ instructorId: string, clientId: string }> },
 *   read: (targets: any) => Promise<{ passes: Array<any>, totals: Array<any>, missingPassIds: Array<string>, read: number }>,
 *   current: { passes: Array<any>, totals: Array<any> },
 * }} input
 */
export async function refreshAfterSettlement(input) {
  if (!input.targets.passIds.length) return { status: "nothing", ...input.current, read: 0 };
  try {
    const fresh = await input.read(input.targets);
    if (fresh.missingPassIds.length > 0) {
      return { status: "fallback", ...input.current, read: fresh.read, errorCode: "pass_missing" };
    }
    return {
      status: "refreshed",
      passes: mergeById(input.current.passes, fresh.passes),
      totals: mergeById(input.current.totals, fresh.totals),
      read: fresh.read,
    };
  } catch (error) {
    return { status: "fallback", ...input.current, read: 0, errorCode: error?.code || error?.name || "unknown", error };
  }
}
