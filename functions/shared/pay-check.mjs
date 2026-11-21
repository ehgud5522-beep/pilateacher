/**
 * 정산 점검 (2026-11-22 대표 승인: "밤 점검 + 대표 점검함", 외부 검토 2회 반영). 순수 함수다.
 *
 * 무엇을 보나 -- 강사 일은 늘리지 않는다. 서버가 이미 있는 기록끼리 맞춰 본다.
 *   - unsettled_past         지난 수업(어제까지)인데 출석 · 취소 처리가 없다 ............ 확인
 *   - completed_no_deduct    "완료" 인데 그 수업의 차감 기록이 하나도 없다 ................ 차단
 *   - deduct_short           회원 수보다 차감 기록이 적다 (듀엣 한쪽 실패 의심) ........... 확인
 *   - balance_mismatch       남은 횟수와 원장 합이 다르다 -- 이 달에 쓴 회원권이면 차단, 아니면 확인
 *   - balance_unknown        검산 불가 (원장 없음 · 숫자를 못 읽음) -- 이 달에 쓴 회원권이면 차단, 아니면 확인.
 *                            정상으로 치지 않는다 (검토: 잔여 10회 · 원장 없음이 "문제 0건" 으로 나왔다)
 *   - duplicate_deduct       같은 강사 · 회원 · 시각에 다른 수업으로 두 번 차감 ............ 확인
 *
 * 확인함은 같은 key · 같은 signature 일 때만 유지된다. signature 에는 판단에 쓴 값을 모두 넣는다 -- 회원 · 강사 · 회원권 ·
 * 원장 항목 id 까지 (검토: 회원 A 를 B 로 바꿔도 인원수가 같으면 A 에 남긴 확인이 B 에 붙었다).
 * 차단 여부(openBlocks)는 **전체 항목**으로 센다 -- 보여 주는 목록만 자른다, 차단 항목은 자르지 않는다
 * (검토: 300건에서 먼저 자르고 세서 301번째 차단이 사라졌다).
 * "없음" 과 "못 읽음" 은 다르다: 읽기 하나라도 실패하면 complete=false (점검 미완료).
 */
import { reconcilePass, RECONCILE_STATE } from "./pass-reconcile.mjs";
import { kstMonthRange } from "./pay-close.mjs";

const text = (value) => String(value ?? "").trim();
const KST_OFFSET_MS = 9 * 3600000;
/** 문서 하나에 담는 확인 항목 수. 차단 항목은 이 수와 상관없이 전부 담는다. */
export const PAY_CHECK_WARN_LIMIT = 300;
/** 차단 항목이 이보다 많으면 문서에 다 못 담는다 -- 점검 미완료로 둔다 (확정 못 함). */
export const PAY_CHECK_BLOCK_LIMIT = 1500;

export const CHECK_KIND = Object.freeze({
  UNSETTLED_PAST: "unsettled_past",
  COMPLETED_NO_DEDUCT: "completed_no_deduct",
  DEDUCT_SHORT: "deduct_short",
  BALANCE_MISMATCH: "balance_mismatch",
  BALANCE_UNKNOWN: "balance_unknown",
  DUPLICATE_DEDUCT: "duplicate_deduct",
});
export const CHECK_SEVERITY = Object.freeze({ BLOCK: "block", WARN: "warn" });
export const CHECK_KIND_LABELS = Object.freeze({
  [CHECK_KIND.UNSETTLED_PAST]: "지난 수업 미처리",
  [CHECK_KIND.COMPLETED_NO_DEDUCT]: "완료했는데 차감 없음",
  [CHECK_KIND.DEDUCT_SHORT]: "차감이 회원 수보다 적음",
  [CHECK_KIND.BALANCE_MISMATCH]: "남은 횟수 불일치",
  [CHECK_KIND.BALANCE_UNKNOWN]: "남은 횟수 검산 불가",
  [CHECK_KIND.DUPLICATE_DEDUCT]: "중복 차감 의심",
});

const millisOf = (value) => {
  if (!value) return NaN;
  if (value instanceof Date) return value.getTime();
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.seconds === "number") return value.seconds * 1000;
  return new Date(value).getTime();
};
const sorted = (list) => [...new Set((list || []).map(text).filter(Boolean))].sort();
const entryIdOf = (entry) => text(entry?.id) || `${text(entry?.passId)}/${text(entry?.lessonId)}/${text(entry?.type)}`;

/** 한국 시각 오늘 0시. 그 전에 시작한 수업이 "지난 수업" 이다. */
export function kstTodayStart(now) {
  const at = millisOf(now) + KST_OFFSET_MS;
  return new Date(Math.floor(at / 86400000) * 86400000 - KST_OFFSET_MS);
}

/** 확인함 문서 id (key 에는 ':' 가 들어간다 -- 문서 id 에는 '/' 만 안 된다). */
export const ackDocId = (month, key) => `${text(month)}__${text(key).replaceAll("/", "_")}`;

/** FNV-1a 32비트 -- 자료 지문용 (암호용 아님). */
function hash(textValue) {
  let value = 0x811c9dc5;
  for (let index = 0; index < textValue.length; index += 1) {
    value ^= textValue.charCodeAt(index);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value.toString(16).padStart(8, "0");
}
/** djb2 32비트 -- FNV 와 함께 써서 우연히 같은 값이 나올 가능성을 줄인다. */
function hash2(textValue) {
  let value = 5381;
  for (let index = 0; index < textValue.length; index += 1) value = (Math.imul(value, 33) + textValue.charCodeAt(index)) >>> 0;
  return value.toString(16).padStart(8, "0");
}
/**
 * 확인함 기준값 -- 판단에 쓴 값을 모두 넣되 **고정 길이**로 (검토: 원장 id 를 이어 붙이면 기록 많은 회원권에서 규칙 2,000자를 넘어 확인함을 못 남겼다).
 * 내용이 조금이라도 바뀌면 달라진다.
 */
export const signatureOf = (raw) => `${String(raw).length.toString(36)}-${hash(String(raw))}${hash2(String(raw))}`;

/**
 * 점검 · 급여 계산에 쓴 자료의 지문. 급여 확정 트랜잭션이 같은 자료를 다시 읽어 이것과 견준다 --
 * 재점검과 확정 사이에 차감 · 보정 · 수업 상태 · 그룹 급여가 바뀌었으면 거절한다 (검토 지적 3).
 * @param {{ monthLedger?: any[], lessons?: any[], groupRows?: any[], passes?: any[], passLedger?: any[] }} input
 */
export function sourceFingerprint({ monthLedger = [], lessons = [], groupRows = [], passes = [], passLedger = [] }) {
  const ledgerLine = (entry) => `${entryIdOf(entry)}:${text(entry.type)}:${Number(entry.delta) || 0}:${Number(entry.unitPrice) || 0}:${text(entry.instructorId)}:${text(entry.clientId)}:${text(entry.lessonId)}:${millisOf(entry.occurredAt)}`;
  const ledger = monthLedger.map(ledgerLine).sort();
  /* 점검이 쓰는 수업 칸 전부: 상태 · 회원 · 강사 · 시각 · 정산 회원권 · 지점 (검토: 강사 · 시간 · 정산 회원권이 빠져 있었다). */
  const lessonRows = lessons.map((lesson) => [text(lesson.lessonId || lesson.id), text(lesson.status), sorted(lesson.clientIds).join("+"), text(lesson.instructorId),
    millisOf(lesson.startsAt), text(lesson.settledPassId), text(lesson.locationId)].join(":")).sort();
  const groups = groupRows.map((row) => `${text(row.locationId)}:${text(row.instructorId)}:${Number(row.fullCount) || 0}:${Number(row.fullRate) || 0}:${Number(row.emptyCount) || 0}`).sort();
  /* 잔여 검산이 쓰는 것: 회원권의 남은 횟수 · 담당 · 회원, 그리고 회원권 원장 전부 (검토: 점검 뒤 잔여가 8 → 7 로 바뀌어도 확정이 통과했다). */
  const passRows = passes.map((pass) => `${text(pass.id)}:${String(pass.remainingCount)}:${text(pass.clientId)}:${text(pass.instructorId)}:${text(pass.locationId)}`).sort();
  const passLedgerRows = passLedger.map(ledgerLine).sort();
  const pack = (rows) => `${rows.length}-${hash(rows.join("|"))}${hash2(rows.join("|"))}`;
  return { ledger: pack(ledger), lessons: pack(lessonRows), groups: pack(groups), passes: pack(passRows), passLedger: pack(passLedgerRows) };
}

export const FINGERPRINT_PARTS = Object.freeze(["ledger", "lessons", "groups", "passes", "passLedger"]);
export const sameFingerprint = (left, right) => Boolean(left && right) && FINGERPRINT_PARTS.every((key) => text(left[key]) === text(right[key]));

/**
 * 한 달 점검 -- **전체 항목** 을 돌려준다 (자르기는 storedCheck 가 한다).
 * @param {{
 *   organizationId: string, month: string, now: Date,
 *   lessons: any[], monthLedger: any[], passes?: any[], passLedger?: any[],
 *   rosterInstructorIds?: string[], failures?: { source: string, code: string }[],
 *   canonicalInstructorId?: (id: unknown) => string,
 * }} input
 */
export function runPayCheck({
  organizationId, month, now, lessons = [], monthLedger = [], passes = [], passLedger = [],
  rosterInstructorIds = [], failures = [], canonicalInstructorId = (id) => text(id),
}) {
  const { start, end } = kstMonthRange(month);
  const inMonth = (value) => { const at = millisOf(value); return Number.isFinite(at) && at >= start.getTime() && at < end.getTime(); };
  const todayStart = kstTodayStart(now).getTime();
  const items = [];
  const who = (id) => text(canonicalInstructorId(text(id)));

  const deducts = monthLedger.filter((entry) => text(entry?.type) === "deduct" && text(entry?.organizationId) === text(organizationId));
  const deductsByLesson = new Map();
  for (const entry of deducts) {
    const lessonId = text(entry.lessonId);
    if (!lessonId) continue;
    if (!deductsByLesson.has(lessonId)) deductsByLesson.set(lessonId, []);
    deductsByLesson.get(lessonId).push(entry);
  }

  const scheduledInstructors = new Set();
  for (const lesson of lessons) {
    const lessonId = text(lesson?.lessonId || lesson?.id);
    if (!lessonId || !inMonth(lesson.startsAt)) continue;
    const instructorId = who(lesson.instructorId);
    if (instructorId) scheduledInstructors.add(instructorId);
    const clientIds = sorted(lesson.clientIds);
    const status = text(lesson.status);
    const startsAt = millisOf(lesson.startsAt);
    const base = { instructorId, locationId: text(lesson.locationId), lessonId, startsAt, clientIds };
    const who4 = `${startsAt}|${instructorId}|${clientIds.join("+")}`;
    if (status === "scheduled" && clientIds.length && startsAt < todayStart) {
      items.push({ ...base, key: `${CHECK_KIND.UNSETTLED_PAST}:${lessonId}`, kind: CHECK_KIND.UNSETTLED_PAST, severity: CHECK_SEVERITY.WARN,
        detail: { members: clientIds.length }, signature: signatureOf(who4) });
    }
    if (status === "completed") {
      const found = deductsByLesson.get(lessonId) || [];
      const evidence = found.map((entry) => `${entryIdOf(entry)}@${text(entry.passId)}`).sort().join(",");
      if (!found.length) {
        items.push({ ...base, key: `${CHECK_KIND.COMPLETED_NO_DEDUCT}:${lessonId}`, kind: CHECK_KIND.COMPLETED_NO_DEDUCT, severity: CHECK_SEVERITY.BLOCK,
          detail: { members: clientIds.length, deducts: 0 }, signature: signatureOf(`${who4}|${text(lesson.settledPassId)}|none`) });
      } else if (clientIds.length > 1 && new Set(found.map((entry) => text(entry.passId))).size < clientIds.length) {
        /* 듀엣은 회원권마다 하나씩 뺀다. 한 회원권을 둘이 쓰는 듀엣이면 정상이라 "확인" 으로만. */
        items.push({ ...base, key: `${CHECK_KIND.DEDUCT_SHORT}:${lessonId}`, kind: CHECK_KIND.DEDUCT_SHORT, severity: CHECK_SEVERITY.WARN,
          detail: { members: clientIds.length, deducts: found.length }, signature: signatureOf(`${who4}|${evidence}`) });
      }
    }
  }

  const bySlot = new Map();
  for (const entry of deducts) {
    if (!inMonth(entry.occurredAt)) continue;
    const slot = `${who(entry.instructorId)}|${text(entry.clientId)}|${millisOf(entry.occurredAt)}`;
    if (!bySlot.has(slot)) bySlot.set(slot, []);
    bySlot.get(slot).push(entry);
  }
  for (const [slot, list] of bySlot) {
    const lessonIds = sorted(list.map((entry) => entry.lessonId));
    if (lessonIds.length < 2) continue;
    const [instructorId, clientId, at] = slot.split("|");
    items.push({ instructorId, locationId: text(list[0].locationId), clientId, clientIds: [clientId], startsAt: Number(at),
      key: `${CHECK_KIND.DUPLICATE_DEDUCT}:${slot}`, kind: CHECK_KIND.DUPLICATE_DEDUCT, severity: CHECK_SEVERITY.WARN,
      detail: { deducts: list.length, lessonIds }, signature: signatureOf(list.map((entry) => `${entryIdOf(entry)}@${text(entry.lessonId)}`).sort().join(",")) });
  }

  /* 남은 횟수 검산 (pass-reconcile 와 같은 판정). 이 달에 원장이 움직인 회원권이면 급여에 걸리니 차단.
     회원권이나 원장을 못 읽었으면 **검산 자체를 건너뛴다** -- 못 읽은 원장을 "원장 없음" 으로 치면 모든 회원권이 검산 불가로 쏟아진다
     (2026-11-22 실제로: 원장 읽기가 색인 없음(코드 9)으로 실패해 회원권 1,340개가 전부 검산 불가 1,853건으로 떴다). 점검 미완료로 남는다. */
  const balanceSkipped = failures.some((failure) => ["passes", "ledger_all"].includes(text(failure?.source)));
  let noLedgerPasses = 0;
  const ledgerByPass = new Map();
  for (const entry of passLedger) {
    const passId = text(entry?.passId);
    if (!passId) continue;
    if (!ledgerByPass.has(passId)) ledgerByPass.set(passId, []);
    ledgerByPass.get(passId).push(entry);
  }
  for (const pass of balanceSkipped ? [] : passes) {
    const entries = ledgerByPass.get(text(pass.id)) || [];
    const result = reconcilePass(pass, entries);
    if (result.state === RECONCILE_STATE.MATCHED) continue;
    /* 원장이 하나도 없는 회원권 = 앱 이전에 만든 옛 회원권 (앱에서 발급하면 발급 기록이 있다). 이 달에 쓴 적도 없으니(쓰면 원장이 생긴다)
       급여에 걸리지 않는다 -- 한 줄씩 보이지 않고 개수만 범위에 남긴다. 숫자를 못 읽는 경우는 그대로 항목으로. */
    if (!entries.length && result.unknownReason === "no_ledger") { noLedgerPasses += 1; continue; }
    const touched = entries.some((entry) => ["deduct", "correction"].includes(text(entry.type)) && inMonth(entry.occurredAt));
    const unknown = result.state !== RECONCILE_STATE.MISMATCHED;
    const kind = unknown ? CHECK_KIND.BALANCE_UNKNOWN : CHECK_KIND.BALANCE_MISMATCH;
    items.push({ instructorId: who(pass.instructorId), locationId: text(pass.locationId), passId: result.passId, clientId: result.clientId, clientIds: result.clientId ? [result.clientId] : [],
      key: `${kind}:${result.passId}`, kind, severity: touched ? CHECK_SEVERITY.BLOCK : CHECK_SEVERITY.WARN,
      detail: { remaining: result.remainingCount, ledgerTotal: result.ledgerTotal, difference: result.difference, reason: unknown ? text(result.unknownReason) : "", entries: entries.length },
      signature: signatureOf(`${result.clientId}|${who(pass.instructorId)}|${result.remainingCount}|${result.ledgerTotal}|${entries.map((entry) => `${entryIdOf(entry)}:${Number(entry.delta) || 0}`).sort().join(",")}|${text(result.unknownReason)}`) });
  }

  const order = { [CHECK_SEVERITY.BLOCK]: 0, [CHECK_SEVERITY.WARN]: 1 };
  items.sort((left, right) => order[left.severity] - order[right.severity] || (left.startsAt || 0) - (right.startsAt || 0) || left.key.localeCompare(right.key));
  /* 점검 범위: 강사 명부에 있는데 이 달 서버 일정이 하나도 없는 강사 -- 그 강사의 미처리 수업은 이 점검으로 볼 수 없다.
     (검토 지적 5: 차감 기록에서 뽑으면 아무것도 처리 안 한 강사가 빠지고, 동기화 스위치는 "받기" 만 정한다.) */
  const noSchedule = sorted(rosterInstructorIds.map(who)).filter((id) => !scheduledInstructors.has(id));
  return {
    month: text(month),
    complete: !failures.length,
    failures,
    scope: { lessons: lessons.length, passes: passes.length, noScheduleInstructorIds: noSchedule, rosterInstructors: sorted(rosterInstructorIds.map(who)).length, noLedgerPasses, balanceSkipped },
    items,
  };
}

/**
 * 확인함을 얹고 **전체 항목으로** 센다. 같은 key · 같은 signature 일 때만 확인된 것으로.
 * @param {{ items: any[], countsTotal?: any }} check
 * @param {any[]} acks  payCheckAcks 문서들
 */
export function withAcks(check, acks = []) {
  const byKey = new Map((acks || []).map((ack) => [text(ack.key), ack]));
  const items = (check?.items || []).map((item) => {
    const ack = byKey.get(item.key);
    return ack && text(ack.signature) === item.signature ? { ...item, ack: { reason: text(ack.reason), by: text(ack.ackedBy), at: ack.ackedAt || null } } : item;
  });
  const counts = { block: 0, warn: 0, byKind: /** @type {Record<string, number>} */ ({}) };
  for (const item of items) {
    counts[item.severity] += 1;
    counts.byKind[item.kind] = (counts.byKind[item.kind] || 0) + 1;
  }
  /* 차단 항목은 문서에 전부 담긴다(storedCheck) -- 지금 확인함으로 다시 세도 전체 기준이다. */
  const openBlocks = items.filter((item) => item.severity === CHECK_SEVERITY.BLOCK && !item.ack).length;
  const openWarns = items.filter((item) => item.severity === CHECK_SEVERITY.WARN && !item.ack).length;
  return { ...check, items, counts: check?.countsTotal || counts, openBlocks, openWarns };
}

/**
 * 문서에 담을 모양. 차단 항목은 전부, 확인 항목은 앞에서 PAY_CHECK_WARN_LIMIT 건까지. 건수는 전체 기준으로 따로 남긴다.
 * 차단 항목이 너무 많아 다 못 담으면 점검 미완료로 둔다 -- 담지 못한 차단이 확정을 비켜 가지 않게.
 * @param {ReturnType<typeof runPayCheck>} full
 * @param {any[]} acks
 */
export function storedCheck(full, acks = []) {
  const judged = withAcks(full, acks);
  const blocks = judged.items.filter((item) => item.severity === CHECK_SEVERITY.BLOCK);
  const warns = judged.items.filter((item) => item.severity === CHECK_SEVERITY.WARN);
  const tooMany = blocks.length > PAY_CHECK_BLOCK_LIMIT;
  const keep = [...blocks.slice(0, PAY_CHECK_BLOCK_LIMIT), ...warns.slice(0, PAY_CHECK_WARN_LIMIT)].map(({ ack, ...item }) => item);
  return {
    ...full,
    complete: full.complete && !tooMany,
    failures: tooMany ? [...full.failures, { source: "items", code: "too_many_blocks" }] : full.failures,
    items: keep,
    total: judged.items.length,
    hiddenWarns: Math.max(0, warns.length - PAY_CHECK_WARN_LIMIT),
    truncated: keep.length < judged.items.length,
    countsTotal: judged.counts,
    openBlocksTotal: judged.openBlocks,
  };
}
