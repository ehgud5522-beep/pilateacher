/**
 * 회원 카드의 "지금 회원권" 줄 (2026-11-08 대표: "수강권 그래프를 강사들이 이해 못함, 나도 잘 안 감").
 * **순수 함수만.**
 *
 * 전에는 카드에도 여정 줄(앱 이전 회색 + 1차 · 2차 … 전부 + 현재 위치 점)을 그렸다. 그 줄은
 * "지금 회원권이 얼마나 남았나" 를 말하지 않고, 아래 "누적 52 / 100회 · 5차 진행중" 도 전체 기준이라
 * 오른쪽 위 "잔여 48회" 와 이어지지 않았다.
 *
 * 카드는 이제 **지금 쓰는 회원권만** 말한다: "이번 회원권 · 5번째 등록" · "20회 중 12회 사용" · 막대 하나.
 * 회원권마다의 이력은 회원 상세(MemberPassProgress · passHistoryRows)에 있다.
 *
 * ── 미리 끊은 다음 회원권 (대표: "기존 수강권에 보통 미리 끊는 경우가 많음, 구분해서 표시") ──
 * 쓰는 중인 회원권 뒤에 아직 한 번도 안 쓴 회원권이 있으면 그것은 "다음 회원권 · 대기" 다. 합치지
 * 않는다 -- 합치면 "40회 중 12회 사용" 이 되어 지금 회원권이 곧 끝난다는 사실이 사라진다.
 * 판정: 발급 순서대로 놓고, 한 번이라도 쓴 회원권(없으면 맨 앞 하나)까지가 "지금", 그 뒤의 안 쓴 것이 "대기".
 */

const count = (value) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Math.floor(Number(value)) : 0);

/**
 * @param {any} journey buildPassJourney 의 결과 (segments 는 발급 순서)
 * @returns {null | { passes: number, total: number, used: number, remaining: number, round: number,
 *   ratio: number, title: string, usage: string,
 *   waiting: null | { passes: number, total: number, label: string } }}
 */
export function currentPassUsage(journey) {
  const active = (Array.isArray(journey?.segments) ? journey.segments : [])
    .filter((segment) => segment?.kind === "pass" && segment.active && count(segment.total) > 0);
  if (active.length === 0) return null;

  /* 마지막으로 쓴 회원권까지가 "지금". 아무것도 안 썼으면 맨 앞 하나. */
  let lastUsed = -1;
  active.forEach((segment, index) => { if (count(segment.used) > 0) lastUsed = index; });
  const cut = Math.max(0, lastUsed) + 1;
  const now = active.slice(0, cut);
  const later = active.slice(cut);

  const total = now.reduce((sum, segment) => sum + count(segment.total), 0);
  const used = now.reduce((sum, segment) => sum + Math.min(count(segment.used), count(segment.total)), 0);
  const remaining = Math.max(0, total - used);
  const round = count(now[now.length - 1]?.round) || count(journey?.currentRound);
  const title = now.length > 1
    ? `사용 중인 회원권 ${now.length}개`
    : round > 1 ? `이번 회원권 · ${round}번째 등록` : "이번 회원권";

  const waitingTotal = later.reduce((sum, segment) => sum + count(segment.total), 0);
  const waiting = later.length > 0 ? {
    passes: later.length,
    total: waitingTotal,
    label: later.length > 1 ? `다음 회원권 ${later.length}개 · ${waitingTotal}회 대기` : `다음 회원권 · ${waitingTotal}회 대기`,
  } : null;

  return {
    passes: now.length,
    total,
    used,
    remaining,
    round,
    ratio: total > 0 ? used / total : 0,
    title,
    usage: `${total}회 중 ${used}회 사용`,
    waiting,
  };
}

/**
 * 회원 상세의 "등록 이력" 줄 (2026-11-16 대표: "남은 횟수 그래프가 이해하기 힘듦, 더 직관적이고 쉽게").
 *
 * 전에는 여정 전체를 가는 선 하나에 이어 그리고 그 위에 점을 찍었다 -- 회원권 경계 · 서비스 빗금 ·
 * 만료 회색이 한 선에 섞여, "누적 11 / 171회 · 4차 진행중" 을 읽어야 무엇인지 알 수 있었다.
 * 이제는 회원권마다 한 줄로 말한다: "4차 · 20회 · 9회 남음 (사용 중)". 최근 것이 위.
 *
 * @param {any} journey buildPassJourney 의 결과
 * @returns {{ rows: Array<{ key: string, label: string, detail: string, state: "using"|"waiting"|"done"|"lapsed"|"prior" }>,
 *   usedTotal: number, passCount: number }}
 */
export function passHistoryRows(journey) {
  const segments = Array.isArray(journey?.segments) ? journey.segments : [];
  /* "대기" 는 currentPassUsage 와 같은 판정: 사용 중인 회원권을 발급 순서로 놓고, 마지막으로 쓴 것(없으면
     맨 앞 하나)까지가 지금, 그 뒤의 안 쓴 것이 미리 끊어 둔 대기다. */
  const active = segments.filter((segment) => segment?.kind === "pass" && segment.active && count(segment.total) > 0);
  let lastUsed = -1;
  active.forEach((segment, index) => { if (count(segment.used) > 0) lastUsed = index; });
  const waiting = new Set(active.slice(Math.max(0, lastUsed) + 1));
  const rows = segments.map((segment, index) => {
    if (segment?.kind === "prior") {
      return { key: "prior", label: "앱 이전 기록", detail: `${count(segment.total)}회 수업`, state: "prior" };
    }
    const total = count(segment?.total);
    const used = Math.min(count(segment?.used), total);
    const left = Math.max(0, total - used);
    const round = count(segment?.round) || index + 1;
    const service = count(segment?.service);
    const key = String(segment?.passId || index);
    const label = `${round}차 · ${total}회${service ? ` (서비스 ${service})` : ""}`;
    if (segment?.active) {
      return waiting.has(segment)
        ? { key, label, detail: `대기 · ${left}회`, state: "waiting" }
        : { key, label, detail: `${left}회 남음`, state: "using" };
    }
    const lapsed = count(segment?.lapsed);
    return lapsed > 0
      ? { key: String(segment.passId || index), label, detail: `끝남 · ${lapsed}회 못 씀`, state: "lapsed" }
      : { key: String(segment.passId || index), label, detail: "다 씀", state: "done" };
  });
  return {
    rows: rows.reverse(),
    usedTotal: count(journey?.usedTotal),
    passCount: segments.filter((segment) => segment?.kind === "pass").length,
  };
}
