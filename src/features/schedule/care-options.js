/**
 * 디오사 관리 — **고르기 전에 화면이 알아야 하는 것들.**
 *
 * 차감 자체는 lesson-settlement.js 가 한다. 여기 있는 것은 그 앞의 판정이다:
 * 이 회원이 어떤 관리권을 가졌는가, 고를 수 있는가, 못 고르면 왜인가.
 *
 * ── 왜 앞에서 막아야 하는가 ──
 * 디오사는 **반쪽으로 끝내지 않는다.** PT 와 함께 빠지는데 디오사가 없으면
 * PT 도 빠지지 않는다 (lesson-settlement 의 careBlocked). 그 규칙 자체는
 * 옳지만, 고를 수 있는 칩을 열어 두면 강사는 **PT 수업이 왜 막혔는지** 모른 채
 * 확정 화면에서 멈춘다 -- 2026-10-10 에 실제로 그렇게 됐다.
 *
 * 그래서 가질 수 없는 것은 **고르지 못하게** 하고, 왜인지를 그 자리에 쓴다.
 *
 * ── A 와 B 는 따로 파는 회원권이다 ──
 * 30분은 A, 50분은 B. 섞어 쓰지 못한다 -- A 회원권으로 50분 수업을 하면
 * 20,000 짜리 회차가 35,000 짜리 수업에 나가고, 원장은 append-only 라
 * 되돌릴 수 없다. 그래서 "디오사 회원권이 없어요" 가 아니라 **어느 쪽이
 * 없는지**를 말한다.
 */

import { DIOSA_MINUTES, PAY_CATEGORY, isDiosaCategory } from "../../data/schema/constants.js";
import { PAY_CATEGORY_LABELS, labelOf } from "../../data/schema/display-names.js";
import { passBelongsTo } from "../../data/schema/pass-clients.js";
import { isDeductablePass } from "../../data/repositories/pass-repository.js";
import { CARE_GRADE, careCategoryOfGrade, pickCarePass } from "./lesson-settlement.js";

const text = (value) => String(value ?? "").trim();

/** 그 등급의 수업 길이 (분). 등급이 아니면 0 이다. */
export function careMinutesOfGrade(grade) {
  return DIOSA_MINUTES[careCategoryOfGrade(grade)] || 0;
}

/** 이 길이에 맞는 등급. 맞는 것이 없으면 빈 문자열 -- 짐작하지 않는다. */
export function careGradeForMinutes(minutes) {
  const wanted = Number(minutes);
  if (!Number.isFinite(wanted)) return CARE_GRADE.NONE;
  for (const grade of [CARE_GRADE.A, CARE_GRADE.B]) {
    if (careMinutesOfGrade(grade) === wanted) return grade;
  }
  return CARE_GRADE.NONE;
}

/**
 * 회원권 이름. **분까지 적는다.**
 *
 * "디오사 회원권이 없어요" 로는 무엇을 발급해야 하는지 알 수 없다 -- 둘 중
 * 어느 쪽인지가 곧 할 일이다.
 */
export const careCategoryLabel = (category) => labelOf(PAY_CATEGORY_LABELS, category);

/** 그 등급의 회원권 이름. 등급이 아니면 빈 문자열이다. */
export function careGradeLabel(grade) {
  const category = careCategoryOfGrade(grade);
  return category ? careCategoryLabel(category) : "";
}

/** 이 회원의 디오사 회원권 전부 (등급을 가리지 않는다). */
function diosaPassesOf(passes, clientId) {
  const client = text(clientId);
  if (!client) return [];
  return (Array.isArray(passes) ? passes : []).filter((pass) => (
    pass && isDiosaCategory(text(pass.category)) && passBelongsTo(pass, client)
  ));
}

/**
 * 추가 관리 칩의 상태. **없음 · A · B 세 칸을 그대로 돌려준다.**
 *
 * `usable` 이 false 면 고르지 못한다. `note` 가 그 이유이고, 둘은 다르다:
 * 한 장도 없는 것(발급이 필요하다)과 다 쓴 것(재등록이 필요하다)은 대표가
 * 할 일이 다르다.
 *
 * @param {Array<any>} passes 이 센터의 회원권
 * @param {string} clientId
 * @param {{ now?: Date }} [options]
 */
export function careChoices(passes, clientId, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const mine = diosaPassesOf(passes, clientId);
  const choices = [{ key: CARE_GRADE.NONE, label: "없음", usable: true, note: "" }];

  for (const grade of [CARE_GRADE.A, CARE_GRADE.B]) {
    const category = careCategoryOfGrade(grade);
    const owned = mine.filter((pass) => text(pass.category) === category);
    const usable = Boolean(pickCarePass(passes, clientId, category, now));
    choices.push({
      key: grade,
      label: `관리 ${grade === CARE_GRADE.A ? "A" : "B"}(${careMinutesOfGrade(grade)}분)`,
      usable,
      /* 없는 것과 다 쓴 것을 가른다. 같은 문구로 뭉치면 대표에게 보낼 말이
         "발급해 주세요" 인지 "재등록해 주세요" 인지 알 수 없다. */
      note: usable ? "" : owned.length === 0 ? "회원권 없음" : "잔여 없음",
      category,
    });
  }
  return choices;
}

/**
 * 이 회원이 **디오사만** 가졌는가. PT 수업으로 넣으려 할 때 길을 알려준다.
 *
 * 쓸 수 있는 디오사가 있고 쓸 수 있는 PT 가 하나도 없을 때만 참이다. 둘 다
 * 있으면 강사가 고른 대로 가는 것이 맞고, 둘 다 없으면 할 말이 "회원권이
 * 없습니다" 이지 "관리 수업으로 넣을까요" 가 아니다.
 *
 * @param {Array<any>} passes @param {string} clientId @param {{ now?: Date }} [options]
 * @returns {{ careOnly: boolean, grade: string, label: string }}
 */
export function careOnlyClient(passes, clientId, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const client = text(clientId);
  const empty = { careOnly: false, grade: CARE_GRADE.NONE, label: "" };
  if (!client) return empty;

  const mine = (Array.isArray(passes) ? passes : []).filter((pass) => (
    pass && passBelongsTo(pass, client) && isDeductablePass(pass, now)
  ));
  const diosa = mine.filter((pass) => isDiosaCategory(text(pass.category)));
  if (diosa.length === 0 || diosa.length !== mine.length) return empty;

  /* 어느 관리인지까지 말한다. A 만 가진 사람에게 "관리 수업으로 넣을까요" 만
     물으면 50분을 고르고, 그 수업은 확정되지 않는다. */
  const grades = new Set(diosa.map((pass) => (
    text(pass.category) === PAY_CATEGORY.DIOSA_A ? CARE_GRADE.A : CARE_GRADE.B
  )));
  const grade = grades.size === 1 ? [...grades][0] : CARE_GRADE.NONE;
  return {
    careOnly: true,
    grade,
    label: grade ? careGradeLabel(grade) : "디오사",
  };
}

/**
 * 못 빠진 이유 한 줄. **어느 회원권인지까지 말한다.**
 *
 * SETTLEMENT_SKIP_LABEL 은 카테고리를 모른다 (판정 모듈은 등급만 돌려준다).
 * 그 자리에 "디오사 회원권이 없어요" 만 쓰면, 50분 수업을 A 회원권으로 하려던
 * 강사는 **자기에게 디오사가 있는데 왜 안 되는지** 알 수 없다.
 *
 * @param {{ reason?: string, careCategory?: string }} skip
 * @param {Record<string, string>} labels SETTLEMENT_SKIP_LABEL
 */
export function settlementSkipMessage(skip, labels) {
  const reason = text(skip?.reason);
  const category = text(skip?.careCategory);
  const fallback = labels?.[reason] || "차감하지 못했습니다.";
  if (!category) return fallback;
  const name = careCategoryLabel(category);
  if (reason === "care_pass_missing") {
    return `${name} 회원권이 없어요. 다른 회원권에서는 빠지지 않습니다.`;
  }
  if (reason === "care_pass_spent") {
    return `${name} 회원권에 남은 회차가 없습니다 (잔여 0 또는 만료).`;
  }
  return fallback;
}
