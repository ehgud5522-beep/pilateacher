"use strict";

/**
 * 강사 계정 교체 — **대표 전용 통로다.**
 *
 * ── 왜 서버인가 ──
 * 옮길 것이 다섯 갈래다: 소속 설정, 회원권의 담당, 회원의 담당 목록, 누적
 * 진행, 아직 오지 않은 일정. 규칙은 그 하나하나에 서로 다른 문을 두었고,
 * 어느 문도 "이 강사의 것을 전부" 를 허락하지 않는다 -- 그래야 하는 문이
 * 아니기 때문이다.
 *
 * Admin SDK 는 규칙을 우회한다. 그래서 규칙은 그대로 두고 예외를 여기 하나
 * 둔다 -- pass-admin.js 와 같은 판단이다.
 *
 * ── 원장은 옮기지 않는다 ──
 * append-only 다. 세는 쪽이 previousUids 로 둘을 한 사람으로 본다
 * (functions/shared/instructor-swap.mjs 머리말).
 *
 * ── 두 번 눌러도 같다 ──
 * 대표가 한 번 더 누르는 일은 반드시 생긴다. 누적은 **더하는** 값이라 두 번
 * 돌면 두 배가 되고 그것은 되돌릴 수 없다. 그래서 끝난 교체는 아무것도 하지
 * 않고 같은 결과를 돌려준다.
 */

const text = (value) => String(value ?? "").trim();
const count = (value) => (Number.isInteger(Number(value)) && Number(value) >= 0 ? Number(value) : 0);

/* functions/ 는 CommonJS 이고 shared/ 는 ESM 이다. 쓰는 순간에 읽는다 --
   pass-admin.js 머리말과 같은 이유다. */
let sharedModule = null;
async function shared() {
  if (!sharedModule) sharedModule = await import("../shared/instructor-swap.mjs");
  return sharedModule;
}

/**
 * 서버 센티넬. **모듈을 읽을 때 부르지 않는다.**
 *
 * firebase-admin 은 functions/node_modules 에만 있고 CI 는 루트에서만
 * npm install 한다 -- 모듈 최상위에서 부르면 루트 테스트가 로드 단계에서
 * 죽는다 (pass-admin.js 머리말, tests/meta/root-test-dependencies.test.js).
 */
const sentinels = (input) => input?.fieldValue
  || require("firebase-admin/firestore").FieldValue;

const membershipKey = (organizationId, userId) => `${organizationId}_${userId}`;

/** Firestore 가 한 번에 받는 쓰기 수. 넘으면 나눠 보낸다. */
const BATCH_LIMIT = 400;

/**
 * 무엇이 옮겨지는가. **읽기만 한다.**
 *
 * 대표가 누르기 전에 보는 숫자이고, 실행이 쓰는 목록과 같은 조회에서 나온다
 * -- 둘이 갈라지면 본 숫자와 옮겨진 것이 다르고, 누적은 되돌릴 수 없다.
 *
 * **이름을 세지 않는다.** 건수만 돌려준다 (§7).
 */
async function planAccountSwap(firestore, input) {
  const { swapError, alreadySwapped, previousUidsOf } = await shared();
  const organizationId = text(input?.organizationId);
  const fromUid = text(input?.fromUid);
  const toUid = text(input?.toUid);
  const at = (input?.now || (() => new Date()))();

  const org = firestore.collection("organizations").doc(organizationId);
  const [fromDoc, toDoc] = await Promise.all([
    firestore.collection("memberships").doc(membershipKey(organizationId, fromUid)).get(),
    firestore.collection("memberships").doc(membershipKey(organizationId, toUid)).get(),
  ]);
  const from = fromDoc.exists ? { ...fromDoc.data(), userId: fromUid } : null;
  const to = toDoc.exists ? { ...toDoc.data(), userId: toUid } : null;

  /* 누가 누르는가에 따라 막히는 것이 다르다. 총괄매니저는 자기와 같은 자리를
     건드리지 못한다 (shared/instructor-swap.mjs 의 ACTOR_BELOW_TARGET). */
  const refused = swapError({ from, to, actorRole: text(input?.actorRole) || "owner" });
  if (refused) throw new Error(refused);

  const [passes, clients, totals, lessons] = await Promise.all([
    org.collection("passes").where("instructorId", "==", fromUid).get(),
    org.collection("clients").where("instructorIds", "array-contains", fromUid).get(),
    org.collection("instructorClientTotals").where("instructorId", "==", fromUid).get(),
    /* 아직 오지 않은 일정만. 지난 수업의 담당을 바꾸면 "그날 누가 가르쳤나"
       가 흔들린다 -- 원장을 옮기지 않는 것과 같은 이유다. */
    org.collection("lessons").where("instructorId", "==", fromUid).get(),
  ]);

  const todayKey = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
  const futureLessons = lessons.docs.filter((item) => text(item.data()?.date) >= todayKey);

  return {
    organizationId,
    fromUid,
    toUid,
    done: alreadySwapped({ from, to }),
    previousUids: previousUidsOf(to),
    counts: {
      passes: passes.size,
      clients: clients.size,
      totals: totals.size,
      /* 누적 진행의 합. 급여 판정 3(누적 20회 미만)이 보는 숫자라, 몇 건이
         아니라 몇 회가 옮겨지는지가 대표가 확인할 값이다. */
      totalSessions: totals.docs.reduce((sum, item) => sum + count(item.data()?.sessions), 0),
      futureLessons: futureLessons.length,
    },
    documents: {
      passIds: passes.docs.map((item) => item.id),
      clientIds: clients.docs.map((item) => item.id),
      totalIds: totals.docs.map((item) => item.id),
      lessonIds: futureLessons.map((item) => item.id),
    },
    from: { status: text(from.status), role: text(from.role), title: text(from.title) },
    to: { status: text(to.status), role: text(to.role), title: text(to.title) },
  };
}

/**
 * 이 달에 옛 uid 로 박힌 수업료. 미리보기가 "얼마가 합쳐지는가" 를 말한다.
 *
 * 원장을 옮기지는 않는다 -- 이 숫자는 **세는 쪽이 합쳐 보여 줄 금액**이다.
 */
async function monthlyPayFor(firestore, { organizationId, instructorId, month, now }) {
  const at = (now || (() => new Date()))();
  const key = text(month) || `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}`;
  const [year, index] = key.split("-").map(Number);
  const start = new Date(year, index - 1, 1);
  const end = new Date(year, index, 1);

  const snapshot = await firestore.collection("organizations").doc(organizationId)
    .collection("ledger")
    .where("instructorId", "==", instructorId)
    .where("occurredAt", ">=", start)
    .where("occurredAt", "<", end)
    .get()
    .catch(() => null);
  /* 색인이 없거나 질의가 막히면 미리보기만 비운다 -- 금액을 못 읽었다고
     교체를 막을 이유가 없다. 옮기는 것은 원장이 아니다. */
  if (!snapshot) return { month: key, sessions: null, total: null };

  let sessions = 0;
  let total = 0;
  for (const item of snapshot.docs) {
    const data = item.data() || {};
    if (data.type !== "deduct" && data.type !== "correction") continue;
    const delta = Math.abs(Number(data.delta) || 0);
    sessions += data.type === "deduct" ? delta : -delta;
    total += (data.type === "deduct" ? 1 : -1) * delta * (Number(data.unitPrice) || 0);
  }
  return { month: key, sessions, total };
}

/**
 * 옮긴다. **두 번 눌러도 같은 결과다.**
 *
 * @param {any} firestore
 * @param {{ organizationId: string, fromUid: string, toUid: string, actorId: string, now?: () => Date }} input
 */
async function runAccountSwap(firestore, input) {
  const { MEMBERSHIP_SWAPPED, swappedMembershipPatch, mergeTotals } = await shared();
  const plan = await planAccountSwap(firestore, input);
  // 이미 끝난 교체다. 아무것도 더 하지 않는다 -- 누적이 두 배가 된다.
  if (plan.done) return { ...plan, applied: false };

  const at = (input?.now || (() => new Date()))();
  const organizationId = plan.organizationId;
  const org = firestore.collection("organizations").doc(organizationId);
  const fromRef = firestore.collection("memberships").doc(membershipKey(organizationId, plan.fromUid));
  const toRef = firestore.collection("memberships").doc(membershipKey(organizationId, plan.toUid));

  const [fromDoc, toDoc] = await Promise.all([fromRef.get(), toRef.get()]);
  const from = { ...fromDoc.data(), userId: plan.fromUid };
  const to = { ...toDoc.data(), userId: plan.toUid };

  /* 누적은 더한다. 두 계정이 같은 회원을 맡은 적이 있으면 문서가 둘이고,
     덮어쓰면 한쪽의 횟수가 사라진다 -- 그 숫자는 급여 판정 3 을 움직인다. */
  const totalDocs = await Promise.all(plan.documents.totalIds.map(async (id) => {
    const snapshot = await org.collection("instructorClientTotals").doc(id).get();
    const data = snapshot.data() || {};
    const clientId = text(data.clientId);
    const target = clientId
      ? await org.collection("instructorClientTotals").doc(`${plan.toUid}_${clientId}`).get()
      : null;
    return { id, data, clientId, targetData: target?.exists ? target.data() : null };
  }));

  const writes = [];
  writes.push({ ref: toRef, op: "update", data: swappedMembershipPatch(from, to) });
  /* 옛 소속은 퇴사가 아니라 "계정 교체됨" 이다. 퇴사로 두면 강사 목록에서
     나간 사람으로 읽히고, 대표는 매번 다시 묻게 된다. 로그인은 막힌다 --
     status 가 active 가 아니면 소속 조회가 그 문서를 고르지 않는다. */
  writes.push({
    ref: fromRef,
    op: "update",
    data: { status: MEMBERSHIP_SWAPPED, swappedToUid: plan.toUid, swappedAt: at, swappedBy: text(input?.actorId) },
  });

  for (const id of plan.documents.passIds) {
    writes.push({ ref: org.collection("passes").doc(id), op: "update", data: { instructorId: plan.toUid } });
  }
  /* 담당 목록은 더하고 빼는 것이지 통째로 쓰는 것이 아니다. 읽은 값으로
     덮으면 그 사이에 다른 강사가 붙은 것이 사라진다 -- 한 회원에 둘 이상이
     붙을 수 있고(instructorIds 는 배열이다) 그 둘은 서로를 모른다. */
  const FieldValue = sentinels(input);
  for (const id of plan.documents.clientIds) {
    writes.push({
      ref: org.collection("clients").doc(id),
      op: "update",
      data: {
        instructorIds: FieldValue.arrayUnion(plan.toUid),
      },
    });
    writes.push({
      ref: org.collection("clients").doc(id),
      op: "update",
      data: {
        instructorIds: FieldValue.arrayRemove(plan.fromUid),
      },
    });
  }
  for (const id of plan.documents.lessonIds) {
    writes.push({ ref: org.collection("lessons").doc(id), op: "update", data: { instructorId: plan.toUid } });
  }
  for (const row of totalDocs) {
    if (!row.clientId) continue;
    writes.push({
      ref: org.collection("instructorClientTotals").doc(`${plan.toUid}_${row.clientId}`),
      op: "set",
      data: {
        ...row.data,
        organizationId,
        instructorId: plan.toUid,
        clientId: row.clientId,
        sessions: mergeTotals(row.data, row.targetData),
      },
    });
    // 옛 문서는 0 으로 내린다. 지우지 않는다 -- 지우면 되돌릴 근거가 사라진다.
    writes.push({
      ref: org.collection("instructorClientTotals").doc(row.id),
      op: "update",
      data: { sessions: 0, swappedToUid: plan.toUid },
    });
  }

  for (let index = 0; index < writes.length; index += BATCH_LIMIT) {
    const batch = firestore.batch();
    for (const write of writes.slice(index, index + BATCH_LIMIT)) {
      if (write.op === "set") batch.set(write.ref, write.data, { merge: true });
      else batch.update(write.ref, write.data);
    }
    await batch.commit();
  }

  return { ...plan, applied: true, writes: writes.length };
}

module.exports = {
  BATCH_LIMIT,
  monthlyPayFor,
  planAccountSwap,
  runAccountSwap,
};
