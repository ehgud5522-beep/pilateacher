/**
 * 이미 찍힌 차감을 **새 규칙으로 다시 계산한다.** 읽지도 쓰지도 않는다 --
 * 셈만 한다 (totals-repair.js 머리말과 같은 이유).
 *
 * ── 왜 어려운가 ──
 * 단가를 정한 것은 그 순간의 **누적 횟수**인데, 원장 항목은 그 숫자를 들고
 * 있지 않다. 들고 있는 것은 금액(unitPrice)과 어느 판정이 이겼는지(rule)
 * 뿐이다 -- 다시 계산하려면 누적을 **되짚어 세워야** 한다.
 *
 * 되짚는 방법은 이렇다. 지금 저장된 누적에서, 기준일 이후 앱이 올린 만큼을
 * 도로 뺀다. 그러면 기준일 아침의 누적이 나온다.
 *
 *   기준일 누적 = 지금 누적 − (기준일 이후 차감 수) + (기준일 이후 보정 수)
 *
 * **옛 코드는 서비스 회차도 올렸다.** 그래서 여기서 빼는 "차감 수" 에는
 * 서비스가 들어간다 -- 그것이 실제로 일어난 일이고, 새 규칙으로 바뀐 코드가
 * 아니라 **그때 돌던 코드**를 되짚는 것이 요점이다.
 *
 * 그 다음 기준일부터 날짜 순으로 걸으면서, 각 차감이 그때 보았을 누적으로
 * 새 단가를 구한다. 새 규칙에서는 서비스가 누적을 올리지 않으므로 걷는 동안의
 * 증가는 결제 회차에서만 일어난다.
 *
 * ── 무엇을 하지 않는가 ──
 * **고치지 않는다.** 원장은 append-only 라 지난 항목의 금액을 고칠 수 없고,
 * 고치는 길은 보정 항목(correction)을 새로 쌓는 것뿐이다 -- 그것은 사람이
 * 보고 정할 일이다. 이 셈은 "얼마나 차이가 나는가" 까지만 답한다.
 */

import {
  resolveDeductionUnitPrice,
} from "../../functions/shared/deduction-pricing.mjs";

const text = (value) => String(value ?? "").trim();
const count = (value) => (Number.isInteger(value) && value >= 0 ? value : 0);

const toDate = (value) => {
  if (!value) return null;
  const at = typeof value?.toDate === "function" ? value.toDate() : new Date(value);
  return Number.isFinite(at?.getTime?.()) ? at : null;
};

/** 차감인가. 보정·발급·양도는 다시 계산할 것이 없다. */
export const isDeduction = (entry) => text(entry?.type) === "deduct";
/** 서비스 회차인가. 새 규칙에서 누적을 올리지 않는 것이 이것이다. */
export const isServiceDeduction = (entry) => isDeduction(entry) && text(entry?.category) === "service";

/**
 * 기준일 아침의 누적. 지금 값에서 그 뒤에 일어난 증감을 되짚는다.
 *
 * **옛 코드 기준으로 되짚는다** -- 서비스도 올렸고 보정은 내렸다. 새 규칙으로
 * 되짚으면 그 사이에 실제로 일어난 일과 어긋난다.
 *
 * @param {{ storedSessions?: number, entriesSince?: Array<any> }} input
 */
export function sessionsAtStart({ storedSessions, entriesSince } = {}) {
  const since = Array.isArray(entriesSince) ? entriesSince : [];
  const bumped = since.filter(isDeduction).length;
  const undone = since.filter((entry) => text(entry?.type) === "correction").length;
  /* 0 아래로는 가지 않는다. 음수가 나오면 되짚기가 틀린 것이고, 그 값으로
     계속 세면 그 뒤가 전부 틀린다 -- 0 에서 멈추고 아래 `clamped` 로 말한다. */
  return Math.max(0, count(storedSessions) - bumped + undone);
}

/**
 * 되짚기가 **0 아래로 내려간 만큼**. 0 이면 들어맞은 것이다.
 *
 * sessionsAtStart 는 음수를 0 으로 눌러 버린다. 누르는 것 자체는 맞다 --
 * 음수로 계속 세면 그 뒤가 전부 틀린다. 그런데 **누른 사실을 말하지 않으면**
 * 그 회원의 새 단가가 "들어맞은 값" 과 똑같은 얼굴로 나온다.
 *
 * 0 보다 크다는 것은 지금 저장된 누적이 원장만으로는 설명되지 않는다는
 * 뜻이다. 콘솔에서 손으로 고친 회원이 여기 걸린다 -- 그 줄의 새 단가는
 * 믿을 수 없고, 사람이 봐야 한다.
 *
 * @param {{ storedSessions?: unknown, entriesSince?: Array<any> }} input
 * @returns {number}
 */
export function rewindShortfall({ storedSessions, entriesSince } = {}) {
  const since = Array.isArray(entriesSince) ? entriesSince : [];
  const bumped = since.filter(isDeduction).length;
  const undone = since.filter((entry) => text(entry?.type) === "correction").length;
  const raw = count(storedSessions) - bumped + undone;
  return raw < 0 ? -raw : 0;
}

/**
 * 강사별 합계. **올라간 것과 내려간 것을 따로 센다** -- 합계만 보면 서로
 * 지워져 "차이 없음" 으로 보이는데, 강사마다는 받을 돈과 돌려줄 돈이 따로다.
 *
 * @param {Array<any>} rows
 * @returns {Array<{ instructorId: string, entries: number, increased: number,
 *   decreased: number, up: number, down: number, difference: number }>}
 */
export function byInstructor(rows) {
  const map = new Map();
  for (const row of (Array.isArray(rows) ? rows : [])) {
    if (row?.skipped || !row?.difference) continue;
    const id = text(row.instructorId);
    const at = map.get(id) || {
      instructorId: id, entries: 0, increased: 0, decreased: 0, up: 0, down: 0, difference: 0,
    };
    at.entries += 1;
    at.difference += row.difference;
    if (row.difference > 0) { at.increased += 1; at.up += row.difference; }
    else { at.decreased += 1; at.down += row.difference; }
    map.set(id, at);
  }
  return [...map.values()].sort((left, right) => Math.abs(right.difference) - Math.abs(left.difference));
}

/**
 * 한 강사–회원 쌍의 차감들을 날짜 순으로 걸으며 새 단가를 구한다.
 *
 * **듀엣은 호출하는 쪽이 적은 쪽을 넘겨준다** (`priorSessionsFor`). 여기서는
 * 쌍 하나만 본다 -- 두 사람의 누적을 동시에 걷는 일은 읽는 쪽이 한다.
 *
 * @param {{
 *   entries?: Array<any>,
 *   startingSessions?: number,
 *   passOf?: (passId: string) => any,
 *   titleOf?: (instructorId: string, at: Date) => string,
 * }} input
 */
export function repriceEntries({ entries, startingSessions, passOf, titleOf } = {}) {
  const ordered = (Array.isArray(entries) ? entries : [])
    .filter(isDeduction)
    .slice()
    .sort((left, right) => {
      const a = toDate(left.occurredAt)?.getTime() ?? 0;
      const b = toDate(right.occurredAt)?.getTime() ?? 0;
      /* 같은 순간이면 문서 id 로 가른다. 순서가 흔들리면 20회째가 어느
         회차인지가 실행할 때마다 달라진다. */
      return a - b || text(left.id).localeCompare(text(right.id));
    });

  let sessions = count(startingSessions);
  const rows = [];
  for (const entry of ordered) {
    const pass = typeof passOf === "function" ? passOf(text(entry.passId)) : null;
    const at = toDate(entry.occurredAt);
    /* 회원권을 못 읽으면 다시 계산하지 않는다. baseUnitPrice 와 계약 금액이
       거기 있고, 지어내면 그 줄의 차액이 거짓이 된다. */
    if (!pass) {
      rows.push({
        entryId: text(entry.id),
        instructorId: text(entry.instructorId),
        clientId: text(entry.clientId),
        occurredAt: at,
        category: text(entry.category),
        oldUnitPrice: count(entry.unitPrice),
        oldRule: text(entry.rule),
        newUnitPrice: null,
        newRule: "",
        difference: null,
        priorSessions: sessions,
        skipped: "pass_missing",
      });
      continue;
    }

    const next = resolveDeductionUnitPrice({
      category: text(entry.category),
      baseUnitPrice: count(entry.baseUnitPrice ?? pass?.baseUnitPrice),
      netContractPrice: pass?.netContractPrice,
      totalSessions: pass?.totalSessions,
      /* 부원장 여부는 **그때의 값**이다. 지금 소속 문서를 읽으면 그 사이에
         바뀐 사람의 지난 회차가 전부 틀리게 다시 계산된다. 원장이 그것을
         들고 있지 않으므로, 그때 이긴 판정으로 되짚는다. */
      isDeputyDirector: text(entry.rule) === "deputy_director",
      title: typeof titleOf === "function" ? titleOf(text(entry.instructorId), at) : "",
      priorSessions: sessions,
      serviceUsedCount: count(entry.serviceUsedCount),
    });

    const oldUnitPrice = count(entry.unitPrice);
    rows.push({
      entryId: text(entry.id),
      instructorId: text(entry.instructorId),
      clientId: text(entry.clientId),
      occurredAt: at,
      category: text(entry.category),
      oldUnitPrice,
      oldRule: text(entry.rule),
      newUnitPrice: next.unitPrice,
      newRule: next.rule,
      difference: next.unitPrice - oldUnitPrice,
      priorSessions: sessions,
      skipped: "",
    });

    // 새 규칙에서는 서비스가 누적을 올리지 않는다.
    if (!isServiceDeduction(entry)) sessions += 1;
  }
  return rows;
}

/** 금액이 달라진 줄만. 같은 줄은 볼 것이 없다. */
export const changedOnly = (rows) => (Array.isArray(rows) ? rows : [])
  .filter((row) => row.skipped || (row.difference !== null && row.difference !== 0));

/** 사람이 읽는 요약. */
export function summarizeReprice(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const priced = list.filter((row) => !row.skipped);
  const changed = priced.filter((row) => row.difference !== 0);
  return {
    entries: list.length,
    changed: changed.length,
    unchanged: priced.length - changed.length,
    skipped: list.filter((row) => row.skipped).length,
    /* 올라간 것과 내려간 것을 따로 센다. 합계만 보면 서로 지워져 "차이 없음"
       으로 보이는데, 강사마다는 받을 돈과 돌려줄 돈이 따로 있다. */
    increased: changed.filter((row) => row.difference > 0).length,
    decreased: changed.filter((row) => row.difference < 0).length,
    totalDifference: changed.reduce((sum, row) => sum + row.difference, 0),
  };
}
