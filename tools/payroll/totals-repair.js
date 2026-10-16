/**
 * 누적(instructorClientTotals)을 바로잡는 **계산**. 읽기도 쓰기도 하지 않는다.
 *
 * ── 왜 순수 함수인가 ──
 * 이 계산이 틀리면 센터 전체의 급여 단가가 틀어지고, 원장은 append-only 라
 * 되돌릴 수 없다. 프로덕션을 읽어 가며 시험할 수는 없으므로 셈과 입출력을
 * 갈라 둔다 -- 셈은 여기서 테스트하고, 읽고 쓰는 것은 cli.mjs 가 한다.
 *
 * ── 왜 serviceUsed 를 쓰지 않는가 ──
 * 회원권의 `serviceUsed` 에는 **이관 전에 쓴 분량이 섞여 있다.** 그 회차들은
 * 앱이 누적을 올린 적이 없으므로 빼면 안 되는데, 그 수를 회원권만 보고는
 * 가려낼 수 없다. 그래서 원장에 실제로 찍힌 service 차감만 센다 -- 그것이
 * "앱이 누적을 올린 서비스 회차" 와 정확히 같은 집합이다.
 */

const text = (value) => String(value ?? "").trim();
const count = (value) => (Number.isInteger(value) && value >= 0 ? value : 0);

/** 원장 항목이 "앱이 누적을 올린 서비스 차감" 인가. */
export function isCountedServiceDeduction(entry) {
  return text(entry?.type) === "deduct" && text(entry?.category) === "service";
}

/**
 * 빼야 할 수를 강사–회원 쌍마다 센다.
 *
 * **듀엣은 두 사람 모두 뺀다.** 차감이 두 사람의 누적을 모두 올렸기 때문이다
 * (pass-repository 의 clientIds.map). 원장 항목은 대표 한 명만 들고 있으므로
 * 회원권에서 짝을 찾아야 한다 -- `clientIdsOf` 가 그것을 준다.
 *
 * @param {{
 *   entries?: Array<any>,
 *   clientIdsOf?: (passId: string) => Array<string>,
 * }} input
 * @returns {Map<string, { instructorId: string, clientId: string, serviceDeductions: number }>}
 */
export function serviceDeductionsByPair({ entries, clientIdsOf } = {}) {
  const pairs = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!isCountedServiceDeduction(entry)) continue;
    const instructorId = text(entry.instructorId);
    if (!instructorId) continue;
    const passId = text(entry.passId);
    const listed = typeof clientIdsOf === "function" ? clientIdsOf(passId) : null;
    /* 회원권을 못 읽었으면 항목이 든 대표 한 명만 센다. 짝을 지어내지
       않는다 -- 없는 사람의 누적을 빼면 그 회원의 단가가 틀어진다. */
    const clientIds = (Array.isArray(listed) && listed.length ? listed : [text(entry.clientId)])
      .map(text)
      .filter(Boolean);
    for (const clientId of clientIds) {
      const key = `${instructorId}_${clientId}`;
      const found = pairs.get(key) || { instructorId, clientId, serviceDeductions: 0 };
      found.serviceDeductions += 1;
      pairs.set(key, found);
    }
  }
  return pairs;
}

/**
 * 바꿀 문서 목록. **0 아래로는 내리지 않는다.**
 *
 * 누적이 서비스 차감 수보다 적을 수 있다 -- 이관으로 심은 값이 0 인데 그 뒤로
 * 서비스만 한 회원이 그렇다. 음수로 두면 규칙이 그 문서의 모든 쓰기를
 * 거부하고(sessions is int && >= 0), 그때부터 그 회원의 차감이 통째로 막힌다.
 *
 * 깎인 만큼은 `clamped` 로 따로 센다 -- 조용히 0 으로 만들면 "왜 안 맞지" 가
 * 남는다.
 *
 * @param {{
 *   pairs?: Map<string, any>,
 *   sessionsOf?: (instructorId: string, clientId: string) => number | null,
 * }} input
 */
export function planTotalsRepair({ pairs, sessionsOf } = {}) {
  const rows = [];
  for (const pair of (pairs instanceof Map ? [...pairs.values()] : [])) {
    const before = typeof sessionsOf === "function"
      ? sessionsOf(pair.instructorId, pair.clientId)
      : null;
    /* 문서가 없으면 건너뛴다. 만들면 안 된다 -- 없다는 것은 그 강사가 그
       회원을 앱으로 가르친 적이 없다는 뜻이고, 거기에 음수나 0 을 심으면
       있지도 않던 기록이 생긴다. */
    if (before === null || before === undefined) {
      rows.push({ ...pair, before: null, after: null, skipped: "no_total_document" });
      continue;
    }
    const current = count(before);
    const after = Math.max(0, current - pair.serviceDeductions);
    rows.push({
      ...pair,
      before: current,
      after,
      clamped: current - pair.serviceDeductions < 0 ? pair.serviceDeductions - current : 0,
      skipped: "",
    });
  }
  return rows
    .slice()
    .sort((left, right) => left.instructorId.localeCompare(right.instructorId)
      || left.clientId.localeCompare(right.clientId));
}

/** 사람이 읽는 요약. 바꾸기 전에 이 숫자를 먼저 본다. */
export function summarizeRepair(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const changing = list.filter((row) => !row.skipped && row.after !== row.before);
  return {
    pairs: list.length,
    changing: changing.length,
    unchanged: list.filter((row) => !row.skipped && row.after === row.before).length,
    missingTotals: list.filter((row) => row.skipped === "no_total_document").length,
    sessionsRemoved: changing.reduce((sum, row) => sum + (row.before - row.after), 0),
    clamped: list.filter((row) => (row.clamped || 0) > 0).length,
  };
}
