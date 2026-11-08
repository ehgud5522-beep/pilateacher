"use strict";

/**
 * 수업 후 별점 평가 (2026-11-09 대표 요청).
 *
 * ── 왜 서버인가 ──
 * 평가는 **강사에게 보이지 않아야** 한다. 앱이 Firestore 에 직접 쓰면 규칙이 그 문서를
 * 누군가에게는 열어야 하고, 강사 앱은 센터 문서를 폭넓게 읽는다. 그래서 규칙은
 * lessonRatings · lessonRatingStats 를 **아무에게도 열지 않고**, 쓰기와 읽기 모두 이 통로뿐이다
 * (Admin SDK 는 규칙을 지나지 않는다).
 *
 * ── 남기는 것 ──
 * - lessonRatings/{lessonId}_{clientId}: 점수 · 수업 · 담당 강사 · 시각. 이름 · 연락처 없음
 * - lessonRatingStats/{instructorId}: 강사별 누적 -- 응답 수와 항목마다 합계 · 건수
 *
 * 둘은 한 트랜잭션이다. 두 번 누르면 두 번째는 평가 문서를 읽고 "이미 보냄" 을 **성공으로**
 * 돌려준다 -- 집계는 한 번만 오른다.
 *
 * ── 대표 화면 ──
 * lessonRatingStats 만 읽어 강사별 건수 · 평균을 돌려준다. 개별 응답은 읽지도 않는다.
 */

let policyModule = null;
async function loadPolicy() {
  if (!policyModule) policyModule = await import("../shared/lesson-rating.mjs");
  return policyModule;
}

const text = (value) => String(value ?? "").trim();

/** 막힌 이유 → Firebase 코드. 화면은 reason 으로 문구를 고른다. */
const HTTPS_CODE_BY_REASON = Object.freeze({
  feature_off: "failed-precondition",
  lesson_not_found: "not-found",
  not_own_lesson: "permission-denied",
  lesson_cancelled: "failed-precondition",
  lesson_not_attended: "failed-precondition",
  lesson_not_started: "failed-precondition",
  rating_expired: "failed-precondition",
  scores_invalid: "invalid-argument",
  not_owner: "permission-denied",
});

const refusal = (reason, message = reason, extra = {}) => Object.assign(new Error(message), {
  httpsCode: HTTPS_CODE_BY_REASON[reason] || "failed-precondition", reason, ...extra,
});
const requestError = (httpsCode, message, reason = "") => Object.assign(new Error(message), { httpsCode, reason });

/** 회원 본인 확인 + 공통 읽기 (member-cancel.js 의 readMemberContext 와 같은 판단). */
async function readMemberContext(firestore, input) {
  const callerUid = text(input?.callerUid);
  const organizationId = text(input?.organizationId);
  const clientId = text(input?.clientId);
  const lessonId = text(input?.lessonId);
  if (!callerUid) throw requestError("unauthenticated", "Please sign in again.", "unauthenticated");
  if (!organizationId || !clientId || !lessonId || [organizationId, clientId, lessonId].some((id) => id.includes("/"))) {
    throw requestError("invalid-argument", "organizationId, clientId and lessonId are required.", "missing_fields");
  }
  const org = firestore.collection("organizations").doc(organizationId);
  const [clientSnapshot, syncSnapshot] = await Promise.all([
    org.collection("clients").doc(clientId).get(),
    firestore.collection("runtimeConfig").doc("scheduleSync").get(),
  ]);
  const client = clientSnapshot.exists ? clientSnapshot.data() || {} : null;
  /* 없는 문서와 남의 문서를 같은 답으로 -- 다르면 id 를 캐는 통로가 된다. */
  if (!client || text(client.userId) !== callerUid || text(client.organizationId || organizationId) !== organizationId) {
    throw refusal("not_own_lesson");
  }
  return {
    callerUid, organizationId, clientId, lessonId, org,
    scheduleSyncDoc: syncSnapshot.exists ? syncSnapshot.data() || {} : {},
  };
}

/**
 * 평가 카드를 그릴지. 쓰지 않는다. 꺼져 있거나 받을 수 없는 수업이면 enabled:false 와 이유만 --
 * 화면은 아무것도 그리지 않는다. 이미 보냈으면 enabled:true, rated:true.
 */
async function lessonRatingStatus(firestore, input, deps = {}) {
  const policy = await loadPolicy();
  const now = (deps.now || (() => new Date()))();
  const context = await readMemberContext(firestore, input);
  const ratingId = policy.ratingDocId(context.lessonId, context.clientId);
  const [lessonSnapshot, ratingSnapshot] = await Promise.all([
    context.org.collection("lessons").doc(context.lessonId).get(),
    context.org.collection("lessonRatings").doc(ratingId).get(),
  ]);
  const decided = policy.decideLessonRating({
    now, clientId: context.clientId, scheduleSyncDoc: context.scheduleSyncDoc,
    lesson: lessonSnapshot.exists ? lessonSnapshot.data() || {} : null,
    existing: ratingSnapshot.exists,
  });
  if (decided.reason === policy.RATING_REASON.ALREADY) return { enabled: true, rated: true, reason: decided.reason };
  if (decided.reason === policy.RATING_REASON.NOT_OWN) throw refusal("not_own_lesson");
  return { enabled: decided.ok, rated: false, reason: decided.reason, windowDays: policy.RATING_WINDOW_DAYS };
}

/**
 * 평가 저장. 성공하면 { outcome: "rated" | "already_rated" }. 막히면 reason 을 단 오류 --
 * 아무것도 쓰지 않는다.
 */
async function submitLessonRating(firestore, input, deps = {}) {
  const policy = await loadPolicy();
  const nowFn = deps.now || (() => new Date());
  const context = await readMemberContext(firestore, input);
  const checked = policy.validateScores(input?.scores);
  if (!checked.ok) throw refusal(checked.reason, checked.reason, { field: checked.field });
  const ratingRef = context.org.collection("lessonRatings").doc(policy.ratingDocId(context.lessonId, context.clientId));
  const lessonRef = context.org.collection("lessons").doc(context.lessonId);

  const result = await firestore.runTransaction(async (transaction) => {
    const now = nowFn();
    const ratingSnapshot = await transaction.get(ratingRef);
    const lessonSnapshot = await transaction.get(lessonRef);
    const lesson = lessonSnapshot.exists ? lessonSnapshot.data() || {} : null;
    const decided = policy.decideLessonRating({
      now, lesson, clientId: context.clientId, scheduleSyncDoc: context.scheduleSyncDoc, existing: ratingSnapshot.exists,
    });
    if (decided.reason === policy.RATING_REASON.ALREADY) return { outcome: "already_rated", ratingId: ratingRef.id };
    if (!decided.ok) throw refusal(decided.reason);

    /* 담당 강사는 수업 문서에서 읽는다 -- 회원이 보낸 값을 믿지 않는다. */
    const statsRef = context.org.collection("lessonRatingStats").doc(decided.instructorId);
    const statsSnapshot = await transaction.get(statsRef);
    const added = policy.addToStats(statsSnapshot.exists ? statsSnapshot.data() : null, checked.scores);
    transaction.set(ratingRef, {
      organizationId: context.organizationId,
      clientId: context.clientId,
      lessonId: context.lessonId,
      instructorId: decided.instructorId,
      lessonStartsAt: decided.startsAt,
      scores: checked.scores,
      itemIds: Object.keys(checked.scores),
      createdAt: now,
      createdByUid: context.callerUid,
    });
    transaction.set(statsRef, {
      organizationId: context.organizationId,
      instructorId: decided.instructorId,
      count: added.count,
      items: added.items,
      updatedAt: now,
    });
    return { outcome: "rated", ratingId: ratingRef.id };
  });
  return { ...result, lessonId: context.lessonId };
}

/**
 * 대표 화면: 강사별 누적 응답 수 · 항목별 평균. **대표만** (요청: "대표(owner) 화면").
 * 개별 응답 문서는 읽지 않는다 -- 집계 문서만.
 */
async function lessonRatingStats(firestore, input, deps) {
  const policy = await loadPolicy();
  const callerUid = text(input?.callerUid);
  const organizationId = text(input?.organizationId);
  if (!callerUid) throw requestError("unauthenticated", "Please sign in again.", "unauthenticated");
  if (!organizationId || organizationId.includes("/")) throw requestError("invalid-argument", "organizationId is required.", "missing_fields");
  const membershipSnapshot = await firestore.collection("memberships").doc(deps.membershipId(organizationId, callerUid)).get();
  const membership = membershipSnapshot.exists ? membershipSnapshot.data() || {} : null;
  if (!deps.isActiveOwner(membership)) throw refusal("not_owner", "not_owner", { role: text(membership?.role) || "none" });

  const org = firestore.collection("organizations").doc(organizationId);
  const page = await org.collection("lessonRatingStats").get();
  const statsDocs = page.docs.map((snapshot) => ({ instructorId: snapshot.id, ...snapshot.data() }));
  const names = new Map();
  await Promise.all(statsDocs.map(async (doc) => {
    const snapshot = await firestore.collection("memberships").doc(deps.membershipId(organizationId, doc.instructorId)).get();
    names.set(doc.instructorId, snapshot.exists ? text(snapshot.data()?.displayName) : "");
  }));
  return {
    items: policy.RATING_ITEMS.map((item) => ({ id: item.id, question: item.question })),
    rows: policy.summarizeStats(statsDocs, (id) => names.get(id) || ""),
  };
}

module.exports = {
  HTTPS_CODE_BY_REASON,
  lessonRatingStatus,
  submitLessonRating,
  lessonRatingStats,
};
