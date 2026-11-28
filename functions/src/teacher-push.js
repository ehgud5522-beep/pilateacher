"use strict";

/**
 * 강사 폰 푸시 (2026-11-28 대표: "강사한테 푸시 알림으로 오게끔 -- 앱에서 눈에 잘 안 띔").
 *
 * 알림함(users/{uid}/inbox)에 한 건 만든 **뒤에** 부른다. 알림함이 기록이고 푸시는 덤이다 --
 * 여기서 무슨 일이 나도 던지지 않고 결과 하나를 돌려준다. 회원 요청 · 수업 전 몸 상태가 쓴다.
 * (회원 수업 취소는 teacher-cancel-push.js 가 같은 방식으로 따로 보낸다.)
 *
 *   sent · off(스위치 runtimeConfig/teacherPush) · no_device(teacherPush/{uid} 토큰 없음) · failed · duplicate
 *
 * 한 번만: notificationSends/teacher_{inboxId}_{uid} 를 create 로 잡는다. 같은 알림함 글에 두 번 가지 않는다.
 * 문구에 회원 이름 · 부위 · 메모를 싣지 않는다 -- 잠금 화면에 그대로 뜬다. 로그에도 토큰 값 없음.
 */

const { pushAllowedFor } = require("./member-push");

const ANDROID_CHANNEL = "teacher_alerts";
const DEAD_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
]);

const text = (value) => String(value ?? "").trim();
const isAlreadyExists = (error) => Number(error?.code) === 6 || text(error?.code) === "already-exists";

function tokensOf(doc) {
  const map = doc?.tokens && typeof doc.tokens === "object" ? doc.tokens : {};
  return Object.entries(map)
    .map(([key, value]) => ({ key, token: text(value?.token) }))
    .filter((item) => item.token);
}

/**
 * @param {any} firestore Admin SDK
 * @param {() => { sendEachForMulticast: Function }} getMessaging 늦게 부른다 -- 초기화 실패도 푸시 실패로 본다
 * @param {{ instructorUid: string, inboxId: string, kind: string, title: string, body: string, organizationId: string, lessonId?: string }} input
 * @param {{ log?: any, stamp?: () => any }} [options]
 * @returns {Promise<{ push: string, errorCode?: string }>}
 */
async function pushToTeacher(firestore, getMessaging, input, options = {}) {
  const log = options.log || {};
  const stamp = options.stamp || (() => new Date());
  const uid = text(input?.instructorUid);
  const inboxId = text(input?.inboxId);
  const where = { feature: "teacher_push", kind: text(input?.kind), organizationId: text(input?.organizationId), correlationId: inboxId };
  let stage = "read_switch";
  try {
    if (!uid || !inboxId) return { push: "skipped", errorCode: "missing_fields" };
    const switchSnap = await firestore.collection("runtimeConfig").doc("teacherPush").get();
    if (!pushAllowedFor(switchSnap.exists ? switchSnap.data() : null, uid)) return { push: "off" };

    stage = "read_device";
    const device = await firestore.collection("teacherPush").doc(uid).get();
    const tokens = tokensOf(device.exists ? device.data() : null);
    if (!tokens.length) return { push: "no_device" };

    stage = "claim";
    const sendRef = firestore.collection("notificationSends").doc(`teacher_${inboxId}_${uid}`);
    try {
      await sendRef.create({ kind: text(input.kind), organizationId: text(input.organizationId), status: "sending", tokenCount: tokens.length, createdAt: stamp() });
    } catch (error) {
      if (isAlreadyExists(error)) return { push: "duplicate" };
      throw error;
    }

    stage = "send";
    let response;
    try {
      response = await getMessaging().sendEachForMulticast({
        tokens: tokens.map((item) => item.token),
        notification: { title: text(input.title), body: text(input.body) },
        data: { kind: text(input.kind), organizationId: text(input.organizationId), lessonId: text(input.lessonId), open: "inbox" },
        android: { priority: "high", notification: { channelId: ANDROID_CHANNEL } },
        apns: { payload: { aps: { sound: "default" } } },
      });
    } catch (error) {
      const errorCode = text(error?.code) || "unknown";
      await sendRef.update({ status: "failed", errorCodes: [errorCode], finishedAt: stamp() });
      log.warn?.("teacher_push_failed", { ...where, stage, errorDomain: "fcm", errorCode, message: text(error?.message).slice(0, 200) });
      return { push: "failed", errorCode };
    }

    const responses = Array.isArray(response?.responses) ? response.responses : [];
    const errorCodes = [...new Set(responses.filter((item) => !item?.success).map((item) => text(item?.error?.code) || "unknown"))];
    const dead = responses
      .map((item, index) => (!item?.success && DEAD_TOKEN_CODES.has(text(item?.error?.code)) ? tokens[index]?.key : ""))
      .filter(Boolean);
    if (dead.length) {
      const { FieldValue } = require("firebase-admin/firestore");
      await firestore.collection("teacherPush").doc(uid).set({ tokens: Object.fromEntries(dead.map((key) => [key, FieldValue.delete()])) }, { merge: true });
    }
    const successCount = Number(response?.successCount) || 0;
    await sendRef.update({ status: successCount > 0 ? "sent" : "failed", successCount, failureCount: Number(response?.failureCount) || 0, errorCodes, removedTokens: dead.length, finishedAt: stamp() });
    if (!successCount) {
      log.warn?.("teacher_push_failed", { ...where, stage, errorDomain: "fcm", errorCode: errorCodes[0] || "unknown" });
      return { push: "failed", errorCode: errorCodes[0] || "unknown" };
    }
    return { push: "sent" };
  } catch (error) {
    const errorCode = text(error?.code) || "unknown";
    log.error?.("teacher_push_failed", { ...where, stage, errorDomain: stage === "send" ? "fcm" : "firestore", errorCode, message: text(error?.message).slice(0, 200) });
    return { push: "failed", errorCode };
  }
}

module.exports = { ANDROID_CHANNEL, pushToTeacher };
