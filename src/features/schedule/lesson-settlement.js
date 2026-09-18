/**
 * 수업 확정. 일정에서 누른 출석을 조직 회원권 차감으로 옮긴다.
 *
 * ── 왜 확정이라는 단계가 따로 있는가 ──
 * 차감은 원장에 append-only 로 박히고, 되돌리는 것은 대표만 할 수 있다. 출석
 * 버튼 하나로 그것이 나가면 누르는 문턱이 그 무게와 맞지 않는다. 그래서 출석 ·
 * 노쇼 · 취소는 화면 상태만 바꾸고, 확정을 눌렀을 때 한 번에 나간다.
 *
 * 확정 전까지는 자유롭게 바꿀 수 있고, 여러 명인 수업은 전원을 정한 뒤 한 번에
 * 확정하므로 누르는 횟수가 오히려 줄어든다.
 *
 * ── 이 파일은 계획만 세운다 ──
 * 읽지도 쓰지도 않는다. 누구를 차감하고 누구를 건너뛰는지, 건너뛰는 이유가
 * 무엇인지만 돌려준다. 실제 차감은 pass-repository 의 deductPass 가 한다 --
 * 판정 엔진과 원장 기록이 전부 그 경로에 있어 우회로를 만들지 않는다.
 */

import { PASS_STATUS } from "../../data/schema/constants.js";
import { isDeductablePass, remainingCountOf } from "../../data/repositories/pass-repository.js";

/** 왜 차감하지 않았는가. 화면이 이 값으로 무엇을 말할지 정한다. */
export const SETTLEMENT_SKIP = Object.freeze({
  /** 센터 명부에 없는 회원. 기기에만 있어 붙일 회원권이 없다. */
  NO_CLIENT: "no_client",
  /** 회원권이 한 장도 없다. 발급이 필요하다. */
  NO_PASS: "no_pass",
  /** 회원권은 있지만 쓸 수 있는 것이 없다 -- 잔여 0이거나 만료. */
  SPENT: "spent",
  /* 차감을 시도했고 서버가 받지 않았다.

     성공한 차감이 이미 원장에 박혔으므로 이 수업은 확정된 것으로 닫는다. 열어
     두고 다시 확정하게 하면 성공했던 회차가 한 번 더 차감되고, 원장은 고칠 수
     없다. 못 나간 회차는 출석 체크 화면에서 따로 넣는다 -- 두 번 차감하는 것보다
     한 번 빠뜨리는 것이 고칠 수 있는 실패다. */
  WRITE_FAILED: "write_failed",
});

/** 건너뛴 이유를 화면 문구로. 고칠 방법이 서로 다르므로 뭉개지 않는다. */
export const SETTLEMENT_SKIP_LABEL = Object.freeze({
  ["no_client"]: "센터 명부에 없는 회원입니다. 대표에게 등록을 요청해 주세요.",
  ["no_pass"]: "회원권이 없습니다. 발급 후 출석 체크에서 차감해 주세요.",
  ["spent"]: "쓸 수 있는 회원권이 없습니다 (잔여 0 또는 만료).",
  ["write_failed"]: "차감이 저장되지 않았습니다. 출석 체크에서 다시 시도해 주세요.",
});

const text = (value) => String(value ?? "").trim();

const attendeesOf = (lesson) => {
  if (!lesson || typeof lesson !== "object") return [];
  if (Array.isArray(lesson.attendees) && lesson.attendees.length) {
    return lesson.attendees.filter((attendee) => attendee && attendee.memberId);
  }
  return lesson.memberId ? [{ memberId: lesson.memberId, status: lesson.status || "booked" }] : [];
};

/**
 * 이 회원의 어느 회원권을 차감할 것인가.
 *
 * 만료가 이른 것을 먼저 쓴다. 늦게 만료되는 것을 먼저 쓰면 이른 쪽이 쓰이지
 * 못한 채 만료되고, 회원은 돈을 낸 회차를 잃는다. 만료일이 같으면 먼저 발급된
 * 것을 쓴다 -- 먼저 팔린 것이 먼저 소진되는 것이 계약의 순서다.
 *
 * @param {Array<any>} passes
 * @param {string} clientId
 * @param {Date} [now]
 * @returns {any | null}
 */
export function pickPassForClient(passes, clientId, now = new Date()) {
  const client = text(clientId);
  if (!client) return null;
  const usable = (Array.isArray(passes) ? passes : [])
    .filter((pass) => pass && pass.clientId === client && isDeductablePass(pass, now));
  if (usable.length === 0) return null;
  const at = (value) => {
    const date = value instanceof Date ? value : new Date(String(value ?? ""));
    const time = date.getTime();
    // 만료일이 없는 회원권은 맨 뒤로. 급한 것을 먼저 쓰는 것이 이 정렬의 목적이다.
    return Number.isFinite(time) ? time : Number.MAX_SAFE_INTEGER;
  };
  return usable.slice().sort((left, right) => (
    at(left.expiresAt) - at(right.expiresAt) || at(left.createdAt) - at(right.createdAt)
  ))[0];
}

/** 이 수업이 이미 확정됐는가. */
export const isSettledLesson = (lesson) => Boolean(lesson?.orgSettledAt);

/**
 * 확정하면 무엇이 일어나는가.
 *
 * 출석("done")만 차감한다. 노쇼와 취소는 수업이 일어나지 않았으므로 회원권이
 * 움직이지 않는다 -- 노쇼 과금은 센터의 정책이고 이 앱의 자동 계산 범위 밖이다.
 *
 * @param {{ lesson?: any, members?: Array<any>, passes?: Array<any>, now?: Date }} input
 *   members 화면이 쓰는 회원 목록(roster-bridge 의 결과). attendee.memberId 는
 *           레거시 id 일 수 있고, 회원권은 조직 clientId 로 붙어 있다.
 */
export function planLessonSettlement(input = {}) {
  const lesson = input.lesson;
  const members = Array.isArray(input.members) ? input.members : [];
  const passes = Array.isArray(input.passes) ? input.passes : [];
  const now = input.now instanceof Date ? input.now : new Date();

  const byId = new Map(members.map((member) => [text(member?.id), member]));
  const deductions = [];
  const skips = [];

  for (const attendee of attendeesOf(lesson)) {
    if (attendee.status !== "done") continue;
    const memberId = text(attendee.memberId);
    const member = byId.get(memberId);
    /* 회원권은 조직 clientId 로 붙어 있다. 맞물린 회원은 기기의 id 를 그대로
       쓰므로(roster-bridge) memberId 와 clientId 가 다르다 -- 여기서 바꿔
       읽지 않으면 모든 회원이 "회원권 없음"으로 건너뛰어진다. */
    const clientId = text(member?.orgClientId);
    if (!clientId) {
      skips.push({ memberId, clientId: "", reason: SETTLEMENT_SKIP.NO_CLIENT });
      continue;
    }
    const mine = passes.filter((pass) => pass && pass.clientId === clientId);
    if (mine.length === 0) {
      skips.push({ memberId, clientId, reason: SETTLEMENT_SKIP.NO_PASS });
      continue;
    }
    const pass = pickPassForClient(mine, clientId, now);
    if (!pass) {
      skips.push({ memberId, clientId, reason: SETTLEMENT_SKIP.SPENT });
      continue;
    }
    deductions.push({ memberId, clientId, pass });
  }

  return { deductions, skips };
}

/**
 * 확정하지 않은 수업인가. 하단의 "확인할 수업"이 이것을 센다.
 *
 * 확정을 잊으면 급여가 빠진다. 출석은 눌렸으니 화면상 처리된 것처럼 보이는데
 * 회원권은 그대로이고, 원장에 아무것도 없으므로 그 회차는 아무에게도 지급되지
 * 않는다 -- 큐에 잡히지 않으면 아무도 알아채지 못한다.
 *
 * 기구 그룹 수업과 개인 일정은 회원권과 무관하다. 취소된 수업도 확정할 것이 없다.
 *
 * @param {any} lesson
 * @param {{ now?: Date }} [options]
 */
export function needsSettlement(lesson, options = {}) {
  if (!lesson || lesson.personal || lesson.isSample) return false;
  if (isSettledLesson(lesson)) return false;
  if (lesson.groupCancelled) return false;
  const list = attendeesOf(lesson);
  // 기구 그룹은 참석자가 없다. 회원권이 아니라 진행 완료로 세는 수업이다.
  if (list.length === 0) return false;
  // 아직 아무도 정해지지 않았으면 그것은 "출석 미기록"이고 다른 줄이 잡는다.
  if (!list.some((attendee) => attendee.status === "done")) return false;
  const now = options.now instanceof Date ? options.now : new Date();
  return lessonHasEnded(lesson, now);
};

/** 수업이 끝났는가. 끝나기 전에 확정을 권하면 수업 중에 회원권이 빠진다. */
export function lessonHasEnded(lesson, now = new Date()) {
  const date = text(lesson?.date);
  const end = text(lesson?.end) || text(lesson?.start);
  if (!date || !end) return false;
  const at = new Date(`${date}T${end}:00`);
  return Number.isFinite(at.getTime()) && at.getTime() <= now.getTime();
}

/**
 * 확정한 결과를 일정에 적는다. 저장은 호출하는 쪽이 한다.
 *
 * 무엇을 차감했는지(passId · entryId)를 함께 남긴다. 대표가 되돌릴 때 어느 원장
 * 항목을 보정해야 하는지 이것으로 찾고, 없으면 회원권마다 원장을 훑어야 한다.
 *
 * @param {any} lesson
 * @param {{ at?: string, results?: Array<any>, skips?: Array<any> }} outcome
 */
export function applySettlementToLesson(lesson, outcome = {}) {
  const results = new Map((outcome.results || []).map((item) => [text(item.memberId), item]));
  const skips = new Map((outcome.skips || []).map((item) => [text(item.memberId), item]));
  return {
    ...lesson,
    orgSettledAt: text(outcome.at) || new Date().toISOString(),
    attendees: attendeesOf(lesson).map((attendee) => {
      const memberId = text(attendee.memberId);
      const result = results.get(memberId);
      const skip = skips.get(memberId);
      if (result) {
        return { ...attendee, orgPassId: result.passId, orgEntryId: result.entryId, orgSkip: "" };
      }
      if (skip) return { ...attendee, orgPassId: "", orgEntryId: "", orgSkip: skip.reason };
      return { ...attendee, orgPassId: "", orgEntryId: "", orgSkip: "" };
    }),
  };
}

/** 확정을 되돌린 뒤의 일정. 차감 흔적만 지우고 출석 상태는 그대로 둔다. */
export function clearSettlementFromLesson(lesson) {
  const next = { ...lesson, attendees: attendeesOf(lesson).map((attendee) => ({
    ...attendee, orgPassId: "", orgEntryId: "", orgSkip: "",
  })) };
  delete next.orgSettledAt;
  return next;
}

/** 이 수업이 차감한 것들. 대표의 되돌리기가 이 목록을 보정한다. */
export const settledDeductionsOf = (lesson) => attendeesOf(lesson)
  .filter((attendee) => text(attendee.orgPassId) && text(attendee.orgEntryId))
  .map((attendee) => ({
    memberId: text(attendee.memberId),
    passId: text(attendee.orgPassId),
    entryId: text(attendee.orgEntryId),
  }));

/**
 * 확정할 수 있는 상태인가.
 *
 * 시각은 보지 않는다. needsSettlement 는 "끝난 수업인데 아직 확정하지 않았다"를
 * 세는 쪽이라 시각을 보지만, 버튼은 강사가 수업 직후에 누르는 것이라 끝나는
 * 시각을 기다리게 하면 그 자리에서 끝낼 수 없다.
 *
 * 쓸 수 있는 회원권이 하나도 없어도 확정은 된다 -- 건너뛴 이유를 적고 닫는다.
 * 닫지 못하면 큐에 남아 강사가 매일 같은 줄을 본다.
 */
export const canSettleLesson = (lesson) => {
  if (isSettledLesson(lesson)) return false;
  if (!lesson || lesson.personal || lesson.isSample || lesson.groupCancelled) return false;
  const list = attendeesOf(lesson);
  if (list.length === 0) return false;
  return list.some((attendee) => ["done", "noshow", "cancel"].includes(attendee.status));
};

/** 이 회원권을 차감하면 잔여가 몇 회가 되는가. 확정 전에 보여줄 값이다. */
export const remainingAfter = (pass) => Math.max(0, remainingCountOf(pass) - 1);

/** 회원권이 살아 있는가. 화면이 "잔여 0"과 "종료"를 가르는 데 쓴다. */
export const isLivePass = (pass) => pass?.status === PASS_STATUS.ACTIVE;
