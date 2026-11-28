"use strict";

/**
 * 수업 전 몸 상태 전하기 -- 보니따의 통로 (memberLessonCondition). 판정은 shared/lesson-condition.mjs.
 *
 *   action "status": 수업 상세가 열릴 때. 지금 남긴 것 · 동의했는지 · 고칠 수 있는지. 쓰지 않는다
 *   action "save":   남기기 · 고치기. 처음이면 동의(consent: true)를 함께 보내야 한다
 *
 * 쓰는 곳:
 *   organizations/{센터}/lessonConditions/{lessonId}_{clientId}   몸 상태. expireAt(수업 + 30일)에 TTL 로 지워진다
 *   organizations/{센터}/memberConsents/{clientId}_lesson_condition  동의 기록 (판 · 시각)
 *   users/{강사}/inbox/cond_{lessonId}_{clientId}                   "불편한 곳" 일 때만. 부위 · 메모는 적지 않는다
 *
 * 본인 확인은 수업 취소와 같다: 회원 문서의 userId 가 부른 사람이어야 하고, 그 수업의 clientIds 에
 * 그 회원이 있어야 한다. 없는 문서와 남의 문서를 같은 답(not_own_lesson)으로 돌려준다.
 */

const text = (value) => String(value ?? "").trim();

let sharedModule = null;
const loadShared = async () => {
  if (!sharedModule) sharedModule = await import("../shared/lesson-condition.mjs");
  return sharedModule;
};

const CONDITION_REASON = Object.freeze({
  UNAUTHENTICATED: "unauthenticated",
  MISSING: "missing_fields",
  NOT_OWN: "not_own_lesson",
  NOT_SCHEDULED: "lesson_not_scheduled",
  STARTED: "lesson_started",
  CONSENT: "consent_required",
});

const refusal = (httpsCode, reason) => Object.assign(new Error(reason), { httpsCode, reason });

const toDate = (value) => {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  const at = value instanceof Date ? value : new Date(value);
  return Number.isFinite(at.getTime()) ? at : null;
};

const clientIdsOf = (lesson) => {
  const list = Array.isArray(lesson?.clientIds) ? lesson.clientIds.map(text).filter(Boolean) : [];
  const anchor = text(lesson?.clientId);
  return list.length ? list : (anchor ? [anchor] : []);
};

async function readContext(firestore, input) {
  const callerUid = text(input?.callerUid);
  const organizationId = text(input?.organizationId);
  const clientId = text(input?.clientId);
  const lessonId = text(input?.lessonId);
  if (!callerUid) throw refusal("unauthenticated", CONDITION_REASON.UNAUTHENTICATED);
  if (!organizationId || !clientId || !lessonId || lessonId.includes("/") || clientId.includes("/")) {
    throw refusal("invalid-argument", CONDITION_REASON.MISSING);
  }
  const org = firestore.collection("organizations").doc(organizationId);
  const [clientSnapshot, lessonSnapshot] = await Promise.all([
    org.collection("clients").doc(clientId).get(),
    org.collection("lessons").doc(lessonId).get(),
  ]);
  const client = clientSnapshot.exists ? clientSnapshot.data() || {} : null;
  const lesson = lessonSnapshot.exists ? lessonSnapshot.data() || {} : null;
  if (!client || text(client.userId) !== callerUid || !lesson || !clientIdsOf(lesson).includes(clientId)) {
    throw refusal("permission-denied", CONDITION_REASON.NOT_OWN);
  }
  return { callerUid, organizationId, clientId, lessonId, org, lesson, startsAt: toDate(lesson.startsAt) };
}

/** 지금 남긴 것 · 동의 여부 · 고칠 수 있는지. */
async function lessonConditionStatus(firestore, input, deps = {}) {
  const shared = await loadShared();
  const now = (deps.now || (() => new Date()))();
  const context = await readContext(firestore, input);
  const [conditionSnapshot, consentSnapshot] = await Promise.all([
    context.org.collection("lessonConditions").doc(shared.conditionDocId(context.lessonId, context.clientId)).get(),
    context.org.collection("memberConsents").doc(`${context.clientId}_lesson_condition`).get(),
  ]);
  const saved = conditionSnapshot.exists ? conditionSnapshot.data() || {} : null;
  const consent = consentSnapshot.exists ? consentSnapshot.data() || {} : null;
  return {
    editable: text(context.lesson.status) === "scheduled" && Boolean(context.startsAt) && context.startsAt > now,
    consented: text(consent?.version) === shared.CONDITION_CONSENT_VERSION,
    condition: saved ? { mood: text(saved.mood), areas: Array.isArray(saved.areas) ? saved.areas.map(text) : [], memo: text(saved.memo) } : null,
  };
}

/** 남기기 · 고치기. */
async function saveLessonCondition(firestore, input, deps = {}) {
  const shared = await loadShared();
  const now = (deps.now || (() => new Date()))();
  const stamp = deps.stamp || (() => now);
  const context = await readContext(firestore, input);
  if (text(context.lesson.status) !== "scheduled") throw refusal("failed-precondition", CONDITION_REASON.NOT_SCHEDULED);
  if (!context.startsAt || context.startsAt <= now) throw refusal("failed-precondition", CONDITION_REASON.STARTED);
  const refused = shared.conditionError(input?.condition);
  if (refused) throw refusal("invalid-argument", refused);

  const consentRef = context.org.collection("memberConsents").doc(`${context.clientId}_lesson_condition`);
  const consentSnapshot = await consentRef.get();
  const consented = consentSnapshot.exists && text(consentSnapshot.data()?.version) === shared.CONDITION_CONSENT_VERSION;
  if (!consented && input?.consent !== true) throw refusal("failed-precondition", CONDITION_REASON.CONSENT);

  const condition = shared.cleanCondition(input.condition);
  const instructorId = text(context.lesson.instructorId);
  const docId = shared.conditionDocId(context.lessonId, context.clientId);
  const batch = firestore.batch();
  if (!consented) {
    batch.set(consentRef, {
      organizationId: context.organizationId, clientId: context.clientId, userId: context.callerUid,
      kind: "lesson_condition", version: shared.CONDITION_CONSENT_VERSION, agreedAt: stamp(),
    });
  }
  batch.set(context.org.collection("lessonConditions").doc(docId), {
    organizationId: context.organizationId, lessonId: context.lessonId, clientId: context.clientId, instructorId,
    lessonStartsAt: context.startsAt, ...condition, updatedAt: stamp(), expireAt: shared.conditionExpireAt(context.startsAt),
  });
  let notified = false;
  let pushTarget = null;
  if (instructorId && condition.mood === shared.CONDITION_MOOD.DISCOMFORT) {
    /* 부위 · 메모는 알림함에 적지 않는다 -- 알림함은 지워지지 않고, 30일 뒤 지우는 약속이 깨진다. */
    batch.set(firestore.collection("users").doc(instructorId).collection("inbox").doc(`cond_${docId}`), {
      kind: "member_condition", organizationId: context.organizationId, lessonId: context.lessonId, clientId: context.clientId,
      title: "[몸 상태 전달]", body: "회원이 수업 전에 불편한 곳을 알려 왔어요. 수업 전 브리핑에서 확인해 주세요",
      lessonStartsAt: context.startsAt, createdAt: stamp(),
    });
    notified = true;
    pushTarget = {
      instructorUid: instructorId, inboxId: `cond_${docId}`, kind: "member_condition", organizationId: context.organizationId,
      lessonId: context.lessonId, title: "[몸 상태 전달]", body: "회원이 수업 전에 불편한 곳을 알려 왔어요",
    };
  }
  await batch.commit();
  /* pushTarget 은 index.js 만 쓴다 (푸시). 회원 화면에는 saved · notified · mood 만 간다. */
  return { saved: true, notified, mood: condition.mood, pushTarget };
}

module.exports = { CONDITION_REASON, lessonConditionStatus, saveLessonCondition };
