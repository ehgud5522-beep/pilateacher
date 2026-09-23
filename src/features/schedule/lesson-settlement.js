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

import { ATTENDANCE_STATUS, PASS_STATUS } from "../../data/schema/constants.js";
import { isDuetPass, passBelongsTo } from "../../data/schema/pass-clients.js";
import { isDeductablePass, remainingCountOf } from "../../data/repositories/pass-repository.js";

/** 왜 차감하지 않았는가. 화면이 이 값으로 무엇을 말할지 정한다. */
export const SETTLEMENT_SKIP = Object.freeze({
  /** 센터 명부에 없는 회원. 기기에만 있어 붙일 회원권이 없다. */
  NO_CLIENT: "no_client",
  /** 회원권이 한 장도 없다. 발급이 필요하다. */
  NO_PASS: "no_pass",
  /** 회원권은 있지만 쓸 수 있는 것이 없다 -- 잔여 0이거나 만료. */
  SPENT: "spent",
  /* 1:1 수업인데 1:1 회원권이 없다. 듀엣 회원권이 남아 있어도 쓰지 않는다 --
     그것은 짝과 함께 쓰는 회차이고, 혼자 온 수업에 빼면 짝의 몫이 사라진다.
     그 사실은 짝에게 아무도 알리지 않는다. */
  SOLO_PASS_MISSING: "solo_pass_missing",
  /** 둘이 함께 왔는데 공유 회원권에 남은 회차가 없다 (또는 만료). */
  DUET_PASS_SPENT: "duet_pass_spent",
  /* 차감을 시도했고 서버가 받지 않았다.

     성공한 차감이 이미 원장에 박혔으므로 이 수업은 확정된 것으로 닫는다. 열어
     두고 다시 확정하게 하면 성공했던 회차가 한 번 더 차감되고, 원장은 고칠 수
     없다. 못 나간 회차는 출석 체크 화면에서 따로 넣는다 -- 두 번 차감하는 것보다
     한 번 빠뜨리는 것이 고칠 수 있는 실패다. */
  WRITE_FAILED: "write_failed",
});

/**
 * 확정이 무엇으로 끝났는가.
 *
 * "차감 완료"와 "한 건도 못 했다"가 같은 문구로 나오면 강사는 끝난 줄 알고
 * 넘어가고, 그 회차는 아무에게도 지급되지 않는다.
 */
export const SETTLEMENT_OUTCOME = Object.freeze({
  /** 차감할 사람 전원이 차감됐다. */
  COMPLETE: "complete",
  /** 일부만 나갔다. 나간 것은 되돌릴 수 없으니 닫고, 못 나간 것을 말한다. */
  PARTIAL: "partial",
  /** 차감할 회차가 애초에 없었다 -- 전원 노쇼·취소. */
  NOTHING: "nothing",
  /** 한 건도 나가지 않았다. 닫지 않는다 -- 아래 closesSettlement 참고. */
  FAILED: "failed",
});

/**
 * @param {{ attempted?: number, written?: number, skipped?: number }} counts
 * @returns {string} SETTLEMENT_OUTCOME 중 하나
 */
export function settlementOutcome(counts = {}) {
  const attempted = Number(counts.attempted) || 0;
  const written = Number(counts.written) || 0;
  const skipped = Number(counts.skipped) || 0;
  if (written > 0) return (skipped === 0 && written === attempted)
    ? SETTLEMENT_OUTCOME.COMPLETE
    : SETTLEMENT_OUTCOME.PARTIAL;
  return attempted === 0 && skipped === 0 ? SETTLEMENT_OUTCOME.NOTHING : SETTLEMENT_OUTCOME.FAILED;
}

/**
 * 이 결과로 수업을 닫아도 되는가.
 *
 * "쓰다 실패하면 닫는다"는 일부라도 나갔을 때의 이야기다. 나간 차감은 되돌릴 수
 * 없으므로 다시 확정하게 하면 그 회차가 두 번 나간다 -- 그래서 닫는다.
 *
 * 한 건도 나가지 않았으면 그 이유가 사라진다. 두 번 차감할 것이 없고, 닫으면
 * 대가만 남는다: 카드가 잠기고, 큐가 더 이상 알리지 않고, 강사는 처리된 줄 안다.
 * 원장은 비어 있는데. 그래서 열어 두고 다시 시도할 수 있게 한다.
 *
 * 차감할 회차가 애초에 없었던 수업(전원 노쇼·취소)은 닫는다. 열어 두면 큐에 남아
 * 강사가 매일 같은 줄을 보고, 그 줄에는 할 일이 없다.
 */
export const closesSettlement = (outcome) => outcome !== SETTLEMENT_OUTCOME.FAILED;

/** 건너뛴 이유를 화면 문구로. 고칠 방법이 서로 다르므로 뭉개지 않는다. */
export const SETTLEMENT_SKIP_LABEL = Object.freeze({
  ["no_client"]: "센터 명부에 없는 회원입니다. 대표에게 등록을 요청해 주세요.",
  ["no_pass"]: "회원권이 없습니다. 발급 후 출석 체크에서 차감해 주세요.",
  ["spent"]: "쓸 수 있는 회원권이 없습니다 (잔여 0 또는 만료).",
  ["solo_pass_missing"]: "1:1 수업에 쓸 회원권이 없습니다. 듀엣 회원권은 두 분이 함께 수업할 때만 차감됩니다.",
  ["duet_pass_spent"]: "함께 쓰는 회원권에 남은 회차가 없습니다 (잔여 0 또는 만료).",
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
 * 여럿 중 하나를 고르는 순서. **차감 규칙 전체에서 이 정렬 하나만 쓴다.**
 *
 * 만료가 이른 것을 먼저 쓴다. 늦게 만료되는 것을 먼저 쓰면 이른 쪽이 쓰이지
 * 못한 채 만료되고, 회원은 돈을 낸 회차를 잃는다. 만료일이 같으면 먼저 발급된
 * 것을 쓴다 -- 먼저 팔린 것이 먼저 소진되는 것이 계약의 순서다.
 *
 * 고른 회원권 *안에서* 결제 회차와 서비스 회차 중 어느 쪽을 쓰는지는 다른 층위의
 * 판단이고, deduction-pricing.js 의 spendsServiceSession 이 답한다(서비스가
 * 먼저다). 이 판단이 먼저다 -- 만료는 회원이 돈을 낸 회차를 없애므로, 서비스가
 * 남은 회원권을 만료가 이른 회원권보다 앞세우지 않는다.
 *
 * @param {Array<any>} passes
 * @returns {any | null}
 */
export function soonestExpiring(passes) {
  const list = (Array.isArray(passes) ? passes : []).filter(Boolean);
  if (list.length === 0) return null;
  const at = (value) => {
    const date = value instanceof Date ? value : new Date(String(value ?? ""));
    const time = date.getTime();
    // 만료일이 없는 회원권은 맨 뒤로. 급한 것을 먼저 쓰는 것이 이 정렬의 목적이다.
    return Number.isFinite(time) ? time : Number.MAX_SAFE_INTEGER;
  };
  return list.slice().sort((left, right) => (
    at(left.expiresAt) - at(right.expiresAt) || at(left.createdAt) - at(right.createdAt)
  ))[0];
}

/**
 * 혼자 온 회원이 쓸 회원권. **듀엣 회원권은 후보가 아니다.**
 *
 * 만료가 이르다는 이유로 듀엣 회원권을 1:1 수업에 쓰면, 계약서 하나로 둘이
 * 나눠 쓰기로 한 회차가 한 사람의 1:1 수업으로 사라진다. 짝은 자기 잔여가 왜
 * 줄었는지 알 길이 없고, 원장은 append-only 라 되돌리는 것도 대표만 할 수 있다.
 *
 * @param {Array<any>} passes @param {string} clientId @param {Date} [now]
 * @returns {any | null}
 */
export function pickSoloPass(passes, clientId, now = new Date()) {
  const client = text(clientId);
  if (!client) return null;
  return soonestExpiring((Array.isArray(passes) ? passes : []).filter((pass) => (
    pass && !isDuetPass(pass) && passBelongsTo(pass, client) && isDeductablePass(pass, now)
  )));
}

/**
 * 이 사람들이 **함께** 쓰는 회원권 전부. 쓸 수 있는지는 보지 않는다.
 *
 * 쓸 수 없는 것까지 돌려주는 이유가 있다. 잔여가 0인 공유 회원권을 가진 두
 * 사람이 함께 왔을 때, 그것을 못 본 척하면 각자의 1:1 에서 한 번씩 빠져 **한
 * 수업에 두 회차가 나간다.** 그 둘은 듀엣이라는 사실이 먼저이고, 잔여가 없다는
 * 것은 재등록으로 풀 일이다.
 *
 * @param {Array<any>} passes @param {Array<string>} clientIds
 */
export function sharedDuetPasses(passes, clientIds) {
  const ids = (Array.isArray(clientIds) ? clientIds : []).map(text).filter(Boolean);
  if (ids.length < 2) return [];
  return (Array.isArray(passes) ? passes : []).filter((pass) => (
    pass && isDuetPass(pass) && ids.every((id) => passBelongsTo(pass, id))
  ));
}

/**
 * 둘이 함께 쓸 회원권 하나.
 *
 * @param {Array<any>} passes @param {Array<string>} clientIds @param {Date} [now]
 * @returns {any | null}
 */
export function pickSharedDuetPass(passes, clientIds, now = new Date()) {
  return soonestExpiring(sharedDuetPasses(passes, clientIds)
    .filter((pass) => isDeductablePass(pass, now)));
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
  return planPassSelection({ ...input, requireAttendance: true });
}

/** 일정의 출석 상태를 조직 참가자 문서의 값으로. 둘은 다른 어휘를 쓴다. */
const attendanceStatusOf = (status) => ({
  done: ATTENDANCE_STATUS.ATTENDED,
  noshow: ATTENDANCE_STATUS.NOSHOW,
  cancel: ATTENDANCE_STATUS.CANCELLED,
}[text(status)] || ATTENDANCE_STATUS.BOOKED);

/* 쌍을 이룰 수 있는 상태. 취소는 빠진다 -- 미리 취소한 사람은 명단에 없는
   것과 같고, 남은 한 명은 1:1 수업을 한 것이다 (확정 규칙 5번). */
const PAIRABLE = ["done", "noshow"];

/**
 * 이 수업에서 누가 어느 회원권을 쓰는가. **확정과 미리보기가 같이 쓴다.**
 *
 * 둘이 갈라지면 강사는 화면에서 본 금액과 다른 금액이 원장에 박히는 것을 보게
 * 되고, 그때는 되돌릴 수도 없다. 그래서 고르는 자리는 하나뿐이다.
 *
 * ── 차감 규칙 (2026-09-23 대표 확정) ──
 *   혼자 출석            1:1 회원권만, 만료 빠른 것부터
 *   둘 다 출석           공유 2:1 에서 1회만, 만료 빠른 것부터
 *   한 명 노쇼           공유 2:1 에서 1회 차감 (노쇼도 차감한다)
 *   둘 다 노쇼·취소      차감 없음
 *   명단에 한 명만       1:1 수업으로 보고 1:1 에서
 *   1:1 잔여 0          차감 없이 solo_pass_missing. 2:1 에서 절대 빼지 않는다
 *   각자 1:1 만 가진 둘  각자 1:1 에서 2회 (함께 쓰는 회원권이 없으면 듀엣이 아니다)
 *
 * 수업의 유형 글자(`type: "듀엣"`)는 보지 않는다. 각자 1:1 을 가진 두 사람이 한
 * 타임에 들어오는 것도 화면에는 듀엣으로 보이고, 그 수업은 2회 차감이 맞다.
 * 가르는 것은 **이 사람들이 함께 적힌 회원권이 있는가** 하나다.
 *
 * @param {{
 *   lesson?: any, members?: Array<any>, passes?: Array<any>, now?: Date,
 *   requireAttendance?: boolean,
 * }} input
 *   requireAttendance false 면 출석 상태를 보지 않는다 -- 미리보기는 아직
 *   아무도 누르지 않은 수업에서도 서야 한다.
 */
export function planPassSelection(input = {}) {
  const lesson = input.lesson;
  const members = Array.isArray(input.members) ? input.members : [];
  const passes = Array.isArray(input.passes) ? input.passes : [];
  const now = input.now instanceof Date ? input.now : new Date();
  const requireAttendance = input.requireAttendance !== false;

  const byId = new Map(members.map((member) => [text(member?.id), member]));
  const deductions = [];
  const skips = [];
  const rows = [];

  for (const attendee of attendeesOf(lesson)) {
    const status = text(attendee.status);
    /* 취소는 미리보기에서도 빠진다. 미리 취소한 사람을 짝으로 세면 화면은
       공유 회원권 금액을 보여주는데 확정은 1:1 에서 뺀다 -- 두 숫자가
       갈라지는 순간이고, 이 한 줄이 없을 때 실제로 갈라졌다. */
    if (status === "cancel") continue;
    if (requireAttendance && !PAIRABLE.includes(status)) continue;
    const memberId = text(attendee.memberId);
    const member = byId.get(memberId);
    /* 회원권은 조직 clientId 로 붙어 있다. 맞물린 회원은 기기의 id 를 그대로
       쓰므로(roster-bridge) memberId 와 clientId 가 다르다 -- 여기서 바꿔
       읽지 않으면 모든 회원이 "회원권 없음"으로 건너뛰어진다. */
    const clientId = text(member?.orgClientId);
    if (!clientId) {
      // 노쇼인 사람 때문에 "명부에 없다"를 띄우지 않는다 -- 차감할 것이 없다.
      if (!requireAttendance || status === "done") {
        skips.push({ memberId, clientId: "", reason: SETTLEMENT_SKIP.NO_CLIENT });
      }
      continue;
    }
    rows.push({ memberId, clientId, status });
  }

  /* 먼저 쌍을 묶는다. 나중에 묶으면 한 사람이 자기 1:1 에서 이미 빠진 뒤라,
     같은 수업에서 회차가 두 번 나간다. */
  const paired = new Set();
  for (let i = 0; i < rows.length; i += 1) {
    if (paired.has(i)) continue;
    for (let j = i + 1; j < rows.length; j += 1) {
      if (paired.has(j) || rows[j].clientId === rows[i].clientId) continue;
      const pair = [rows[i], rows[j]];
      const ids = pair.map((row) => row.clientId);
      if (sharedDuetPasses(passes, ids).length === 0) continue;
      paired.add(i);
      paired.add(j);

      /* 한 명이 노쇼여도 그대로 차감한다 -- 수업은 일어났다. 둘 다 안 왔으면
         일어나지 않은 것이라 아무것도 움직이지 않는다. */
      if (requireAttendance && !pair.some((row) => row.status === "done")) break;

      const pass = pickSharedDuetPass(passes, ids, now);
      if (!pass) {
        for (const row of pair) {
          skips.push({ memberId: row.memberId, clientId: row.clientId, reason: SETTLEMENT_SKIP.DUET_PASS_SPENT });
        }
        break;
      }
      deductions.push({
        /* 단수 칸은 그대로 둔다. 이 값을 읽는 자리가 이미 여럿이고, 복수를
           모르는 쪽도 대표 한 명으로는 맞게 돈다. */
        memberId: pair[0].memberId,
        clientId: pair[0].clientId,
        pass,
        memberIds: pair.map((row) => row.memberId),
        clientIds: ids,
        // 누가 왔고 누가 안 왔는지. 없으면 두 달 뒤 "그날 나는 안 갔는데"에 답할 것이 없다.
        attendanceByClientId: Object.fromEntries(
          pair.map((row) => [row.clientId, attendanceStatusOf(row.status)]),
        ),
        shared: true,
      });
      break;
    }
  }

  for (let i = 0; i < rows.length; i += 1) {
    if (paired.has(i)) continue;
    const { memberId, clientId, status } = rows[i];
    // 혼자 노쇼면 차감할 것이 없다. 노쇼 과금은 센터의 정책이고 이 앱 밖이다.
    if (requireAttendance && status !== "done") continue;

    const mine = passes.filter((pass) => pass && passBelongsTo(pass, clientId));
    if (mine.length === 0) {
      skips.push({ memberId, clientId, reason: SETTLEMENT_SKIP.NO_PASS });
      continue;
    }
    const pass = pickSoloPass(mine, clientId, now);
    if (!pass) {
      /* 쓸 수 있는 듀엣 회원권이 남아 있는데 1:1 이 없는 것과, 1:1 을 다 쓴
         것은 고치는 방법이 다르다 -- 앞은 짝과 함께 오면 되고 뒤는 재등록이다. */
      const hasUsableDuet = mine.some((item) => isDuetPass(item) && isDeductablePass(item, now));
      const ownsSolo = mine.some((item) => !isDuetPass(item));
      skips.push({
        memberId,
        clientId,
        reason: hasUsableDuet || !ownsSolo ? SETTLEMENT_SKIP.SOLO_PASS_MISSING : SETTLEMENT_SKIP.SPENT,
      });
      continue;
    }
    deductions.push({
      memberId,
      clientId,
      pass,
      memberIds: [memberId],
      clientIds: [clientId],
      attendanceByClientId: { [clientId]: attendanceStatusOf(status) },
      shared: false,
    });
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
 * @param {{ at?: string, outcome?: string, results?: Array<any>, skips?: Array<any> }} outcome
 */
export function applySettlementToLesson(lesson, outcome = {}) {
  /* 공유 회원권에서 나간 한 건은 두 사람의 줄에 모두 적힌다. 짝의 줄이 비어
     있으면 그 사람 화면에는 차감되지 않은 것으로 보이고, 실제로는 나갔다. */
  const results = new Map((outcome.results || []).flatMap((item) => (
    (Array.isArray(item.memberIds) && item.memberIds.length ? item.memberIds : [item.memberId])
      .map((memberId) => [text(memberId), item])
  )));
  const skips = new Map((outcome.skips || []).map((item) => [text(item.memberId), item]));
  return {
    ...lesson,
    orgSettledAt: text(outcome.at) || new Date().toISOString(),
    /* 전원 성공과 일부 성공을 화면이 구분해야 한다. 세지 않고 문구를 정하면
       "0명 차감"에도 "차감 완료"가 나온다. */
    orgSettledOutcome: text(outcome.outcome) || settlementOutcome({
      attempted: (outcome.results || []).length + (outcome.skips || []).length,
      written: (outcome.results || []).length,
      skipped: (outcome.skips || []).length,
    }),
    attendees: attendeesOf(lesson).map((attendee) => {
      const memberId = text(attendee.memberId);
      const result = results.get(memberId);
      const skip = skips.get(memberId);
      if (result) {
        return {
          ...attendee,
          orgPassId: result.passId,
          orgEntryId: result.entryId,
          orgSkip: "",
          orgSkipCode: "",
        };
      }
      /* 사유 코드를 버리지 않는다. "차감이 저장되지 않았습니다"만으로는 무엇을
         고쳐야 하는지 알 수 없다 -- 원본 코드가 있어야 원인이 확정된다. */
      if (skip) {
        return {
          ...attendee,
          orgPassId: "",
          orgEntryId: "",
          orgSkip: skip.reason,
          orgSkipCode: String(skip.code || ""),
        };
      }
      return { ...attendee, orgPassId: "", orgEntryId: "", orgSkip: "", orgSkipCode: "" };
    }),
  };
}

/**
 * 확정을 시도한 뒤의 일정.
 *
 * 한 건이라도 나갔으면 확정으로 닫는다. 한 건도 나가지 않았으면 사유만 적고
 * 열어 둔다 -- 카드가 그 사유를 보여주고 다시 확정할 수 있어야 한다. 두 번
 * 차감할 것이 없으므로 다시 시도해도 안전하다.
 *
 * @param {any} lesson
 * @param {{ at?: string, outcome?: string, results?: Array<any>, skips?: Array<any> }} outcome
 */
export function recordSettlementAttempt(lesson, outcome = {}) {
  const applied = applySettlementToLesson(lesson, outcome);
  if (closesSettlement(applied.orgSettledOutcome)) return applied;
  const open = { ...applied };
  delete open.orgSettledAt;
  delete open.orgSettledOutcome;
  return open;
}

/** 확정을 되돌린 뒤의 일정. 차감 흔적만 지우고 출석 상태는 그대로 둔다. */
export function clearSettlementFromLesson(lesson) {
  const next = { ...lesson, attendees: attendeesOf(lesson).map((attendee) => ({
    ...attendee, orgPassId: "", orgEntryId: "", orgSkip: "", orgSkipCode: "",
  })) };
  delete next.orgSettledAt;
  return next;
}

/**
 * 차감하지 못한 사람들. 확정 블록이 이 목록을 그대로 보여준다.
 *
 * 토스트가 "카드에서 이유를 확인해 주세요"라고 말하는데 카드에 없으면, 그 안내는
 * 강사를 빈 화면으로 보내는 것이다.
 */
export const settlementSkipsOf = (lesson) => attendeesOf(lesson)
  .filter((attendee) => text(attendee.orgSkip))
  .map((attendee) => ({
    memberId: text(attendee.memberId),
    reason: text(attendee.orgSkip),
    code: text(attendee.orgSkipCode),
  }));

/**
 * 이 수업이 차감한 것들. 대표의 되돌리기가 이 목록을 보정한다.
 *
 * 원장 항목 하나에 한 줄이다. 듀엣은 두 사람의 줄에 같은 항목이 적혀 있는데,
 * 그것을 둘로 세면 **한 번 나간 회차를 두 번 되돌린다** -- 보정도 append-only
 * 라 그 두 번째는 지울 수 없고, 잔여가 하나 늘어난 채로 남는다.
 */
export const settledDeductionsOf = (lesson) => {
  const seen = new Set();
  const found = [];
  for (const attendee of attendeesOf(lesson)) {
    const passId = text(attendee.orgPassId);
    const entryId = text(attendee.orgEntryId);
    if (!passId || !entryId) continue;
    const key = `${passId}/${entryId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ memberId: text(attendee.memberId), passId, entryId });
  }
  return found;
};

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
