/**
 * 원본 엑셀의 강사누적진행과 **지금 저장된 누적**을 견준다. 읽지도 쓰지도
 * 않는다 -- 셈만 한다 (totals-repair.js 머리말과 같은 이유).
 *
 * ── 무엇을 확인하려는 것인가 ──
 * 이관은 한 행마다 `batch.set` 으로 누적 문서를 **덮어쓴다.** 한 회원에
 * 회원권이 여러 장이면 그만큼 덮어쓰이고 **마지막 행만 남는다.**
 *
 * 옛 양식은 줄마다 그 회원권의 횟수를 적었다 -- 그래서 합이 맞아야 하는데
 * 마지막 한 장만 남았다. 새 양식은 모든 줄에 같은 총합을 적으므로 어느 줄이
 * 이기든 값이 같아 문제가 없다.
 *
 * 이 스크립트는 **고치지 않는다.** 어느 쪽이 참인지는 사람이 본다 -- 엑셀이
 * 틀렸을 수도 있고, 이관 뒤에 실제 수업이 쌓였을 수도 있다.
 */

const text = (value) => String(value ?? "").trim();

/**
 * 엑셀 줄들을 강사–회원 쌍마다 합친다.
 *
 * @param {{
 *   rows?: Array<{ instructorId: string, clientId: string, priorSessions: number,
 *                  partnerClientId?: string, partnerPriorSessions?: number,
 *                  line?: number }>,
 * }} input
 */
export function sheetTotals({ rows } = {}) {
  const sums = new Map();
  const add = (instructorId, clientId, sessions, line) => {
    const instructor = text(instructorId);
    const client = text(clientId);
    if (!instructor || !client) return;
    const key = `${instructor}_${client}`;
    const found = sums.get(key)
      || { instructorId: instructor, clientId: client, sum: 0, max: 0, rows: 0, lines: [] };
    found.sum += Number(sessions) || 0;
    found.max = Math.max(found.max, Number(sessions) || 0);
    found.rows += 1;
    if (line !== undefined) found.lines.push(line);
    sums.set(key, found);
  };

  for (const row of Array.isArray(rows) ? rows : []) {
    add(row?.instructorId, row?.clientId, row?.priorSessions, row?.line);
    /* 듀엣의 짝도 자기 문서를 받는다. 짝의 줄은 따로 없으므로 여기서 세지
       않으면 그 회원은 비교 대상에서 통째로 빠진다. */
    if (text(row?.partnerClientId)) {
      add(row.instructorId, row.partnerClientId, row.partnerPriorSessions, row?.line);
    }
  }
  return sums;
}

/**
 * 엑셀과 저장된 값이 다른 쌍만 뽑는다.
 *
 * `sum` 과 `max` 를 함께 낸다. **둘 중 어느 쪽이 참인지가 곧 양식을 가른다**:
 * 저장된 값이 `max` 와 같으면 덮어쓰기로 마지막 줄만 남은 것이고(옛 양식),
 * `sum` 과 같으면 줄마다 같은 총합을 적은 것이다(새 양식).
 *
 * @param {{
 *   sums?: Map<string, any>,
 *   sessionsOf?: (instructorId: string, clientId: string) => number | null,
 * }} input
 */
export function compareWithStored({ sums, sessionsOf } = {}) {
  const rows = [];
  for (const entry of (sums instanceof Map ? [...sums.values()] : [])) {
    const stored = typeof sessionsOf === "function"
      ? sessionsOf(entry.instructorId, entry.clientId)
      : null;
    const storedCount = stored === null || stored === undefined ? null : Number(stored) || 0;
    /* 한 줄짜리 회원은 sum 과 max 가 같다. 덮어쓰기로 깨질 수 없는 행이라
       저장값이 다르면 그것은 이관 뒤에 쌓인 실제 수업이다. */
    const singleRow = entry.rows === 1;
    rows.push({
      instructorId: entry.instructorId,
      clientId: entry.clientId,
      sheetRows: entry.rows,
      sheetSum: entry.sum,
      sheetMax: entry.max,
      stored: storedCount,
      /* 무엇으로 읽히는가. 사람이 결론을 내릴 때 보는 한 글자다. */
      looksLike: storedCount === null ? "no_total_document"
        : storedCount === entry.sum ? "matches_sum"
          : storedCount === entry.max && !singleRow ? "matches_last_row_only"
            : "neither",
      lines: entry.lines,
    });
  }
  return rows
    .filter((row) => row.looksLike !== "matches_sum")
    .sort((left, right) => left.instructorId.localeCompare(right.instructorId)
      || left.clientId.localeCompare(right.clientId));
}

/** 사람이 읽는 요약. */
export function summarizeAudit(rows, sums) {
  const list = Array.isArray(rows) ? rows : [];
  const total = sums instanceof Map ? sums.size : list.length;
  return {
    pairs: total,
    matching: total - list.length,
    differing: list.length,
    lastRowOnly: list.filter((row) => row.looksLike === "matches_last_row_only").length,
    missingTotals: list.filter((row) => row.looksLike === "no_total_document").length,
    neither: list.filter((row) => row.looksLike === "neither").length,
  };
}
