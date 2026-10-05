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

import {
  ATTENDANCE_STATUS, PASS_STATUS, PAY_CATEGORY, isDiosaCategory,
} from "../../data/schema/constants.js";
import { isDuetPass, passBelongsTo } from "../../data/schema/pass-clients.js";
import { isDeductablePass, remainingCountOf } from "../../data/repositories/pass-repository.js";
import { lessonTypeKeyOf } from "./lesson-types.js";

/* 2:1 상품. 혼자 온 수업이 여기서 빠지면 짝의 몫이 사라지므로, 짝이 적히지
   않은 2:1 회원권이라도 1:1 후보로 쓰지 않는다 -- 그런 회원권은 이관이 잘못
   만든 것이고(migration-repository.js 의 duet_partner_required), 고칠 일이지
   쓸 일이 아니다. */
/** @type {readonly string[]} */
const DUET_PAY_CATEGORIES = Object.freeze([PAY_CATEGORY.PT_2_1_NEW, PAY_CATEGORY.PT_2_1_REPURCHASE]);

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
  /* 관리 수업인데 그 등급의 디오사 회원권이 없다. PT 회원권이 남아 있어도
     쓰지 않는다 -- 다른 상품이고 단가도 다르다. 관리 A 수업을 1:1 PT 에서
     빼면 회원은 25,000~45,000 짜리 회차를 20,000 짜리 수업에 잃는다. */
  CARE_PASS_MISSING: "care_pass_missing",
  /** 그 등급의 디오사 회원권은 있는데 잔여가 없다 (또는 만료). */
  CARE_PASS_SPENT: "care_pass_spent",
  /* 2:1 수업인데 두 사람이 함께 쓰는 회원권이 아예 없다. 위의 "잔여 없음" 과
     고칠 방법이 다르다 -- 저쪽은 재등록이고 이쪽은 발급이다. 각자 1:1 을
     가지고 있어도 거기서 빼지 않는다. 그 둘은 2:1 단가로 계약한 적이 없고,
     수업 한 번에 회차가 둘 나가면 회원이 그만큼 손해를 본다. */
  DUET_PASS_MISSING: "duet_pass_missing",
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
  ["solo_pass_missing"]: "1:1 회원권이 없어요. 대표에게 문의해 주세요.",
  ["duet_pass_spent"]: "함께 쓰는 회원권에 남은 회차가 없습니다 (잔여 0 또는 만료).",
  ["duet_pass_missing"]: "2:1 회원권이 없어요. 대표에게 문의해 주세요.",
  /* PT 가 남아 있어도 쓰지 않는다. 그 사실을 말해 주지 않으면 강사는 "회원권이
     있는데 왜 안 되지" 에서 멈춘다. */
  ["care_pass_missing"]: "디오사 회원권이 없어요. PT 회원권에서는 빠지지 않습니다.",
  ["care_pass_spent"]: "디오사 회원권에 남은 회차가 없습니다 (잔여 0 또는 만료).",
  ["write_failed"]: "차감이 저장되지 않았습니다. 출석 체크에서 다시 시도해 주세요.",
});

const text = (value) => String(value ?? "").trim();

/**
 * 아직 시작하지 않은 수업. **버튼을 없애지 않고 잠근다.**
 *
 * 잠긴 버튼은 이유를 말할 수 있지만 없는 버튼은 아무 말도 못 한다.
 */
export const NOT_STARTED_NOTICE = "아직 시작하지 않은 수업입니다. 시작 시각이 지나면 확정할 수 있어요.";

/**
 * 차감이 거부된 이유를 사람 말로. 코드는 화면에 함께 남는다.
 *
 * Keep in sync with DEDUCT_WINDOW in pass-repository.js. 코드만 보여 주면
 * 대표는 날짜가 미래인지 너무 오래됐는지 알 수 없다.
 */
export const DEDUCTION_CODE_LABEL = Object.freeze({
  ["occurred_at_future"]: "아직 시작하지 않은 수업입니다. 수업이 시작한 뒤에 확정해 주세요.",
  ["occurred_at_too_old"]: "7일이 지난 수업은 이 화면에서 차감할 수 없습니다. 대표에게 문의해 주세요.",
  ["occurred_at_invalid"]: "수업 시각을 읽지 못했습니다. 일정의 날짜와 시간을 확인해 주세요.",
});

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
 * 1:1 수업이 쓸 수 있는 회원권인가. **2:1 은 어느 쪽으로도 후보가 아니다.**
 *
 * 두 가지로 거른다. 짝이 적힌 회원권은 계약서 하나로 둘이 나눠 쓰기로 한
 * 회차이고, 2:1 상품은 짝이 적히지 않았더라도 2:1 단가로 판 것이다. 둘 중
 * 하나라도 1:1 수업에서 빠지면 회원은 자기가 산 것과 다른 회차를 잃는다.
 *
 * 서비스·렛미인·기타는 그대로 후보다 -- 그 셋은 사람 수가 상품으로 정해지지
 * 않으므로 여기서 가를 근거가 없다.
 *
 * @param {any} pass
 */
export const isSoloCandidate = (pass) => Boolean(pass)
  && !isDuetPass(pass)
  && !DUET_PAY_CATEGORIES.includes(text(pass.category))
  /* 디오사도 아니다 (2026-10-05). 관리 수업이 PT 에서 빠지지 않는 것과 같은
     규칙이고, 이쪽이 더 조용하다 -- 만료가 이른 디오사가 있으면 1:1 PT 수업이
     그것을 먼저 가져간다. 회원은 20,000 짜리 관리 회차를 45,000 짜리 수업에
     잃고, 아무 화면도 그 사실을 말하지 않는다. */
  && !isDiosaCategory(text(pass.category));

/**
 * 이 수업이 어느 디오사 회원권에서 빠지는가. 관리 수업이 아니면 빈 문자열이다.
 *
 * 수업 종류가 곧 회원권 종류다 -- 관리 A 는 디오사 A 에서, 관리 B 는 디오사
 * B 에서만 빠진다. 사람 수를 세지 않는 것과 같은 규칙이고, 같은 이유다:
 * 강사가 등록할 때 정한 종류대로 빠질 것을 회원도 강사도 기대한다.
 *
 * @param {any} lesson
 * @returns {string} PAY_CATEGORY.DIOSA_A | DIOSA_B | ""
 */
export const CARE_GRADE = Object.freeze({ NONE: "", A: "a", B: "b" });

/** 그 등급이 가리키는 디오사 카테고리. 등급이 없으면 빈 문자열이다. */
export function careCategoryOfGrade(grade) {
  const value = text(grade);
  if (value === CARE_GRADE.A) return PAY_CATEGORY.DIOSA_A;
  if (value === CARE_GRADE.B) return PAY_CATEGORY.DIOSA_B;
  return "";
}

/**
 * 이 참가자가 고른 **추가 관리** 등급.
 *
 * 디오사는 PT 와 별도로 끊는 추가 관리권이다 (2026-10-05). 한 수업에서 PT
 * 회원권과 디오사 회원권이 **함께** 빠질 수 있고, 2:1 이면 두 사람이 각자
 * 다르게 고를 수 있어 수업이 아니라 참가자에 붙는다.
 *
 * 단독 관리 수업(수업 종류가 관리 A·B)과는 다른 것이다. 저쪽은 PT 대신이고
 * 이쪽은 PT 에 더하는 것이다 -- 섞이면 한 수업에서 디오사가 두 번 빠진다.
 */
export const careGradeOf = (attendee) => {
  const grade = text(attendee?.careGrade);
  return grade === CARE_GRADE.A || grade === CARE_GRADE.B ? grade : CARE_GRADE.NONE;
};

export function carePayCategory(lesson) {
  const key = lessonTypeKeyOf(lesson);
  if (key === "care_a") return PAY_CATEGORY.DIOSA_A;
  if (key === "care_b") return PAY_CATEGORY.DIOSA_B;
  return "";
}

/**
 * 그 등급의 디오사 회원권. **PT 회원권은 후보가 아니다.**
 *
 * @param {Array<any>} passes @param {string} clientId @param {string} category @param {Date} [now]
 */
export function pickCarePass(passes, clientId, category, now = new Date()) {
  const client = text(clientId);
  const wanted = text(category);
  if (!client || !wanted) return null;
  return soonestExpiring((Array.isArray(passes) ? passes : []).filter((pass) => (
    text(pass?.category) === wanted && passBelongsTo(pass, client) && isDeductablePass(pass, now)
  )));
}

/** 그 등급의 디오사 회원권을 한 장이라도 가졌는가. 없는 것과 다 쓴 것을 가른다. */
export function ownsCarePass(passes, clientId, category) {
  const client = text(clientId);
  const wanted = text(category);
  return (Array.isArray(passes) ? passes : []).some((pass) => (
    text(pass?.category) === wanted && passBelongsTo(pass, client)
  ));
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
    isSoloCandidate(pass) && passBelongsTo(pass, client) && isDeductablePass(pass, now)
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

/** 짝이 왜 빠졌는가. 문구가 달라야 강사가 무엇을 눌러야 할지 안다. */
export const ABSENT_PARTNER = Object.freeze({
  /** 미리 취소했다. 수업은 혼자 받았을 가능성이 높다. */
  CANCELLED: "cancelled",
  /** 출석을 아직 표시하지 않았다. 안 온 것인지 안 누른 것인지 모른다. */
  UNMARKED: "unmarked",
});

/**
 * 듀엣으로 등록했는데 짝이 빠진 수업. **확정 전에 물어볼 것이 있다.**
 *
 * 수업 종류가 기준이 된 뒤로 이런 수업은 2:1 회원권에서 빠진다. 그것이 맞는
 * 경우가 많다 -- 짝이 못 왔어도 그 시간은 듀엣으로 열렸다. 하지만 **혼자 1:1
 * 수업을 받은 날**도 화면에서는 똑같이 보이고, 그때 2:1 에서 빼면 둘이 나눠
 * 쓰기로 한 회차가 한 사람의 수업으로 사라진다.
 *
 * 둘을 가를 수 있는 것은 그 자리에 있던 강사뿐이다. 그래서 짐작하지 않고
 * 묻는다 -- 확정을 누르기 전에, 되돌릴 수 없게 되기 전에.
 *
 * @param {any} lesson
 * @returns {{ presentMemberId: string, absentMemberId: string, reason: string } | null}
 *   null 이면 물어볼 것이 없다 (듀엣이 아니거나, 둘 다 왔거나, 둘 다 안 왔거나)
 */
export function absentPartnerPrompt(lesson) {
  if (!lesson || isSettledLesson(lesson)) return null;
  if (lessonTypeKeyOf(lesson) !== "duet") return null;

  const list = attendeesOf(lesson);
  if (list.length !== 2) return null;

  const present = list.filter((attendee) => text(attendee.status) === "done");
  /* 한 명만 왔을 때만 묻는다. 둘 다 왔으면 듀엣이 맞고, 둘 다 안 왔으면
     차감 자체가 없어 물어볼 것이 없다. */
  if (present.length !== 1) return null;

  const absent = list.find((attendee) => text(attendee.status) !== "done");
  const status = text(absent?.status);
  /* 노쇼는 묻지 않는다. 오기로 해 놓고 안 온 것이라 수업은 듀엣으로 열렸고,
     그 자리는 비워 둔 채 진행된다 -- 2:1 에서 빠지는 것이 맞다. */
  if (status !== "cancel" && status !== "booked") return null;

  return {
    presentMemberId: text(present[0].memberId),
    absentMemberId: text(absent.memberId),
    reason: status === "cancel" ? ABSENT_PARTNER.CANCELLED : ABSENT_PARTNER.UNMARKED,
  };
}

/**
 * 그 수업을 1:1 로 바꾼 모습. **쓰지 않는다 -- 새 일정을 돌려줄 뿐이다.**
 *
 * 온 사람만 남긴다. 유형 선택으로 바꾸면 첫 번째 칸이 남는데, 빠진 쪽이 첫
 * 번째면 **온 사람이 지워지고 안 온 사람이 남는다.** 그 일정으로 확정하면
 * 수업을 받지 않은 사람의 회원권에서 회차가 나간다.
 *
 * @param {any} lesson @param {string} keepMemberId 남길 회원
 */
export function toSoloLesson(lesson, keepMemberId) {
  const keep = text(keepMemberId);
  const attendee = attendeesOf(lesson).find((item) => text(item.memberId) === keep);
  if (!attendee) return lesson;
  return { ...lesson, type: "개인레슨", attendees: [attendee] };
}

/** 이 수업이 이미 확정됐는가. *//** 이 수업이 이미 확정됐는가. */
export const isSettledLesson = (lesson) => Boolean(lesson?.orgSettledAt);

/**
 * 확정하면 무엇이 일어나는가.
 *
 * **출석과 노쇼가 차감한다. 취소만 움직이지 않는다.**
 *
 * 2026-10-04 에 대표가 정했다: 노쇼도 1회 차감하고, 그 회차의 단가는 출석과
 * 같다. 회원은 그 시간을 예약했고 강사는 그 시간을 비워 두었으므로, 회차도
 * 수업료도 수업이 일어난 것과 같게 센다.
 *
 * 취소는 다르다 -- 미리 알리고 뺀 자리라 아무것도 움직이지 않는다.
 *
 * 그 전에는 노쇼가 아무것도 차감하지 않았다. 그래서 노쇼만 있는 수업은
 * 확정해도 0건이 나갔고, 큐에도 잡히지 않아 조용히 사라졌다.
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

/**
 * **수업이 일어난 것으로 세는 상태.** 이 목록이 두 가지를 정한다:
 * 듀엣에서 쌍을 이루는가, 그리고 회원권을 차감하는가.
 *
 * 취소는 빠진다 -- 미리 알리고 뺀 자리라 아무것도 움직이지 않고, 듀엣에서도
 * 명단에 없는 것과 같아 남은 한 명은 1:1 수업을 한 것이다 (확정 규칙 5번).
 *
 * 노쇼는 들어간다. 회원은 그 시간을 예약했고 강사는 그 시간을 비워 두었다 --
 * 2026-10-04 에 대표가 정했고, 단가도 출석과 같다.
 */
const PAIRABLE = ["done", "noshow"];

/**
 * 이 수업에서 누가 어느 회원권을 쓰는가. **확정과 미리보기가 같이 쓴다.**
 *
 * 둘이 갈라지면 강사는 화면에서 본 금액과 다른 금액이 원장에 박히는 것을 보게
 * 되고, 그때는 되돌릴 수도 없다. 그래서 고르는 자리는 하나뿐이다.
 *
 * ── 차감 규칙 (2026-10-01 대표 확정) ──
 * 가르는 것은 **일정에 등록한 수업 종류** 하나다 (lessonTypeKeyOf). 강사가
 * 카드에서 보는 글자와 회원권에서 빠지는 회차가 같은 것을 가리킨다.
 *
 *   개인 수업           각자 1:1 회원권에서 1회씩. 2:1 에서는 빼지 않는다
 *   듀엣 수업           두 사람이 함께 적힌 회원권에서 1회만
 *   듀엣인데 한 명 결석  그래도 공유 회원권에서 1회 (노쇼든 취소든 종류가 기준)
 *   둘 다 노쇼·취소      차감 없음
 *   고른 종류가 없음     차감 없이 막는다. 다른 종류에서 몰래 빼지 않는다
 *
 * ── 2026-09-23 결정을 뒤집은 것 ──
 * 그때는 "이 사람들이 함께 적힌 회원권이 있는가" 로 갈랐다. 그래서 각자 1:1 만
 * 가진 두 사람이 듀엣 한 타임에 들어오면 각자의 1:1 에서 2회가 나갔다. 숫자로는
 * 맞지만 강사가 예측할 수 없었다 -- 같은 듀엣 카드가 회원권 구성에 따라 1회도
 * 되고 2회도 됐다. 지금은 그 수업이 차감되지 않고 막힌다 (duet_pass_missing).
 * 대표가 2:1 회원권을 발급하면 풀린다.
 *
 * 취소도 같이 바뀌었다. 전에는 미리 취소한 사람을 명단에서 지워 남은 한 명이
 * 1:1 수업을 한 것으로 봤다. 지금은 듀엣으로 등록된 수업이면 그대로 듀엣이다.
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

  /* 수업 종류가 기준이다. 출석 인원을 세지 않는다 -- 한 명이 빠졌다고 듀엣이
     개인 수업이 되지는 않고, 강사는 등록할 때 정한 종류대로 빠질 것을 기대한다. */
  const duetLesson = lessonTypeKeyOf(lesson) === "duet";

  for (const attendee of attendeesOf(lesson)) {
    const status = text(attendee.status);
    /* 취소한 사람도 듀엣에서는 명단에 남긴다. 공유 회원권을 찾으려면 두 사람의
       clientId 가 모두 있어야 하고, 지우면 남은 한 명이 1:1 로 떨어진다 --
       2026-09-23 에는 그것이 규칙이었고 지금은 아니다. */
    if (status === "cancel" && !duetLesson) continue;
    if (requireAttendance && !duetLesson && !PAIRABLE.includes(status)) continue;
    const memberId = text(attendee.memberId);
    const member = byId.get(memberId);
    /* 회원권은 조직 clientId 로 붙어 있다. 맞물린 회원은 기기의 id 를 그대로
       쓰므로(roster-bridge) memberId 와 clientId 가 다르다 -- 여기서 바꿔
       읽지 않으면 모든 회원이 "회원권 없음"으로 건너뛰어진다. */
    const clientId = text(member?.orgClientId);
    if (!clientId) {
      /* 노쇼도 차감하므로 노쇼인 사람도 명부에 있어야 한다. 취소한 사람은
         차감할 것이 없어 띄우지 않는다. */
      if (!requireAttendance || PAIRABLE.includes(status)) {
        skips.push({ memberId, clientId: "", reason: SETTLEMENT_SKIP.NO_CLIENT });
      }
      continue;
    }
    rows.push({ memberId, clientId, status, attendee });
  }

  /* 관리 수업이면 그 등급의 디오사 회원권에서만 뺀다. PT 쪽 판정을 아예
     타지 않는다 -- 듀엣 후보도 1:1 후보도 여기서는 답이 아니다. */
  const careCategory = carePayCategory(lesson);

  /* ── 추가 관리 ────────────────────────────────────────────────────────
     PT 와 **함께** 빠지는 디오사 회차다. 단독 관리 수업에는 붙지 않는다 --
     저쪽은 PT 대신이라, 겹치면 한 수업에서 디오사가 두 번 나간다.

     **반쪽으로 끝내지 않는다.** 디오사가 없거나 다 썼으면 그 사람의 PT 도
     빼지 않는다 (아래 careBlocked). 한쪽만 나가면 회원은 받지 않은 관리의
     회차를 잃거나, 받은 관리가 공짜가 된다 -- 원장은 append-only 라 어느
     쪽도 되돌릴 수 없다. */
  const careAddOns = [];
  const careBlocked = new Set();
  if (!careCategory) {
    for (const row of rows) {
      const category = careCategoryOfGrade(careGradeOf(row.attendee));
      if (!category) continue;
      const carePass = pickCarePass(passes, row.clientId, category, now);
      if (!carePass) {
        careBlocked.add(row.clientId);
        skips.push({
          memberId: row.memberId,
          clientId: row.clientId,
          reason: ownsCarePass(passes, row.clientId, category)
            ? SETTLEMENT_SKIP.CARE_PASS_SPENT
            : SETTLEMENT_SKIP.CARE_PASS_MISSING,
        });
        continue;
      }
      careAddOns.push({
        memberId: row.memberId,
        clientId: row.clientId,
        pass: carePass,
        memberIds: [row.memberId],
        clientIds: [row.clientId],
        attendanceByClientId: { [row.clientId]: attendanceStatusOf(row.status) },
        shared: false,
        /* 미리보기와 화면이 PT 줄과 가른다. 한 수업에 두 줄이 서는데 어느
           것이 무엇인지 말하지 않으면 강사는 두 배로 빠진 줄 안다. */
        care: true,
        careCategory: category,
      });
    }
  }

  if (duetLesson) {
    /* 수업은 하나이고 회원권도 하나다. 두 사람을 각자 훑지 않는다 -- 그렇게
       하면 한 수업에서 회차가 두 번 나가고, 원장은 되돌릴 수 없다. */
    const unique = [];
    for (const row of rows) if (!unique.some((item) => item.clientId === row.clientId)) unique.push(row);

    /* 둘이 아니면 짝을 정할 수 없다. 짐작해서 아무나 묶으면 엉뚱한 사람의
       회차가 나가므로, 묶지 않고 막는다. */
    if (unique.length !== 2) {
      for (const row of unique) {
        skips.push({ memberId: row.memberId, clientId: row.clientId, reason: SETTLEMENT_SKIP.DUET_PASS_MISSING });
      }
      return { deductions, skips };
    }

    /* 둘 다 취소면 일어나지 않은 수업이다. 둘 다 노쇼면 일어난 것으로 센다 --
       강사는 그 시간을 비워 두었고 회원은 알리지 않았다. */
    if (requireAttendance && !unique.some((row) => PAIRABLE.includes(row.status))) {
      return { deductions, skips };
    }

    /* 둘이 한 장을 나눠 쓰므로 한 명만 빼는 길이 없다. 한 명의 디오사가
       막히면 그 수업은 통째로 멈춘다 -- 사유는 위에서 이미 적었다. */
    if (careBlocked.size > 0) return { deductions, skips };

    const ids = unique.map((row) => row.clientId);
    /* 없는 것과 다 쓴 것은 고칠 방법이 다르다 -- 앞은 발급이고 뒤는 재등록이다.
       어느 쪽이든 각자의 1:1 에서 빼지는 않는다. */
    const shared = sharedDuetPasses(passes, ids);
    const pass = pickSharedDuetPass(passes, ids, now);
    if (!pass) {
      const reason = shared.length === 0 ? SETTLEMENT_SKIP.DUET_PASS_MISSING : SETTLEMENT_SKIP.DUET_PASS_SPENT;
      for (const row of unique) skips.push({ memberId: row.memberId, clientId: row.clientId, reason });
      return { deductions, skips };
    }

    deductions.push({
      /* 단수 칸은 그대로 둔다. 이 값을 읽는 자리가 이미 여럿이고, 복수를
         모르는 쪽도 대표 한 명으로는 맞게 돈다. */
      memberId: unique[0].memberId,
      clientId: unique[0].clientId,
      pass,
      memberIds: unique.map((row) => row.memberId),
      clientIds: ids,
      // 누가 왔고 누가 안 왔는지. 없으면 두 달 뒤 "그날 나는 안 갔는데"에 답할 것이 없다.
      attendanceByClientId: Object.fromEntries(
        unique.map((row) => [row.clientId, attendanceStatusOf(row.status)]),
      ),
      shared: true,
    });
    deductions.push(...careAddOns);
    return { deductions, skips };
  }

  for (const row of rows) {
    const { memberId, clientId, status } = row;
    /* 노쇼도 차감한다 (위 머리말). 취소만 건너뛴다. */
    if (requireAttendance && !PAIRABLE.includes(status)) continue;
    // 추가 관리가 막힌 사람. 사유는 위에서 적었고, PT 도 빼지 않는다.
    if (careBlocked.has(clientId)) continue;

    const mine = passes.filter((pass) => pass && passBelongsTo(pass, clientId));
    if (mine.length === 0) {
      skips.push({
        memberId, clientId,
        reason: careCategory ? SETTLEMENT_SKIP.CARE_PASS_MISSING : SETTLEMENT_SKIP.NO_PASS,
      });
      continue;
    }

    if (careCategory) {
      const carePass = pickCarePass(passes, clientId, careCategory, now);
      if (!carePass) {
        /* 없는 것과 다 쓴 것은 고칠 방법이 다르다 -- 앞은 발급이고 뒤는
           재등록이다. PT 가 남아 있어도 둘 중 하나다. */
        skips.push({
          memberId, clientId,
          reason: ownsCarePass(passes, clientId, careCategory)
            ? SETTLEMENT_SKIP.CARE_PASS_SPENT
            : SETTLEMENT_SKIP.CARE_PASS_MISSING,
        });
        continue;
      }
      deductions.push({ memberId, clientId, pass: carePass });
      continue;
    }
    const pass = pickSoloPass(mine, clientId, now);
    if (!pass) {
      /* 쓸 수 있는 2:1 이 남아 있는 것과 1:1 을 다 쓴 것은 고치는 방법이
         다르다 -- 앞은 2:1 수업으로 등록하는 일이고 뒤는 재등록이다. 1:1 을
         한 장도 가진 적이 없는 사람도 앞쪽이다. 발급이 필요하다. */
      const hasUsableDuet = mine.some((item) => !isSoloCandidate(item) && isDeductablePass(item, now));
      const ownsSolo = mine.some(isSoloCandidate);
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

  /* PT 가 실제로 나간 사람의 추가 관리만 붙인다. PT 가 막힌 사람(회원권 없음·
     잔여 0)에게 디오사만 빼면 그것이 바로 반쪽 차감이다. */
  const deducted = new Set(deductions.flatMap((item) => item.clientIds || [item.clientId]));
  for (const add of careAddOns) {
    if (deducted.has(add.clientId)) deductions.push(add);
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
  /* 아직 아무도 정해지지 않았으면 그것은 "출석 미기록"이고 다른 줄이 잡는다.

     **노쇼도 센다.** 전에는 "done" 만 봤고, 그래서 노쇼만 있는 수업은 큐에
     아예 들어오지 않았다 -- 강사에게는 확정할 자리가 사라진 것으로 보였고,
     차감도 급여도 없이 조용히 넘어갔다. 2026-10-04 에 대표가 본 것이 그것이다.

     취소만 있는 수업은 그대로 빠진다. 차감할 것이 없어 닦달할 이유가 없다. */
  if (!list.some((attendee) => PAIRABLE.includes(text(attendee.status)))) return false;
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
export const canSettleLesson = (lesson, options = {}) => {
  if (isSettledLesson(lesson)) return false;
  if (!lesson || lesson.personal || lesson.isSample || lesson.groupCancelled) return false;
  const list = attendeesOf(lesson);
  if (list.length === 0) return false;
  return list.some((attendee) => ["done", "noshow", "cancel"].includes(attendee.status));
};

/**
 * 수업이 시작했는가. 차감의 occurredAt 이 이 시각이다.
 *
 * ── 이것으로 카드를 감추지 않는다 ──
 * 한 번 그렇게 만들었다가 되돌렸다. 시작 전이라고 확정 블록을 통째로 숨겼더니
 * **이미 실패한 수업의 사유와 [다시 확정]까지 사라졌다.** 토스트는 "아래 이유를
 * 보고 다시 시도해 주세요" 라고 말하는데 아래에 아무것도 없었다.
 *
 * 그래서 판정은 둘로 나눈다: 확정할 수 있는 수업인가(canSettleLesson)와,
 * 지금 눌러도 서버가 받는가(여기). 앞은 카드를 세우고 뒤는 버튼을 잠근다 --
 * 잠긴 버튼은 이유를 말할 수 있지만 없는 버튼은 아무 말도 못 한다.
 */
export function lessonHasStarted(lesson, now = new Date()) {
  const date = text(lesson?.date);
  const start = text(lesson?.start);
  if (!date || !start) return true;
  const at = new Date(`${date}T${start}:00`);
  // 읽을 수 없는 시각이면 막지 않는다 -- 서버가 마지막 문이다.
  if (!Number.isFinite(at.getTime())) return true;
  return at.getTime() <= now.getTime();
}

/** 이 회원권을 차감하면 잔여가 몇 회가 되는가. 확정 전에 보여줄 값이다. */
export const remainingAfter = (pass) => Math.max(0, remainingCountOf(pass) - 1);

/** 회원권이 살아 있는가. 화면이 "잔여 0"과 "종료"를 가르는 데 쓴다. */
export const isLivePass = (pass) => pass?.status === PASS_STATUS.ACTIVE;
