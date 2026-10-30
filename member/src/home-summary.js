/**
 * 홈 카드에 서는 숫자 · 이름 · 날짜를 **한 곳에서** 고른다. 순수 함수다.
 *
 * ── 고친 것 (2026-10-30) ──
 * 이름은 "목록 첫 회원권" 에서, 만료일은 "가장 빨리 끝나는 회원권" 에서,
 * 링의 분모는 그 첫 회원권 한 장에서, 분자는 모든 회원권의 합에서 왔다. 회원권이
 * 두 장 이상이면 이름과 날짜가 서로 다른 회원권을 가리켰고, 링은 비율이 1 을 넘어
 * 잘렸다. 목록 순서는 서버 질의 순서라 정해져 있지도 않았다.
 *
 * 이제 이름과 날짜는 같은 한 장 -- 지금 쓸 수 있는 것 중 **가장 먼저 끝나는**
 * 회원권 -- 에서 온다. 회원이 먼저 신경 써야 할 회원권이 그것이다. 큰 숫자와
 * 링은 쓸 수 있는 회원권 전부의 합이고, 분자와 분모가 같은 범위에서 나온다.
 */

const count = (value) => {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 0;
};

function timeOf(value) {
  if (!value) return Infinity;
  const at = value instanceof Date ? value : new Date(value?.toDate ? value.toDate() : value);
  const ms = at.getTime();
  return Number.isFinite(ms) ? ms : Infinity;
}

/**
 * @param {any} view 투영 문서
 * @param {(pass: any, now: Date) => boolean} isUsable 화면과 같은 판정
 * @param {Date} now
 */
export function homeSummary(view, isUsable, now = new Date()) {
  const passes = Array.isArray(view?.passes) ? view.passes : [];
  const usable = passes.filter((pass) => isUsable(pass, now));
  /* 만료일이 없는 회원권은 맨 뒤. 같으면 남은 횟수가 적은 쪽이 먼저 -- 곧 끝나는
     쪽을 앞에 둔다. */
  const ordered = [...usable].sort((left, right) => (
    timeOf(left?.expiresAt) - timeOf(right?.expiresAt)
    || count(left?.remainingCount) - count(right?.remainingCount)
  ));
  const front = ordered[0] || passes[0] || null;
  const frontUsable = Boolean(ordered[0]);

  const remaining = usable.reduce((sum, pass) => sum + count(pass?.remainingCount), 0);
  const total = usable.reduce(
    (sum, pass) => sum + count(pass?.totalSessions) + count(pass?.serviceSessions), 0,
  );

  return {
    front,
    /* 날짜는 이름과 같은 회원권의 것. 쓸 수 있는 것이 없으면 날짜를 말하지 않는다
       -- 지난 회원권의 만료일을 "…까지" 로 적으면 앞으로의 날짜로 읽힌다. */
    expiresAt: frontUsable ? front?.expiresAt || null : null,
    /* 쓸 수 있는 회원권이 여럿이면 이름 옆에 "외 N장" 을 붙일 수 있게 센다. */
    others: Math.max(0, usable.length - 1),
    remaining,
    ringTotal: total,
  };
}
