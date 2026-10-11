/**
 * 이번 달 내 수업 활동 — **강사가 자기 한 달을 보는 화면.**
 *
 * ── 왜 금액이 여기 없는가 ──
 * 전에는 이 화면의 첫 줄이 "예상 급여" 였다. 그런데 같은 금액이 일정 탭 카드와
 * 급여 시트에도 있어서, 한 숫자를 세 곳에서 보여주고 있었다 -- 셋 중 하나가
 * 늦게 갱신되면 강사는 어느 쪽을 믿어야 할지 알 수 없다.
 *
 * 금액은 급여 화면 하나로 모은다. 이 화면이 답하는 것은 **"이번 달 나는 무엇을
 * 했나"** 이고, 그것은 돈이 아니라 수업과 회원이다.
 *
 * ── 어디서 세는가 (두 출처다. 섞지 않는다) ──
 * 회원권과 돈에 닿는 것 -- 수업 수, 종료된 회원권, 재등록, 챙길 회원 -- 은
 * **서버 원장과 회원권**이다. 급여 집계가 보는 것과 같은 줄이라 두 화면이
 * 갈라질 자리가 없다.
 *
 * 출석·노쇼·취소와 기록·사진은 **기기**다. 원장에는 차감만 남는다 -- 취소한
 * 수업은 회원권을 건드리지 않으므로 서버에 남길 것이 아예 없고, 수업 기록과
 * 체형 사진은 기기에 있다. 그 사실을 화면이 말해야 한다. 한 화면에서 두 출처가
 * 말없이 섞이면, 숫자가 어긋났을 때 어느 쪽을 의심할지 아무도 모른다.
 *
 * ── 본인 것만 ──
 * 원장은 부르는 쪽이 이미 자기 uid 로 걸러 온다 (loadInstructorMonthlyPay).
 * 회원권은 여기서 `instructorId` 로 거른다.
 */

import { PAYROLL_ENTRY_TYPES } from "../../data/repositories/payroll-repository.js";
import { remainingCountOf } from "../../data/repositories/pass-repository.js";
import { passBelongsTo, passClientIds } from "../../data/schema/pass-clients.js";

const text = (value) => String(value ?? "").trim();

/** 잔여가 이만큼 아래면 챙긴다. 재등록 이야기를 꺼낼 시점이다. */
export const LOW_REMAINING = 5;
/** 만료가 이만큼 안으로 들어오면 챙긴다. */
export const EXPIRY_SOON_DAYS = 14;
/** 이만큼 수업이 없으면 챙긴다. 3주다 -- 주 1회 회원이 두 번 빠진 것이다. */
export const QUIET_DAYS = 21;

/** 챙길 이유. 이름만 주면 무엇을 해야 할지 알 수 없다 -- 셋은 할 일이 다르다. */
export const WATCH_REASON = Object.freeze({
  LOW: "low", EXPIRING: "expiring", QUIET: "quiet",
});

const toDate = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const at = typeof value?.toDate === "function" ? value.toDate() : new Date(value);
  return Number.isFinite(at?.getTime?.()) ? at : null;
};

/** 그 날짜가 속한 달. 달력 기준이다 -- UTC 로 자르면 월말 밤 수업이 다음 달로 간다. */
const monthOf = (at) => (at ? `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}` : "");

const daysBetween = (from, to) => Math.ceil((to.getTime() - from.getTime()) / 86400000);

/**
 * 회차 수. **급여 집계와 같은 식이다** (`-delta`).
 *
 * 차감은 delta −1 이라 +1 회, 보정은 +1 이라 −1 회다. 절댓값을 쓰면 되돌린
 * 회차가 한 번 더 세어진다.
 */
const sessionsOf = (entry) => -(Number(entry?.delta) || 0);

/** 그 달에 일어난 차감·보정만. 발급·양도·이관은 수업이 아니다. */
export function deductionsIn(entries, month) {
  const key = text(month);
  if (!key) return [];
  return (Array.isArray(entries) ? entries : []).filter((entry) => {
    if (!entry || !PAYROLL_ENTRY_TYPES.includes(entry.type)) return false;
    return monthOf(toDate(entry.occurredAt)) === key;
  });
}

/**
 * 수업 수와 지난달 대비.
 *
 * 지난달이 0이면 **비율을 내지 않는다** -- 0에서 늘어난 것은 몇 퍼센트라고 말할
 * 수 없고, "+∞%" 는 아무것도 알려주지 않는다. 건수 차이만 말한다.
 *
 * 지난달을 **못 읽은 것과 0건인 것은 다르다.** 못 읽었으면 증감을 내지 않는다 --
 * 0건으로 두면 이번 달 전부가 "증가" 로 보이고, 그것은 거짓이다.
 */
export function sessionTrend({ entries, previousEntries, month, previousMonth } = {}) {
  const sessions = deductionsIn(entries, month).reduce((sum, entry) => sum + sessionsOf(entry), 0);
  if (previousEntries === null || previousEntries === undefined) {
    return { sessions, previous: null, delta: null };
  }
  const previous = deductionsIn(previousEntries, previousMonth)
    .reduce((sum, entry) => sum + sessionsOf(entry), 0);
  return { sessions, previous, delta: sessions - previous };
}

/* ── 기기에서 세는 것 ─────────────────────────────────────────────────────── */

/** 일정 한 건의 참석자. 회원 한 명짜리 옛 일정은 attendees 가 없다. */
const attendeesOf = (lesson) => {
  if (!lesson || typeof lesson !== "object") return [];
  if (Array.isArray(lesson.attendees) && lesson.attendees.length) {
    return lesson.attendees.filter((attendee) => attendee && attendee.memberId);
  }
  return lesson.memberId ? [{ memberId: lesson.memberId, status: lesson.status || "booked" }] : [];
};

/** 기구 그룹 수업. 참석자가 없고 그룹 단위로 한 번에 찍는다. */
const isEquipGroup = (lesson) => !lesson?.personal && attendeesOf(lesson).length === 0;

const lessonsIn = (schedule, month) => {
  const key = text(month);
  if (!key) return [];
  return (Array.isArray(schedule) ? schedule : []).filter((lesson) => (
    lesson && !lesson.personal && lesson.isSample !== true && text(lesson.date).slice(0, 7) === key
  ));
};

/**
 * 출석 · 노쇼 · 취소.
 *
 * **기기 일정에서 센다.** 원장에는 차감만 남고 취소는 아예 적히지 않는다.
 *
 * 비율의 분모는 **이미 찍은 것**이다. 아직 예약 상태인 수업을 분모에 넣으면
 * 달 초의 출석률이 언제나 바닥이고, 그것은 사실이 아니라 아직 안 온 날이다.
 */
export function attendanceMix({ schedule, month } = {}) {
  const mix = { done: 0, noshow: 0, cancel: 0, booked: 0 };
  for (const lesson of lessonsIn(schedule, month)) {
    if (isEquipGroup(lesson)) {
      // 그룹은 좌석이 아니라 수업 단위로 찍는다. 한 건으로 센다.
      mix[lesson.groupCancelled ? "cancel" : lesson.groupDone ? "done" : "booked"] += 1;
      continue;
    }
    for (const attendee of attendeesOf(lesson)) {
      const status = text(attendee.status);
      if (status === "done" || status === "noshow" || status === "cancel") mix[status] += 1;
      else mix.booked += 1;
    }
  }
  const settled = mix.done + mix.noshow + mix.cancel;
  return { ...mix, settled, rate: settled > 0 ? Math.round((mix.done / settled) * 100) : null };
}

/**
 * 수업 기록 작성률과 체형 사진.
 *
 * **기기에서 센다.** 수업 기록은 회원 문서의 메모이고 사진은 기기에 있다 --
 * 서버가 들고 있는 것이 아니다.
 *
 * 분모는 **출석으로 끝난 수업**이다. 취소한 수업에 기록이 없는 것은 정상이고,
 * 그것까지 분모에 넣으면 아무리 부지런해도 100% 가 되지 않는다.
 */
export function recordRate({ schedule, members, photos, month } = {}) {
  /* 어느 수업에 글이 붙었는가. 메모는 `sid` 로 수업을 가리킨다 -- 날짜로 맞추면
     같은 날 두 수업 중 어느 쪽인지 알 수 없다. */
  const written = new Set();
  for (const member of Array.isArray(members) ? members : []) {
    for (const note of Array.isArray(member?.notes) ? member.notes : []) {
      const sid = text(note?.sid);
      if (sid) written.add(sid);
    }
  }

  let done = 0;
  let recorded = 0;
  for (const lesson of lessonsIn(schedule, month)) {
    const attended = isEquipGroup(lesson)
      ? lesson.groupDone === true
      : attendeesOf(lesson).some((attendee) => text(attendee.status) === "done");
    if (!attended) continue;
    done += 1;
    if (written.has(text(lesson.id))) recorded += 1;
  }

  /* 체형 사진. 저장은 회원별·방향별 배열이다. id 로 묶는다 -- 한 장이 두 목록에
     들어가는 일이 있고(세트와 방향), 두 번 세면 찍은 것보다 많아진다. */
  const key = text(month);
  const shot = new Set();
  let unnamed = 0;
  for (const perMember of Object.values(photos && typeof photos === "object" ? photos : {})) {
    for (const list of Object.values(perMember && typeof perMember === "object" ? perMember : {})) {
      if (!Array.isArray(list)) continue;
      for (const photo of list) {
        const at = text(photo?.date).slice(0, 7) || monthOf(toDate(photo?.createdAt));
        if (at !== key) continue;
        const id = text(photo?.id);
        if (id) shot.add(id);
        else unnamed += 1;
      }
    }
  }

  return {
    done,
    recorded,
    photos: shot.size + unnamed,
    rate: done > 0 ? Math.round((recorded / done) * 100) : null,
  };
}

/* ── 서버에서 세는 것 ─────────────────────────────────────────────────────── */

/** 내 담당 회원권만. 듀엣은 회원권 하나에 둘이 붙으므로 둘 다 내 회원이다. */
const myPasses = (passes, instructorId) => {
  const mine = text(instructorId);
  if (!mine) return [];
  return (Array.isArray(passes) ? passes : []).filter(
    (pass) => pass && text(pass.instructorId) === mine,
  );
};

/**
 * 이번 달 가르친 회원과, 이번 달 **새로 맡은** 회원.
 *
 * 새로 맡은 기준은 **회원권 발급**이다 -- 이번 달에 내 담당으로 나간 회원권이
 * 있으면 그 회원은 이번 달부터 내 회원이다. 원장으로 "처음 가르친 달" 을 세려면
 * 그 강사의 모든 달을 읽어야 하고, 그것은 이 화면 하나를 위해 치를 비용이 아니다.
 *
 * 그래서 **재등록한 기존 회원도 여기 선다.** 틀린 것이 아니라 "이번 달에 내게
 * 새로 맡겨진 회원권" 이고, 화면이 그렇게 부른다.
 */
export function clientsTaught({ entries, passes, month, instructorId } = {}) {
  const key = text(month);
  const taught = new Set(deductionsIn(entries, key).map((entry) => text(entry.clientId)).filter(Boolean));
  const fresh = new Set();
  for (const pass of myPasses(passes, instructorId)) {
    if (monthOf(toDate(pass.createdAt)) !== key) continue;
    for (const clientId of passClientIds(pass)) {
      if (text(clientId)) fresh.add(text(clientId));
    }
  }
  return { taught: [...taught], fresh: [...fresh] };
}

/**
 * 챙길 회원.
 *
 * 한 회원이 여러 이유에 걸리면 **한 줄로 합친다.** 같은 사람이 세 번 서면 목록이
 * 길어 보이고, 정작 몇 명인지는 세어 봐야 안다.
 *
 * `entriesSince` 는 **원장을 어디까지 읽어 왔는가**다. 화면은 두 달치만 읽으므로
 * 그보다 오래 안 온 회원은 항목이 아예 없다 -- 그것을 "모른다" 로 두면 가장
 * 조용한 사람이 목록에서 빠지고, "한 번도 안 왔다" 로 두면 어제 맡은 회원이
 * 거기 선다. 읽은 범위를 받아서 둘을 가른다.
 *
 * @param {{
 *   passes?: Array<any>, entries?: Array<any>, entriesSince?: Date | null,
 *   now?: Date, instructorId?: string,
 * }} [input]
 */
export function clientsToWatch({ passes, entries, entriesSince = null, now, instructorId } = {}) {
  const at = now instanceof Date && Number.isFinite(now.getTime()) ? now : new Date();
  const reasons = new Map();
  const add = (clientId, reason) => {
    const id = text(clientId);
    if (!id) return;
    if (!reasons.has(id)) reasons.set(id, new Set());
    reasons.get(id).add(reason);
  };

  /* 아직 쓸 회차가 남은 내 회원권만 본다. 잔여 0과 만료 지난 것은 챙길 것이
     아니라 끝난 것이고 -- 아래 '종료시킨 회원' 이 센다 -- 그것으로 목록이 차면
     그때부터 아무도 이 목록을 읽지 않는다. */
  const live = myPasses(passes, instructorId).filter((pass) => {
    if (text(pass.status) !== "active" || remainingCountOf(pass) <= 0) return false;
    const expiresAt = toDate(pass.expiresAt);
    return !expiresAt || expiresAt.getTime() > at.getTime();
  });

  /** 이 회원을 언제부터 맡았는가. 가장 오래된 살아 있는 회원권의 발급일이다. */
  const since = new Map();
  for (const pass of live) {
    const remaining = remainingCountOf(pass);
    const expiresAt = toDate(pass.expiresAt);
    const createdAt = toDate(pass.createdAt);
    for (const clientId of passClientIds(pass)) {
      const id = text(clientId);
      if (!id) continue;
      if (remaining <= LOW_REMAINING) add(id, WATCH_REASON.LOW);
      if (expiresAt && daysBetween(at, expiresAt) <= EXPIRY_SOON_DAYS) add(id, WATCH_REASON.EXPIRING);
      if (createdAt && createdAt.getTime() < (since.get(id) ?? Infinity)) since.set(id, createdAt.getTime());
    }
  }

  /* 오래 안 온 회원. **내 회원 중에서만** 본다 -- 남의 회원이 조용한 것은 내가
     챙길 일이 아니다. */
  const lastSeen = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || !PAYROLL_ENTRY_TYPES.includes(entry.type)) continue;
    const when = toDate(entry.occurredAt);
    const clientId = text(entry.clientId);
    if (!when || !since.has(clientId)) continue;
    if (when.getTime() > (lastSeen.get(clientId) ?? -Infinity)) lastSeen.set(clientId, when.getTime());
  }

  /* 읽어 온 범위가 21일을 덮을 때만 "항목이 없다 = 그 전부터 안 왔다" 로 읽는다.
     덮지 못하면 아는 것만 말한다 -- 모르는 것을 '안 왔다' 로 적으면 멀쩡히
     다니는 회원이 목록에 선다. */
  const covered = entriesSince instanceof Date && Number.isFinite(entriesSince.getTime())
    && daysBetween(entriesSince, at) >= QUIET_DAYS;

  for (const [clientId, mine] of since) {
    const seen = lastSeen.get(clientId);
    if (seen !== undefined) {
      if (daysBetween(new Date(seen), at) >= QUIET_DAYS) add(clientId, WATCH_REASON.QUIET);
      continue;
    }
    /* 한 번도 안 온 사람. 맡은 지 21일이 안 됐으면 아직 시작하지 않은 것이지
       끊긴 것이 아니다 -- 어제 맡은 회원이 여기 서면 목록이 곧 안 읽힌다. */
    if (covered && daysBetween(new Date(mine), at) >= QUIET_DAYS) add(clientId, WATCH_REASON.QUIET);
  }

  return [...reasons.entries()]
    .map(([clientId, set]) => ({ clientId, reasons: [...set].sort() }))
    .sort((left, right) => right.reasons.length - left.reasons.length
      || left.clientId.localeCompare(right.clientId));
}

/**
 * 이번 달 내 수업으로 **다 쓴** 회원권과, 그중 다시 끊은 회원.
 *
 * 다 쓴 것은 끝이 아니라 **재등록을 말할 시점**이다. 그래서 둘을 함께 센다 --
 * "열 장이 끝났고 그중 여섯이 다시 끊었다" 가 이 화면이 답할 것이고, 끝난 수만
 * 보여주면 그것이 좋은 소식인지 나쁜 소식인지 알 수 없다.
 *
 * 재등록은 **그 회원의 새 회원권**이다. 담당이 바뀌었어도 센다 -- 회원이 센터에
 * 남은 것이 먼저이고, 누구에게 갔는지는 다른 질문이다.
 */
export function exhaustedThisMonth({ entries, passes, month } = {}) {
  const key = text(month);
  const all = (Array.isArray(passes) ? passes : []).filter(Boolean);
  const byId = new Map(all.map((pass) => [text(pass.id || pass.passId), pass]));

  /* 내가 이번 달에 손댄 회원권. entries 는 이미 내 것만 들어온다 -- 여기서 한 번
     더 instructorId 로 거르면 계정을 바꾼 강사의 옛 uid 차감이 빠진다. */
  const touched = new Set(deductionsIn(entries, key).map((entry) => text(entry.passId)).filter(Boolean));

  const finished = [];
  for (const passId of touched) {
    const pass = byId.get(passId);
    /* 회원권을 못 읽었으면 끝났는지 알 수 없다. 끝난 것으로 세면 없는 이름이
       목록에 서고, 안 센 것은 다음 달에 드러난다 -- 뒤가 덜 틀리다. */
    if (!pass || remainingCountOf(pass) > 0) continue;
    for (const clientId of passClientIds(pass)) {
      finished.push({ passId, clientId: text(clientId) });
    }
  }

  const renewed = new Set();
  for (const item of finished) {
    const again = all.some((pass) => (
      text(pass.id || pass.passId) !== item.passId
      && passBelongsTo(pass, item.clientId)
      && monthOf(toDate(pass.createdAt)) === key
    ));
    if (again) renewed.add(item.clientId);
  }

  return {
    passes: new Set(finished.map((item) => item.passId)).size,
    clientIds: [...new Set(finished.map((item) => item.clientId).filter(Boolean))],
    renewedClientIds: [...renewed],
  };
}

/** 지난달. `2026-01` 의 앞은 `2025-12` 다 -- 문자열로 빼면 `2026-00` 이 된다. */
export function previousMonthOf(month) {
  const key = text(month);
  if (!/^\d{4}-\d{2}$/.test(key)) return "";
  return monthOf(new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 2, 1));
}

/** 한 화면이 쓰는 모든 값. 부르는 쪽은 이것 하나만 본다. */
export function instructorMonthReport(input = {}) {
  const {
    entries, previousEntries, entriesSince, passes, schedule, members, photos,
    month, previousMonth = previousMonthOf(month), instructorId, now,
  } = input;
  return {
    month: text(month),
    trend: sessionTrend({ entries, previousEntries, month, previousMonth }),
    attendance: attendanceMix({ schedule, month }),
    clients: clientsTaught({ entries, passes, month, instructorId }),
    watch: clientsToWatch({ passes, entries, entriesSince, now, instructorId }),
    exhausted: exhaustedThisMonth({ entries, passes, month }),
    records: recordRate({ schedule, members, photos, month }),
  };
}
