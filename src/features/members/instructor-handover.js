/**
 * 담당 인계 — **회원권 하나든 퇴사 강사 전부든 같은 길로 간다.**
 *
 * ── 왜 한 곳인가 ──
 * 회원 상세의 "담당 변경" 과 대표 메뉴의 "퇴사 인계" 는 사람이 보기엔 다른
 * 일이지만, 서버에서 일어나는 일은 같다: 회원권의 담당을 바꾸고, 인수인계
 * 표시를 세우고, 전 강사의 누적을 새 강사 쪽에 더하고, 앞으로의 예약을 옮기고,
 * 기록을 남긴다.
 *
 * 둘을 따로 짜면 한쪽만 고쳐지는 날이 온다 -- 그리고 그날 틀리는 것은 급여다.
 *
 * ── 왜 순수 함수인가 ──
 * 퇴사 인계는 한 번에 수십 장을 옮긴다. 중간에 틀리면 되돌릴 수 없고(원장은
 * append-only), 프로덕션을 옮겨 가며 시험할 수도 없다. 그래서 **무엇을 옮길지
 * 정하는 일**과 **옮기는 일**을 가른다 -- 여기는 앞쪽이고, 읽고 쓰는 것은
 * 부르는 쪽이 한다.
 */

import { newToInstructorUnitPrice } from "../../../functions/shared/deduction-pricing.mjs";
import { passClientIds } from "../../data/schema/pass-clients.js";
import { remainingCountOf } from "../../data/repositories/pass-repository.js";

const text = (value) => String(value ?? "").trim();

const toDate = (value) => {
  if (!value) return null;
  const at = typeof value?.toDate === "function" ? value.toDate() : new Date(value);
  return Number.isFinite(at?.getTime?.()) ? at : null;
};

/** 인계가 막히는 이유. 코드 없는 "할 수 없습니다" 를 남기지 않는다. */
export const HANDOVER_BLOCK = Object.freeze({
  /** 듀엣인데 두 회원이 서로 다른 강사로 지정됐다. */
  DUET_SPLIT: "duet_split",
  /** 받을 강사가 정해지지 않았다. */
  NO_TARGET: "no_target",
  /** 받을 강사가 그 회원권의 지점에 없다. */
  OTHER_LOCATION: "other_location",
  /** 자기 자신에게 넘긴다. */
  SAME_INSTRUCTOR: "same_instructor",
});

export const HANDOVER_BLOCK_LABEL = Object.freeze({
  [HANDOVER_BLOCK.DUET_SPLIT]: "2:1 회원권은 두 회원이 같은 강사에게 가야 합니다.",
  [HANDOVER_BLOCK.NO_TARGET]: "받을 강사를 고르지 않았습니다.",
  [HANDOVER_BLOCK.OTHER_LOCATION]: "다른 지점 강사입니다. 같은 지점에서 골라 주세요.",
  [HANDOVER_BLOCK.SAME_INSTRUCTOR]: "지금 담당과 같은 강사입니다.",
});

/**
 * 지금 넘길 수 있는 회원권인가.
 *
 * **쓸 수 있는 것만 넘긴다.** 끝난 회원권을 함께 옮기면 목록이 길어져 대표가
 * 무엇을 보고 있는지 알 수 없고, 넘겨 봐야 차감될 회차가 없다. 그 회원권의
 * 지난 원장 항목은 그대로 전 강사의 급여로 남는다 -- 옮기는 것은 앞으로의
 * 회차뿐이다.
 *
 * @param {any} pass @param {Date} [now]
 */
export function isHandoverable(pass, now = new Date()) {
  if (!pass || text(pass.status) !== "active") return false;
  if (remainingCountOf(pass) <= 0) return false;
  const expiresAt = toDate(pass.expiresAt);
  return !expiresAt || expiresAt.getTime() > now.getTime();
}

/**
 * 같은 지점의 받을 수 있는 강사.
 *
 * 지점을 가르는 이유: 다른 지점 강사에게 넘기면 그 회원은 다니던 곳에서
 * 수업을 받을 수 없다. 화면에서 고르지 못하게 하는 것이 먼저이고, 아래
 * `handoverPlan` 이 한 번 더 본다 -- 목록이 낡았을 수 있다.
 *
 * 지점이 비어 있는 강사는 **거르지 않는다.** 이 칸이 생기기 전에 만들어진
 * 소속이 있고, 그 사람들을 목록에서 빼면 받을 사람이 없어진다.
 *
 * @param {Array<any>} instructors @param {{ locationId?: string, excludeUserId?: string }} scope
 */
export function instructorsForHandover(instructors, scope = {}) {
  const locationId = text(scope.locationId);
  const exclude = text(scope.excludeUserId);
  return (Array.isArray(instructors) ? instructors : [])
    .filter(Boolean)
    .filter((item) => text(item.userId) && text(item.userId) !== exclude)
    .filter((item) => text(item.status) === "active")
    .filter((item) => {
      const mine = text(item.locationId);
      return !locationId || !mine || mine === locationId;
    });
}

/**
 * 인계한 뒤 그 회원권의 한 회차가 얼마가 되는가.
 *
 * 넘겨받은 회원권은 남은 회차 전부가 신규 단가다 (판정 2) -- 1:1 은 25,000,
 * 2:1 은 2:1 신규 단가. 누적과 무관하므로 **미리 정확히 말할 수 있다.**
 *
 * 부원장과 디오사는 예외다. 둘 다 판정 2 보다 앞이라 인계와 무관하게 자기
 * 금액을 받는다 -- 미리보기가 25,000 이라고 말하면 거짓이 된다.
 *
 * @param {any} pass @param {{ isDeputyDirector?: boolean }} target
 */
export function unitPriceAfterHandover(pass, target = {}) {
  const category = text(pass?.category);
  if (category === "diosa_a" || category === "diosa_b") {
    return { unitPrice: Number(pass?.baseUnitPrice) || 0, rule: "diosa_fixed" };
  }
  /* 부원장은 5:5 이고 그 금액은 계약마다 다르다. 숫자를 지어내지 않고 모른다고
     말한다 -- 화면이 "계약에 따라 다름" 으로 적는다. */
  if (target?.isDeputyDirector === true) return { unitPrice: null, rule: "deputy_director" };
  return { unitPrice: newToInstructorUnitPrice(category), rule: "handed_over" };
}

/**
 * 인계 계획. **실행 전에 사람이 보는 그 목록이다.**
 *
 * @param {{
 *   passes?: Array<any>,
 *   fromInstructorId?: string,
 *   assignments?: Record<string, string>,
 *   clientNameOf?: (clientId: string) => string,
 *   instructorOf?: (userId: string) => any,
 *   sessionsOf?: (clientId: string) => number,
 *   now?: Date,
 * }} input
 *   assignments  회원권 id → 받을 강사 uid. 비면 그 줄은 아직 안 정해진 것이다
 *   sessionsOf   전 강사의 그 회원 누적. **단가 미리보기에만 쓴다** --
 *                2026-10-23 부터 이 값은 새 강사에게 더해지지 않는다
 */
export function handoverPlan(input = {}) {
  const now = input.now instanceof Date ? input.now : new Date();
  const from = text(input.fromInstructorId);
  const assignments = input.assignments && typeof input.assignments === "object" ? input.assignments : {};
  const nameOf = typeof input.clientNameOf === "function" ? input.clientNameOf : () => "";
  const instructorOf = typeof input.instructorOf === "function" ? input.instructorOf : () => null;
  const sessionsOf = typeof input.sessionsOf === "function" ? input.sessionsOf : () => 0;

  const mine = (Array.isArray(input.passes) ? input.passes : [])
    .filter((pass) => pass && text(pass.instructorId) === from)
    .filter((pass) => isHandoverable(pass, now));

  const rows = mine.map((pass) => {
    const passId = text(pass.id || pass.passId);
    const clientIds = passClientIds(pass).map(text).filter(Boolean);
    const toInstructorId = text(assignments[passId]);
    const target = toInstructorId ? instructorOf(toInstructorId) : null;
    const blocks = [];

    if (!toInstructorId) blocks.push(HANDOVER_BLOCK.NO_TARGET);
    else if (toInstructorId === from) blocks.push(HANDOVER_BLOCK.SAME_INSTRUCTOR);
    else {
      /* 지점이 비어 있으면 막지 않는다 -- 이 칸이 생기기 전 소속이 있다.
         아는 값끼리 다를 때만 막는다. */
      const passLocation = text(pass.locationId);
      const targetLocation = text(target?.locationId);
      if (passLocation && targetLocation && passLocation !== targetLocation) {
        blocks.push(HANDOVER_BLOCK.OTHER_LOCATION);
      }
    }

    const price = unitPriceAfterHandover(pass, target || {});
    return {
      passId,
      clientIds,
      /* 이름을 못 찾으면 지어내지 않는다. 빈칸이면 화면이 회원권 번호로
         부르고, 그것은 "아직 모른다" 와 같은 방향이다. */
      clientNames: clientIds.map((id) => nameOf(id)).filter(Boolean),
      isDuet: clientIds.length > 1,
      category: text(pass.category),
      locationId: text(pass.locationId),
      remaining: remainingCountOf(pass),
      toInstructorId,
      toInstructorName: text(target?.displayName),
      unitPriceAfter: price.unitPrice,
      ruleAfter: price.rule,
      blocks,
    };
  });

  /* ── 듀엣은 두 회원이 같은 강사로 간다 ────────────────────────────────
     회원권 하나를 둘이 나눠 쓴다. 한 명만 옮길 수는 없고, 그 두 사람이 **다른
     회원권에서도** 갈라지면 수업을 함께 받을 수 없다.

     그래서 한 회원이 여러 회원권에 걸쳐 있을 때 그 회원의 모든 줄이 같은
     강사를 가리키는지 본다. 다르면 걸린 줄 전부를 막는다 -- 한 줄만 막으면
     대표는 나머지가 맞는 줄 안다. */
  const targetsByClient = new Map();
  for (const row of rows) {
    if (!row.toInstructorId) continue;
    for (const clientId of row.clientIds) {
      if (!targetsByClient.has(clientId)) targetsByClient.set(clientId, new Set());
      targetsByClient.get(clientId).add(row.toInstructorId);
    }
  }
  const splitClients = new Set(
    [...targetsByClient.entries()].filter(([, set]) => set.size > 1).map(([clientId]) => clientId),
  );
  for (const row of rows) {
    if (!row.isDuet && !row.clientIds.some((id) => splitClients.has(id))) continue;
    const duetSplit = row.isDuet && row.clientIds.some((id) => splitClients.has(id));
    const anySplit = row.clientIds.some((id) => splitClients.has(id));
    if (duetSplit || anySplit) {
      if (!row.blocks.includes(HANDOVER_BLOCK.DUET_SPLIT)) row.blocks.push(HANDOVER_BLOCK.DUET_SPLIT);
    }
  }

  const ready = rows.filter((row) => row.blocks.length === 0);
  return {
    rows: rows.slice().sort((left, right) => (left.clientNames[0] || "").localeCompare(right.clientNames[0] || "")),
    ready,
    blocked: rows.filter((row) => row.blocks.length > 0),
    /* **누적은 따라가지 않는다 (2026-10-23 대표 결정).** 비워 둔 채 남긴다 --
       부르는 쪽 둘이 이 칸을 읽고 있어, 없애면 undefined 를 세게 된다.
       되살릴 일이 생기면 여기 하나만 다시 채우면 된다. */
    carries: [],
    /* 넘길 것이 없으면 실행할 것도 없다. 빈 실행을 허용하면 "했습니다" 가
       뜨는데 아무것도 안 바뀐다. */
    canRun: ready.length > 0 && rows.every((row) => row.blocks.length === 0),
  };
}

/**
 * 전 강사가 아직 확정하지 않은 수업.
 *
 * **먼저 처리해야 한다.** 담당이 바뀐 뒤에 확정하면 그 회차가 새 강사의 급여로
 * 들어간다 -- 수업한 사람은 전 강사인데. 원장은 append-only 라 되돌릴 수 없다.
 *
 * 기기 일정에서 센다. 확정 여부는 서버가 아니라 그 폰이 들고 있다 -- 그래서
 * **대표 화면에서는 보이지 않을 수 있다.** 화면이 그 사실을 말한다.
 *
 * @param {{ schedule?: Array<any>, isSettled?: (lesson: any) => boolean, now?: Date }} input
 */
export function unsettledBeforeHandover({ schedule, isSettled, now } = {}) {
  const at = now instanceof Date ? now : new Date();
  const settled = typeof isSettled === "function" ? isSettled : () => false;
  return (Array.isArray(schedule) ? schedule : [])
    .filter((lesson) => lesson && !lesson.personal && lesson.isSample !== true)
    .filter((lesson) => !settled(lesson))
    .filter((lesson) => {
      const attendees = Array.isArray(lesson.attendees) ? lesson.attendees : [];
      return attendees.some((attendee) => ["done", "noshow"].includes(text(attendee?.status)));
    })
    .filter((lesson) => {
      const day = text(lesson.date);
      return day && day <= `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
    });
}

/**
 * 앞으로의 예약을 새 강사로 옮긴다. **지난 수업은 건드리지 않는다.**
 *
 * 지난 수업은 그때 그 강사가 한 것이고, 확정됐으면 원장이 이미 그 사람을
 * 가리킨다. 옮기면 기록과 원장이 서로 다른 말을 하게 된다.
 *
 * @param {{ schedule?: Array<any>, clientIds?: Array<string>, toInstructorName?: string, now?: Date }} input
 */
export function reassignUpcomingLessons({ schedule, clientIds, toInstructorName, now } = {}) {
  const at = now instanceof Date ? now : new Date();
  const today = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
  const moving = new Set((Array.isArray(clientIds) ? clientIds : []).map(text).filter(Boolean));
  const name = text(toInstructorName);
  if (!name || moving.size === 0) return { schedule: Array.isArray(schedule) ? schedule : [], moved: 0 };

  let moved = 0;
  const next = (Array.isArray(schedule) ? schedule : []).map((lesson) => {
    if (!lesson || lesson.personal || text(lesson.date) < today) return lesson;
    const attendees = Array.isArray(lesson.attendees) ? lesson.attendees : [];
    /* 아직 오지 않은 수업만. 이미 찍힌 것은 그 강사가 한 일이다. */
    const touches = attendees.some((attendee) => (
      moving.has(text(attendee?.orgClientId || attendee?.memberId))
      && text(attendee?.status) === "booked"
    ));
    if (!touches) return lesson;
    moved += 1;
    return { ...lesson, instructor: name };
  });
  return { schedule: next, moved };
}
