"use strict";

/**
 * 강사 이름 확정 — **대표 전용, 한 번 쓰는 통로다.**
 *
 * 왜 필요한지는 functions/shared/instructor-names.mjs 머리말에 있다.
 *
 * ── 왜 서버인가 ──
 * 규칙의 소속 문서 문은 **한 사람씩** 열려 있다. 대표가 앱에서 열 명을 찍으려면
 * 열 번의 쓰기를 보내야 하고, 중간에 하나가 실패하면 어디까지 됐는지 화면이
 * 말하지 못한다. 한 배치로 묶으면 전부 되거나 전부 안 된다.
 *
 * ── 두 번 눌러도 같다 ──
 * 표시가 이미 있는 소속은 건너뛴다 (planNameConfirmation). 이 작업은 값을
 * 더하지 않고 같은 글자를 적으므로 두 번 돌아도 결과가 같지만, 건너뛴 수를
 * 돌려주어야 대표가 "이미 끝났다" 를 안다.
 */

const text = (value) => String(value ?? "").trim();

/* functions/ 는 CommonJS 이고 shared/ 는 ESM 이다. 쓰는 순간에 읽는다 --
   pass-admin.js 머리말과 같은 이유다. */
let sharedModule = null;
async function shared() {
  if (!sharedModule) sharedModule = await import("../shared/instructor-names.mjs");
  return sharedModule;
}

/** Firestore 가 한 번에 받는 쓰기 수. 넘으면 나눠 보낸다. */
const BATCH_LIMIT = 400;

const membershipKey = (organizationId, userId) => `${organizationId}_${userId}`;

/**
 * 이 센터의 소속 전부. 퇴사자까지 읽는다 -- 거르는 것은 판정의 몫이고,
 * 건너뛴 이유를 돌려주려면 그 문서가 있어야 한다.
 */
async function readMemberships(firestore, organizationId) {
  const snapshot = await firestore
    .collection("memberships")
    .where("organizationId", "==", organizationId)
    .get();
  return snapshot.docs.map((item) => ({ ...item.data(), userId: text(item.data()?.userId) }));
}

/**
 * 무엇이 찍히는가. **읽기만 한다.**
 *
 * 이름을 그대로 돌려준다. 대표가 **지금 적혀 있는 글자**를 보고 확정할지
 * 정하는 화면이라, 가리면 그 판단을 할 수 없다 -- 강사 이름이고 회원 이름이
 * 아니다 (회원 이름은 어디에도 싣지 않는다, §7).
 */
async function planInstructorNames(firestore, input) {
  const { planNameConfirmation } = await shared();
  const organizationId = text(input?.organizationId);
  const memberships = await readMemberships(firestore, organizationId);
  const plan = planNameConfirmation(memberships);
  return {
    organizationId,
    counts: {
      targets: plan.targets.length,
      skipped: plan.skipped.length,
      already: plan.skipped.filter((item) => item.reason === "already").length,
      noName: plan.skipped.filter((item) => item.reason === "no_name").length,
    },
    ...plan,
  };
}

/**
 * 찍는다. **이름은 바꾸지 않는다 -- 표시 하나만 얹는다.**
 *
 * @param {any} firestore
 * @param {{ organizationId: string }} input
 */
async function confirmInstructorNames(firestore, input) {
  const { nameConfirmationPatch } = await shared();
  const plan = await planInstructorNames(firestore, input);
  if (plan.targets.length === 0) return { ...plan, applied: 0 };

  const patch = nameConfirmationPatch();
  for (let index = 0; index < plan.targets.length; index += BATCH_LIMIT) {
    const batch = firestore.batch();
    for (const target of plan.targets.slice(index, index + BATCH_LIMIT)) {
      batch.update(
        firestore.collection("memberships").doc(membershipKey(plan.organizationId, target.userId)),
        patch,
      );
    }
    await batch.commit();
  }
  return { ...plan, applied: plan.targets.length };
}

module.exports = {
  BATCH_LIMIT,
  confirmInstructorNames,
  planInstructorNames,
};
