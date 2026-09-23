/**
 * 이 회원이 지금까지 얼마나 왔는가. 회원권 하나가 아니라 전체 여정을 한 줄로.
 *
 * ── 왜 한 줄인가 ──
 * 회원권마다 따로 보여주면 "이번 것 8회 남음" 은 알아도 "이 회원이 우리와 얼마나
 * 왔는가" 는 아무도 모른다. 재등록 상담에서 필요한 것은 뒤쪽이다. 끝난 회원권도
 * 그 줄의 일부이고, 재등록할 때마다 줄이 길어지고 점이 오른쪽으로 기어간다.
 *
 * ── 앱 이전 기록 ──
 * 이관한 회원은 과거 회원권이 없다. 9월 말 잔여와 강사누적진행만 넣었다. 그래서
 * 줄 왼쪽에 회원권 경계 없는 구간 하나를 둔다.
 *
 * 그 길이를 그냥 강사누적진행으로 쓰면 안 된다. 그 값은 이관 뒤로도 차감마다
 * 올라가고, 이관한 회원권에서 쓴 회차까지 이미 세고 있다 -- 그대로 쓰면 그만큼
 * 두 번 그려진다. 앱에서 쓴 것을 빼야 남는 것이 "앱 이전" 이다.
 *
 *   이전 = max(0, 누적 − 앱 회원권에서 쓴 합)
 *
 * 이관하지 않은 회원은 누적이 0 에서 시작해 차감과 함께 오르므로 이 식이 언제나
 * 0 을 준다. 두 경우에 같은 식이 맞는다.
 *
 * ── 기준은 강사-회원 쌍이다 ──
 * 누적이 instructorClientTotals 에서 오고 그것은 강사별로 따로 센다. 담당이
 * 바뀐 회원은 이전 구간이 실제보다 짧게 나온다 -- 화면이 그 기준을 밝혀야 한다
 * (JOURNEY_PRIOR_NOTE).
 *
 * 나중에 회원 전체 누적을 알게 되면 memberSessions 로 넘기면 된다. 그 값이 있으면
 * 강사 기준값 대신 쓰인다 -- 이관 양식에 열 하나가 늘어날 자리다.
 */

import { PASS_STATUS } from "./constants.mjs";

/** 이전 구간이 무엇을 세는지. 화면이 이 문구를 그대로 쓴다. */
export const JOURNEY_PRIOR_NOTE = "앱 이전 기록 (담당 강사 기준)";

const count = (value) => (Number.isInteger(Number(value)) && Number(value) >= 0 ? Number(value) : 0);
const text = (value) => String(value ?? "").trim();

/** 발급 순서. 차수가 먼저이고, 같으면 만든 시각으로 가른다. */
const byIssueOrder = (left, right) => {
  const round = (pass) => count(pass?.purchaseRound);
  if (round(left) !== round(right)) return round(left) - round(right);
  const at = (pass) => {
    const value = pass?.createdAt;
    if (value && typeof value.toDate === "function") return value.toDate().getTime();
    const date = value instanceof Date ? value : new Date(String(value ?? ""));
    return Number.isFinite(date.getTime()) ? date.getTime() : 0;
  };
  return at(left) - at(right);
};

/**
 * @param {{
 *   passes?: Array<any>,
 *   instructorSessions?: number,
 *   memberSessions?: number,
 * }} input
 *   passes            이 회원의 회원권 전부. 끝난 것도 포함한다
 *   instructorSessions 담당 강사 기준 누적 (instructorClientTotals)
 *   memberSessions    회원 전체 기준 누적. 있으면 이 값이 이긴다 (아직 없음)
 */
export function buildPassJourney(input = {}) {
  const all = (Array.isArray(input.passes) ? input.passes : []).filter(Boolean);
  /* 취소된 회원권은 여정이 아니다. 잘못 발급해 되돌린 것이라 그 회차는 일어나지
     않았다 -- 잔여가 0 이라고 다 쓴 것으로 그리면 안 된다. */
  const passes = all
    .filter((pass) => text(pass.status) !== PASS_STATUS.CANCELLED)
    .slice()
    .sort(byIssueOrder);

  const segments = passes.map((pass, index) => {
    const paid = count(pass.totalSessions);
    const service = count(pass.serviceSessions);
    const total = paid + service;
    const remaining = Math.min(count(pass.remainingCount), total);
    return {
      kind: "pass",
      passId: text(pass.id) || text(pass.passId),
      round: count(pass.purchaseRound) || index + 1,
      total,
      paid,
      service,
      used: Math.max(0, total - remaining),
      remaining,
      /* 만료·종료된 회원권에 남은 회차는 쓰이지 못한 것이다. 채우지도 비우지도
         않고 따로 표시해야 "왜 중간이 비었나" 를 묻지 않는다. */
      lapsed: text(pass.status) !== PASS_STATUS.ACTIVE ? remaining : 0,
      active: text(pass.status) === PASS_STATUS.ACTIVE,
    };
  });

  const usedInApp = segments.reduce((sum, segment) => sum + segment.used, 0);
  const cumulative = Number.isInteger(input.memberSessions) && input.memberSessions >= 0
    ? input.memberSessions
    : count(input.instructorSessions);
  const prior = Math.max(0, cumulative - usedInApp);

  const priorSegment = prior > 0
    ? [{ kind: "prior", passId: "", round: 0, total: prior, paid: prior, service: 0, used: prior, remaining: 0, lapsed: 0, active: false }]
    : [];

  const ordered = [...priorSegment, ...segments];
  const grandTotal = ordered.reduce((sum, segment) => sum + segment.total, 0);
  const usedTotal = ordered.reduce((sum, segment) => sum + segment.used, 0);
  /* 진행 중인 회원권. 없으면 0 이고, 화면은 "진행중" 대신 아무 말도 하지 않는다 --
     끝난 회원만 남은 상태에서 "3차 진행중" 이라고 쓰면 거짓이다. */
  const current = segments.filter((segment) => segment.active).pop() || null;

  return {
    segments: ordered,
    prior,
    usedTotal,
    grandTotal,
    currentRound: current ? current.round : 0,
    hasPrior: prior > 0,
    /* 기준을 화면이 말할 수 있게 함께 돌려준다. memberSessions 가 생기면 이
       값이 false 가 되고 문구도 사라진다. */
    priorIsInstructorScoped: prior > 0 && !(Number.isInteger(input.memberSessions) && input.memberSessions >= 0),
  };
}

/** 그릴 것이 있는가. 아무것도 없는 회원에게 빈 줄을 그리지 않는다. */
export const hasJourney = (journey) => (journey?.grandTotal || 0) > 0;
