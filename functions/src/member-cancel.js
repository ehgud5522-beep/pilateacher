"use strict";

/**
 * 회원 앱 수업 취소 · 취소 횟수 추가 부여 (2026-11-07, 5차 1단계).
 *
 * ── 왜 서버인가 ──
 * 회원은 일정 문서를 쓰지 못한다 (규칙: lessons 쓰기는 센터 직원만). 마감은
 * **서버 시각**으로 재야 하고(기기 시계를 바꾸면 마감이 늘어난다), 횟수 차감과
 * 수업 변경이 한 번에 일어나야 한다. 그래서 이 통로 하나다 -- Admin SDK 는 규칙을
 * 지나지 않는다.
 *
 * ── 한 번만 ──
 * 읽기 · 판정 · 쓰기가 한 트랜잭션이다. 두 번 누르면 두 번째 트랜잭션은 첫 번째가
 * 남긴 수업 문서(이 회원 취소 표시)를 읽고 "이미 취소함" 을 **성공으로** 돌려준다 --
 * 횟수는 한 번만 준다.
 *
 * ── 남기는 것 ──
 * - lessons/{id}: 취소 모양(강사 기기의 취소와 같다) + memberCancellations.{clientId}
 *   + 번호 +1. 강사 기기는 번호가 다를 때 서버를 따른다
 * - memberCancelLedger/{clientId}: 칸(월 · 회원권)마다 used · granted
 * - memberCancellations/{자동}: 누가(uid) · 언제 · 어느 수업 · 남은 횟수
 * - memberCancelGrants/{자동}: 추가 부여 -- 누가(uid · 역할) · 몇 회 · 사유 · 달
 *
 * 이름 · 연락처는 어디에도 적지 않는다 (CLAUDE.md §7). 사유는 강사가 쓴 문장이라
 * 문서에는 남기되 로그에는 남기지 않는다.
 */

let policyModule = null;
async function loadPolicy() {
  if (!policyModule) policyModule = await import("../shared/member-cancel.mjs");
  return policyModule;
}

const text = (value) => String(value ?? "").trim();

/** 막힌 이유 → Firebase 코드. 화면은 reason 으로 문구를 고른다. */
const HTTPS_CODE_BY_REASON = Object.freeze({
  feature_off: "failed-precondition",
  lesson_not_found: "not-found",
  not_own_lesson: "permission-denied",
  lesson_settled: "failed-precondition",
  lesson_cancelled: "failed-precondition",
  deadline_passed: "failed-precondition",
  no_remaining: "failed-precondition",
  no_active_pass: "failed-precondition",
  grant_not_assigned: "permission-denied",
  grant_amount_invalid: "invalid-argument",
  grant_reason_required: "invalid-argument",
  grant_reason_too_long: "invalid-argument",
  client_not_found: "not-found",
  not_staff: "permission-denied",
});

const refusal = (reason, message = reason) => Object.assign(new Error(message), {
  httpsCode: HTTPS_CODE_BY_REASON[reason] || "failed-precondition", reason,
});
const requestError = (httpsCode, message, reason = "") => Object.assign(new Error(message), { httpsCode, reason });

const iso = (value) => (value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : null);

async function readPassesFor(org, clientId) {
  const [byAnchor, byList] = await Promise.all([
    org.collection("passes").where("clientId", "==", clientId).get(),
    org.collection("passes").where("clientIds", "array-contains", clientId).get(),
  ]);
  const byId = new Map();
  for (const snapshot of [...byAnchor.docs, ...byList.docs]) byId.set(snapshot.id, { id: snapshot.id, ...snapshot.data() });
  return [...byId.values()];
}

/** 회원 본인 확인 + 공통 읽기. 회원 문서의 userId 가 부른 사람이어야 한다. */
async function readMemberContext(firestore, input) {
  const callerUid = text(input?.callerUid);
  const organizationId = text(input?.organizationId);
  const clientId = text(input?.clientId);
  const lessonId = text(input?.lessonId);
  if (!callerUid) throw requestError("unauthenticated", "Please sign in again.", "unauthenticated");
  if (!organizationId || !clientId || !lessonId) {
    throw requestError("invalid-argument", "organizationId, clientId and lessonId are required.", "missing_fields");
  }
  const org = firestore.collection("organizations").doc(organizationId);
  const [clientSnapshot, syncSnapshot] = await Promise.all([
    org.collection("clients").doc(clientId).get(),
    firestore.collection("runtimeConfig").doc("scheduleSync").get(),
  ]);
  const client = clientSnapshot.exists ? clientSnapshot.data() || {} : null;
  /* 남의 회원 문서를 대신 고르는 것을 막는 곳. 없는 문서와 남의 문서를 같은
     답으로 돌려준다 -- 다르면 "이 id 가 이 센터에 있는가" 를 캐는 통로가 된다. */
  if (!client || text(client.userId) !== callerUid || text(client.organizationId || organizationId) !== organizationId) {
    throw refusal("not_own_lesson");
  }
  return {
    callerUid, organizationId, clientId, lessonId, org,
    scheduleSyncDoc: syncSnapshot.exists ? syncSnapshot.data() || {} : {},
  };
}

/** 회원권 기준이면 셀 회원권을 고른다. 월 기준이면 읽지 않는다. */
async function passIdFor(policy, context, now) {
  const config = policy.readMemberCancelConfig(context.scheduleSyncDoc?.memberCancel);
  if (config.period !== policy.MEMBER_CANCEL_PERIOD.PASS) return "";
  return policy.activePassIdFor(await readPassesFor(context.org, context.clientId), context.clientId, now);
}

/** 화면에 그릴 담당 강사 이름 (소속 문서). 없으면 빈 문자열 -- 화면이 "담당 선생님" 으로 말한다. */
async function instructorNameOf(firestore, organizationId, instructorId, membershipId) {
  if (!text(instructorId)) return "";
  const snapshot = await firestore.collection("memberships").doc(membershipId(organizationId, instructorId)).get();
  return snapshot.exists ? text(snapshot.data()?.displayName) : "";
}

/**
 * 수업 상세가 열릴 때: 버튼을 그릴지 · 마감 · 남은 횟수. 쓰지 않는다.
 * 기능이 꺼져 있으면 enabled:false 만 돌려준다 -- 화면은 아무것도 그리지 않는다.
 */
async function memberCancelStatus(firestore, input, deps) {
  const policy = await loadPolicy();
  const now = (deps.now || (() => new Date()))();
  const context = await readMemberContext(firestore, input);
  const lessonSnapshot = await context.org.collection("lessons").doc(context.lessonId).get();
  const lesson = lessonSnapshot.exists ? lessonSnapshot.data() || {} : null;
  const ledgerSnapshot = await context.org.collection("memberCancelLedger").doc(context.clientId).get();
  const decided = policy.decideMemberCancel({
    now, lesson, clientId: context.clientId, scheduleSyncDoc: context.scheduleSyncDoc,
    ledger: ledgerSnapshot.exists ? ledgerSnapshot.data() : null,
    passId: await passIdFor(policy, context, now),
  });
  if (decided.reason === policy.CANCEL_REASON.FEATURE_OFF || decided.reason === policy.CANCEL_REASON.NOT_FOUND) {
    return { enabled: false, reason: decided.reason };
  }
  if (decided.reason === policy.CANCEL_REASON.NOT_OWN) throw refusal("not_own_lesson");
  return {
    enabled: true,
    canCancel: decided.ok,
    reason: decided.reason,
    deadline: iso(decided.deadline),
    remaining: decided.remaining,
    limit: decided.limit,
    period: decided.period,
    instructorName: await instructorNameOf(firestore, context.organizationId, text(lesson?.instructorId), deps.membershipId),
    serverTime: now.toISOString(),
  };
}

/**
 * 취소. 성공하면 { outcome: "cancelled" | "already_cancelled", remaining }.
 * 막히면 reason 을 단 오류 -- 아무것도 쓰지 않는다 (횟수도 그대로).
 */
async function memberCancelLesson(firestore, input, deps) {
  const policy = await loadPolicy();
  const nowFn = deps.now || (() => new Date());
  const context = await readMemberContext(firestore, input);
  const passId = await passIdFor(policy, context, nowFn());
  const lessonRef = context.org.collection("lessons").doc(context.lessonId);
  const ledgerRef = context.org.collection("memberCancelLedger").doc(context.clientId);
  const recordRef = context.org.collection("memberCancellations").doc(deps.newId());

  const result = await firestore.runTransaction(async (transaction) => {
    /* 마감은 트랜잭션 안의 시각으로 다시 잰다. 트랜잭션이 다시 돌면 그 시각이 새로 정해진다. */
    const now = nowFn();
    const lessonSnapshot = await transaction.get(lessonRef);
    const ledgerSnapshot = await transaction.get(ledgerRef);
    const lesson = lessonSnapshot.exists ? lessonSnapshot.data() || {} : null;
    const ledger = ledgerSnapshot.exists ? ledgerSnapshot.data() || {} : null;
    const decided = policy.decideMemberCancel({
      now, lesson, clientId: context.clientId, scheduleSyncDoc: context.scheduleSyncDoc, ledger, passId,
    });
    if (decided.reason === policy.CANCEL_REASON.ALREADY) {
      const mark = lesson?.memberCancellations?.[context.clientId] || {};
      const bucket = text(mark.bucket) || decided.bucket;
      return {
        outcome: "already_cancelled",
        remaining: bucket ? policy.remainingIn(ledger, bucket, decided.limit) : null,
        recordId: text(mark.recordId),
      };
    }
    if (!decided.ok) throw refusal(decided.reason);

    const usedAfter = policy.bucketOf(ledger, decided.bucket).used + 1;
    const grantedAfter = policy.bucketOf(ledger, decided.bucket).granted;
    const remainingAfter = Math.max(0, decided.remaining - 1);
    const mark = { cancelledAt: now, by: "member", recordId: recordRef.id, bucket: decided.bucket };
    const patch = policy.lessonPatchForCancel(lesson, context.clientId, mark);
    transaction.set(lessonRef, {
      ...patch,
      updatedAt: now,
      updatedBy: context.callerUid,
      /* 강사 기기는 이 값이 자기 기기 id 가 아니면 "다른 곳의 취소" 로 본다
         (lesson-schedule-repository.js) -- 옛 탭이 되살리지 못한다. */
      updatedDevice: "member_cancel",
    }, { merge: true });
    transaction.set(ledgerRef, {
      organizationId: context.organizationId,
      clientId: context.clientId,
      buckets: {
        ...(ledger?.buckets && typeof ledger.buckets === "object" ? ledger.buckets : {}),
        [decided.bucket]: { used: usedAfter, granted: grantedAfter },
      },
      updatedAt: now,
    });
    transaction.set(recordRef, {
      organizationId: context.organizationId,
      clientId: context.clientId,
      lessonId: context.lessonId,
      instructorId: text(lesson.instructorId),
      lessonStartsAt: policy.toDate(lesson.startsAt),
      cancelledAt: now,
      cancelledByUid: context.callerUid,
      /* 듀엣이면 상대 예약은 그대로다 -- 그 사실을 기록에 남긴다. */
      partnerKept: patch.status === "scheduled",
      period: decided.period,
      bucket: decided.bucket,
      limit: decided.limit,
      usedAfter,
      grantedAfter,
      remainingAfter,
    });
    return { outcome: "cancelled", remaining: remainingAfter, recordId: recordRef.id, partnerKept: patch.status === "scheduled" };
  });
  return { ...result, lessonId: context.lessonId };
}

/**
 * 취소 횟수 추가 부여 (강사 앱 회원 상세). 대표 · 총괄매니저, 그 밖에는 담당 강사만.
 * 월 기준이면 이번 달(한국 시각) 칸에, 회원권 기준이면 지금 쓰는 회원권 칸에 더한다.
 */
async function grantMemberCancel(firestore, input, deps) {
  const policy = await loadPolicy();
  const now = (deps.now || (() => new Date()))();
  const callerUid = text(input?.callerUid);
  const organizationId = text(input?.organizationId);
  const clientId = text(input?.clientId);
  if (!callerUid) throw requestError("unauthenticated", "Please sign in again.", "unauthenticated");
  if (!organizationId || !clientId) throw requestError("invalid-argument", "organizationId and clientId are required.", "missing_fields");

  const membershipSnapshot = await firestore.collection("memberships").doc(deps.membershipId(organizationId, callerUid)).get();
  const membership = membershipSnapshot.exists ? membershipSnapshot.data() || {} : null;
  const role = text(membership?.role);
  if (!membership || text(membership.status) !== "active"
    || !["owner", "area_manager", "manager", "instructor", "staff"].includes(role)) {
    throw refusal("not_staff");
  }
  const org = firestore.collection("organizations").doc(organizationId);
  const [clientSnapshot, syncSnapshot] = await Promise.all([
    org.collection("clients").doc(clientId).get(),
    firestore.collection("runtimeConfig").doc("scheduleSync").get(),
  ]);
  if (!clientSnapshot.exists) throw refusal("client_not_found");
  if (!policy.mayGrantMemberCancel(role, callerUid, clientSnapshot.data())) throw refusal("grant_not_assigned");
  const checked = policy.validateGrant(input);
  if (!checked.ok) throw refusal(checked.reason);

  const config = policy.readMemberCancelConfig(syncSnapshot.exists ? syncSnapshot.data()?.memberCancel : null);
  if (!config.configured || config.mode === policy.MEMBER_CANCEL_MODE.OFF) throw refusal("feature_off");
  const passId = config.period === policy.MEMBER_CANCEL_PERIOD.PASS
    ? policy.activePassIdFor(await readPassesFor(org, clientId), clientId, now) : "";
  const bucket = policy.bucketKey({ period: config.period, at: now, passId });
  if (!bucket) throw refusal("no_active_pass");

  const ledgerRef = org.collection("memberCancelLedger").doc(clientId);
  const grantRef = org.collection("memberCancelGrants").doc(deps.newId());
  return firestore.runTransaction(async (transaction) => {
    const ledgerSnapshot = await transaction.get(ledgerRef);
    const ledger = ledgerSnapshot.exists ? ledgerSnapshot.data() || {} : null;
    const current = policy.bucketOf(ledger, bucket);
    const grantedAfter = current.granted + checked.amount;
    transaction.set(ledgerRef, {
      organizationId,
      clientId,
      buckets: {
        ...(ledger?.buckets && typeof ledger.buckets === "object" ? ledger.buckets : {}),
        [bucket]: { used: current.used, granted: grantedAfter },
      },
      updatedAt: now,
    });
    transaction.set(grantRef, {
      organizationId,
      clientId,
      amount: checked.amount,
      reason: checked.reason,
      grantedBy: callerUid,
      grantedByRole: role,
      period: config.period,
      bucket,
      /* 대표 화면의 월별 집계가 이 칸 하나로 거른다 (단일 필드 색인). */
      month: policy.monthKey(now),
      createdAt: now,
    });
    const remaining = Math.max(0, config.limit + grantedAfter - current.used);
    return { grantId: grantRef.id, bucket, remaining };
  });
}

module.exports = {
  HTTPS_CODE_BY_REASON,
  memberCancelStatus,
  memberCancelLesson,
  grantMemberCancel,
};
