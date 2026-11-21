/**
 * 정산 점검 (2026-11-22 대표 승인: "밤 점검 + 대표 점검함", 외부 검토 반영). 순수 함수다.
 *
 * 무엇을 보나 -- 강사 일은 늘리지 않는다. 서버가 이미 있는 기록끼리 맞춰 본다.
 *   - unsettled_past         지난 수업(어제까지)인데 출석 · 취소 처리가 없다 ............ 확인 (경고)
 *   - completed_no_deduct    "완료" 인데 그 수업의 차감 기록이 하나도 없다 ................ 차단
 *   - deduct_short           회원 수보다 차감 기록이 적다 (듀엣 한쪽 실패 의심) ........... 확인
 *   - balance_mismatch       남은 횟수와 원장 합이 다르다 -- 이 달에 쓴 회원권이면 차단, 아니면 확인
 *   - duplicate_deduct       같은 강사 · 회원 · 시각에 다른 수업으로 두 번 차감 ............ 확인
 * 차단 항목은 "확인함 + 사유" 를 남기면 풀린다 -- 같은 건 · 같은 내용(signature)일 때만. 숫자가 바뀌면 다시 뜬다.
 *
 * "없음" 과 "못 읽음" 은 다르다: 읽기 하나라도 실패하면 complete=false (점검 미완료) -- 0건으로 보이지 않는다.
 * 일정 동기화가 꺼진 강사는 서버에 예정 수업이 없어 미처리를 볼 수 없다 -- 범위(scope)에 이름으로 남긴다.
 */
import { reconcilePass, RECONCILE_STATE } from "./pass-reconcile.mjs";
import { kstMonthRange } from "./pay-close.mjs";

const text = (value) => String(value ?? "").trim();
const KST_OFFSET_MS = 9 * 3600000;
export const PAY_CHECK_ITEM_LIMIT = 300;

export const CHECK_KIND = Object.freeze({
  UNSETTLED_PAST: "unsettled_past",
  COMPLETED_NO_DEDUCT: "completed_no_deduct",
  DEDUCT_SHORT: "deduct_short",
  BALANCE_MISMATCH: "balance_mismatch",
  DUPLICATE_DEDUCT: "duplicate_deduct",
});
export const CHECK_SEVERITY = Object.freeze({ BLOCK: "block", WARN: "warn" });
export const CHECK_KIND_LABELS = Object.freeze({
  [CHECK_KIND.UNSETTLED_PAST]: "지난 수업 미처리",
  [CHECK_KIND.COMPLETED_NO_DEDUCT]: "완료했는데 차감 없음",
  [CHECK_KIND.DEDUCT_SHORT]: "차감이 회원 수보다 적음",
  [CHECK_KIND.BALANCE_MISMATCH]: "남은 횟수 불일치",
  [CHECK_KIND.DUPLICATE_DEDUCT]: "중복 차감 의심",
});

const millisOf = (value) => {
  if (!value) return NaN;
  if (value instanceof Date) return value.getTime();
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.seconds === "number") return value.seconds * 1000;
  return new Date(value).getTime();
};

/** 한국 시각 오늘 0시. 그 전에 시작한 수업이 "지난 수업" 이다 (오늘 수업은 오늘 처리하면 된다). */
export function kstTodayStart(now) {
  const at = millisOf(now) + KST_OFFSET_MS;
  return new Date(Math.floor(at / 86400000) * 86400000 - KST_OFFSET_MS);
}

/** 확인함 문서 id (점검 항목 key 에는 ':' 가 들어간다 -- 문서 id 에는 '/' 만 안 된다). */
export const ackDocId = (month, key) => `${text(month)}__${text(key).replaceAll("/", "_")}`;

/**
 * 한 달 점검.
 * @param {{
 *   organizationId: string, month: string, now: Date,
 *   lessons: any[], monthLedger: any[], passes?: any[], passLedger?: any[],
 *   syncedInstructorIds?: Set<string> | null, activeInstructorIds?: string[], failures?: { source: string, code: string }[],
 *   canonicalInstructorId?: (id: unknown) => string,
 * }} input
 *   lessons = organizations/{센터}/lessons 의 그 달 문서, monthLedger = 그 달 차감 · 보정, passLedger = 회원권별 원장 전부(잔여 검산용)
 */
export function runPayCheck({
  organizationId, month, now, lessons = [], monthLedger = [], passes = [], passLedger = [],
  syncedInstructorIds = null, activeInstructorIds = [], failures = [], canonicalInstructorId = (id) => text(id),
}) {
  const { start, end } = kstMonthRange(month);
  const inMonth = (value) => { const at = millisOf(value); return Number.isFinite(at) && at >= start.getTime() && at < end.getTime(); };
  const todayStart = kstTodayStart(now).getTime();
  const items = [];
  const who = (id) => text(canonicalInstructorId(text(id)));

  /* 차감 기록 -- 수업별 · (강사, 회원, 시각)별. */
  const deducts = monthLedger.filter((entry) => text(entry?.type) === "deduct" && text(entry?.organizationId) === text(organizationId));
  const deductsByLesson = new Map();
  for (const entry of deducts) {
    const lessonId = text(entry.lessonId);
    if (!lessonId) continue;
    if (!deductsByLesson.has(lessonId)) deductsByLesson.set(lessonId, []);
    deductsByLesson.get(lessonId).push(entry);
  }

  for (const lesson of lessons) {
    const lessonId = text(lesson?.lessonId || lesson?.id);
    if (!lessonId || !inMonth(lesson.startsAt)) continue;
    const clientIds = [...new Set((Array.isArray(lesson.clientIds) ? lesson.clientIds : []).map(text).filter(Boolean))];
    const status = text(lesson.status);
    const base = { instructorId: who(lesson.instructorId), locationId: text(lesson.locationId), lessonId, startsAt: millisOf(lesson.startsAt) };
    if (status === "scheduled" && clientIds.length && millisOf(lesson.startsAt) < todayStart) {
      items.push({ ...base, key: `${CHECK_KIND.UNSETTLED_PAST}:${lessonId}`, kind: CHECK_KIND.UNSETTLED_PAST, severity: CHECK_SEVERITY.WARN,
        detail: { members: clientIds.length }, signature: `${base.startsAt}|${clientIds.length}` });
    }
    if (status === "completed") {
      const found = deductsByLesson.get(lessonId) || [];
      if (!found.length) {
        items.push({ ...base, key: `${CHECK_KIND.COMPLETED_NO_DEDUCT}:${lessonId}`, kind: CHECK_KIND.COMPLETED_NO_DEDUCT, severity: CHECK_SEVERITY.BLOCK,
          detail: { members: clientIds.length, deducts: 0 }, signature: `${base.startsAt}|${clientIds.length}|0` });
      } else if (clientIds.length > 1 && new Set(found.map((entry) => text(entry.passId))).size < clientIds.length) {
        /* 듀엣은 회원권마다 하나씩 뺀다. 한 회원권을 둘이 쓰는 듀엣이면 정상이라 "확인" 으로만. */
        items.push({ ...base, key: `${CHECK_KIND.DEDUCT_SHORT}:${lessonId}`, kind: CHECK_KIND.DEDUCT_SHORT, severity: CHECK_SEVERITY.WARN,
          detail: { members: clientIds.length, deducts: found.length }, signature: `${base.startsAt}|${clientIds.length}|${found.length}` });
      }
    }
  }

  /* 같은 강사 · 회원 · 시각에 서로 다른 수업으로 차감 두 번. */
  const bySlot = new Map();
  for (const entry of deducts) {
    if (!inMonth(entry.occurredAt)) continue;
    const slot = `${who(entry.instructorId)}|${text(entry.clientId)}|${millisOf(entry.occurredAt)}`;
    if (!bySlot.has(slot)) bySlot.set(slot, []);
    bySlot.get(slot).push(entry);
  }
  for (const [slot, list] of bySlot) {
    const lessonIds = [...new Set(list.map((entry) => text(entry.lessonId)))].sort();
    if (lessonIds.length < 2) continue;
    const [instructorId, clientId, at] = slot.split("|");
    items.push({ instructorId, locationId: text(list[0].locationId), clientId, startsAt: Number(at),
      key: `${CHECK_KIND.DUPLICATE_DEDUCT}:${slot}`, kind: CHECK_KIND.DUPLICATE_DEDUCT, severity: CHECK_SEVERITY.WARN,
      detail: { deducts: list.length, lessonIds }, signature: lessonIds.join(",") });
  }

  /* 남은 횟수 검산 (기존 pass-reconcile 과 같은 판정). 이 달에 원장이 움직인 회원권이면 급여에 걸리니 차단. */
  const ledgerByPass = new Map();
  for (const entry of passLedger) {
    const passId = text(entry?.passId);
    if (!passId) continue;
    if (!ledgerByPass.has(passId)) ledgerByPass.set(passId, []);
    ledgerByPass.get(passId).push(entry);
  }
  for (const pass of passes) {
    const entries = ledgerByPass.get(text(pass.id)) || [];
    const result = reconcilePass(pass, entries);
    if (result.state !== RECONCILE_STATE.MISMATCHED) continue;
    const touched = entries.some((entry) => ["deduct", "correction"].includes(text(entry.type)) && inMonth(entry.occurredAt));
    items.push({ instructorId: who(pass.instructorId), locationId: text(pass.locationId), passId: result.passId, clientId: result.clientId,
      key: `${CHECK_KIND.BALANCE_MISMATCH}:${result.passId}`, kind: CHECK_KIND.BALANCE_MISMATCH, severity: touched ? CHECK_SEVERITY.BLOCK : CHECK_SEVERITY.WARN,
      detail: { remaining: result.remainingCount, ledgerTotal: result.ledgerTotal, difference: result.difference },
      signature: `${result.remainingCount}|${result.ledgerTotal}` });
  }

  const order = { [CHECK_SEVERITY.BLOCK]: 0, [CHECK_SEVERITY.WARN]: 1 };
  items.sort((left, right) => order[left.severity] - order[right.severity] || (left.startsAt || 0) - (right.startsAt || 0) || left.key.localeCompare(right.key));
  const counts = { block: 0, warn: 0, byKind: /** @type {Record<string, number>} */ ({}) };
  for (const item of items) {
    counts[item.severity] += 1;
    counts.byKind[item.kind] = (counts.byKind[item.kind] || 0) + 1;
  }
  const syncOff = syncedInstructorIds ? [...new Set(activeInstructorIds.map(who))].filter((id) => id && !syncedInstructorIds.has(id)) : [];
  return {
    month: text(month),
    complete: !failures.length,
    failures,
    scope: { lessons: lessons.length, passes: passes.length, syncOffInstructorIds: syncOff },
    counts,
    total: items.length,
    items: items.slice(0, PAY_CHECK_ITEM_LIMIT),
    truncated: items.length > PAY_CHECK_ITEM_LIMIT,
  };
}

/**
 * 확인함을 얹는다. 같은 key · 같은 signature 일 때만 확인된 것으로 -- 내용이 바뀌면 다시 뜬다.
 * @param {ReturnType<typeof runPayCheck>} check
 * @param {any[]} acks  payCheckAcks 문서들
 */
export function withAcks(check, acks = []) {
  const byKey = new Map((acks || []).map((ack) => [text(ack.key), ack]));
  const items = (check?.items || []).map((item) => {
    const ack = byKey.get(item.key);
    return ack && text(ack.signature) === item.signature ? { ...item, ack: { reason: text(ack.reason), by: text(ack.ackedBy), at: ack.ackedAt || null } } : item;
  });
  const openBlocks = items.filter((item) => item.severity === CHECK_SEVERITY.BLOCK && !item.ack).length;
  const openWarns = items.filter((item) => item.severity === CHECK_SEVERITY.WARN && !item.ack).length;
  return { ...check, items, openBlocks, openWarns };
}
