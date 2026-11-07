"use strict";

/**
 * 회원 취소 → 담당 강사 푸시 (2026-11-07 대표: "회원이 24시간전 취소를 누르면 강사한테
 * 알림이 가는 기능").
 *
 * memberCancelLesson 이 트랜잭션에 성공한 **뒤에** 부른다. 여기서 무슨 일이 나도 취소는
 * 이미 끝났다 -- 이 함수는 던지지 않고 결과 하나(teacherNotice)를 돌려준다. 회원 앱
 * 완료 화면이 그 값으로 "강사님께 전달했어요" 를 말할지 정한다. 보내지 못했는데
 * 전달했다고 말하지 않는다.
 *
 *   sent       FCM 이 한 기기 이상 받았다
 *   off        스위치가 꺼져 있다 (runtimeConfig/teacherPush, 기본 꺼짐)
 *   no_device  강사 계정에 기기 토큰이 없다 (teacherPush/{uid})
 *   failed     FCM 이 거절했거나 읽기 · 쓰기가 실패했다 -- errorCode 에 원본 코드
 *   skipped    보낼 상대가 없다 (수업에 강사가 없음 · 기록을 못 찾음)
 *
 * ── 한 번만 ──
 * 취소 기록(memberCancellations/{recordId}) 하나에 보낸 기록 하나:
 * notificationSends/{lessonId}_{clientId}_member_cancel_{recordId}. create 는 이미 있으면
 * 실패하므로 두 번 눌러도(두 번째는 "이미 취소함" 으로 같은 recordId) 한 번만 간다.
 * recordId 를 붙인 이유: 강사가 회원을 다시 넣고 회원이 다시 취소하면 그것은 새 취소다
 * (횟수도 한 번 더 쓴다) -- 그때도 강사는 알아야 한다.
 * 두 번째 호출은 첫 번째가 남긴 status 를 그대로 돌려준다 -- 화면이 같은 말을 한다.
 *
 * ── 누구에게 ──
 * 수업의 instructorId(강사 계정 uid). 토큰은 teacherPush/{uid}.tokens 에 memberPush 와
 * 같은 모양으로 산다. **2026-11-07 현재 강사 앱은 토큰을 등록하지 않는다** -- 네이티브
 * 설정(iOS aps-environment · AppDelegate 전달, 안드로이드 플러그인)이 없다. 그래서 지금은
 * 스위치를 켜도 no_device 다. 등록 통로(teacherPushSettings)는 서버에 먼저 둔다.
 *
 * ── 문구 ──
 * 제목 "[회원 수업 취소]", 본문 "11/8(일) 10:00 수업이 회원 요청으로 취소되었어요".
 * 듀엣에서 한 사람만 빠지면 "… 듀엣 수업에서 회원 1명이 취소했어요". **회원 이름은
 * 싣지 않는다** -- 잠금 화면에 그대로 뜬다. 로그 · 기록에도 이름 · 토큰 값 없음 (§7).
 */

const { pushAllowedFor, tokenKey } = require("./member-push");

const KIND = "member_cancel";
const TITLE = "[회원 수업 취소]";
const ANDROID_CHANNEL = "member_cancel";
const KST_OFFSET = 9 * 60 * 60 * 1000; // 한국은 일광절약시간이 없다

const TEACHER_NOTICE = Object.freeze({
  SENT: "sent",
  OFF: "off",
  NO_DEVICE: "no_device",
  FAILED: "failed",
  SKIPPED: "skipped",
});

const DEAD_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
]);

const text = (value) => String(value ?? "").trim();

const toDate = (value) => {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  const at = value instanceof Date ? value : new Date(value);
  return Number.isFinite(at.getTime()) ? at : null;
};

/** "11/8(일) 10:00" (한국 시각). 읽을 수 없으면 빈 문자열. */
function lessonWhenLabel(value) {
  const at = toDate(value);
  if (!at) return "";
  const kst = new Date(at.getTime() + KST_OFFSET);
  const dow = ["일", "월", "화", "수", "목", "금", "토"][kst.getUTCDay()];
  const hh = String(kst.getUTCHours()).padStart(2, "0");
  const mm = String(kst.getUTCMinutes()).padStart(2, "0");
  return `${kst.getUTCMonth() + 1}/${kst.getUTCDate()}(${dow}) ${hh}:${mm}`;
}

/** 알림 본문. 이름 없음. */
function teacherCancelBody({ lessonStartsAt, partnerKept }) {
  const when = lessonWhenLabel(lessonStartsAt);
  const head = when ? `${when} ` : "";
  return partnerKept
    ? `${head}듀엣 수업에서 회원 1명이 취소했어요`
    : `${head}수업이 회원 요청으로 취소되었어요`;
}

const sendKey = ({ lessonId, clientId, recordId }) => `${text(lessonId)}_${text(clientId)}_${KIND}_${text(recordId)}`;

function tokensOf(doc) {
  const map = doc?.tokens && typeof doc.tokens === "object" ? doc.tokens : {};
  return Object.entries(map)
    .map(([key, value]) => ({ key, token: text(value?.token) }))
    .filter((item) => item.token);
}

const isAlreadyExists = (error) => Number(error?.code) === 6 || text(error?.code) === "already-exists";

/**
 * 취소가 끝난 뒤 강사에게 한 번. 던지지 않는다.
 *
 * @param {any} firestore Admin SDK
 * @param {{ sendEachForMulticast: (message: any) => Promise<any> }} messaging
 * @param {{ organizationId: string, lessonId: string, clientId: string, recordId: string }} input
 * @param {{ log?: { warn?: Function, error?: Function }, stamp?: () => any }} [options]
 * @returns {Promise<{ teacherNotice: string, errorCode?: string, duplicate?: boolean }>}
 */
async function notifyTeacherOfMemberCancel(firestore, messaging, input, options = {}) {
  const log = options.log || {};
  const stamp = options.stamp || (() => new Date());
  const organizationId = text(input?.organizationId);
  const lessonId = text(input?.lessonId);
  const clientId = text(input?.clientId);
  const recordId = text(input?.recordId);
  /* 진단 칸: 회원 id · 강사 uid · 이름 · 토큰 없음. 수업 id 와 취소 기록 id 만. */
  const where = { feature: "member_cancel_push", organizationId, lessonId, correlationId: recordId };
  let stage = "read_switch";
  try {
    if (!organizationId || !lessonId || !clientId || !recordId) {
      return { teacherNotice: TEACHER_NOTICE.SKIPPED, errorCode: "missing_fields" };
    }
    const sendRef = firestore.collection("notificationSends").doc(sendKey({ lessonId, clientId, recordId }));

    /* 이미 보낸(보내는 중인) 기록이 있으면 그 결과를 그대로 -- 두 번째 호출. */
    stage = "read_send";
    const existing = await sendRef.get();
    if (existing.exists) {
      const status = text(existing.data()?.status);
      return {
        teacherNotice: status === TEACHER_NOTICE.SENT ? TEACHER_NOTICE.SENT : TEACHER_NOTICE.FAILED,
        errorCode: status === TEACHER_NOTICE.SENT ? undefined : `previous_${status || "unknown"}`,
        duplicate: true,
      };
    }

    stage = "read_record";
    const record = await firestore.collection("organizations").doc(organizationId)
      .collection("memberCancellations").doc(recordId).get();
    const recordData = record.exists ? record.data() || {} : null;
    const instructorUid = text(recordData?.instructorId);
    if (!recordData || !instructorUid) return { teacherNotice: TEACHER_NOTICE.SKIPPED, errorCode: recordData ? "no_instructor" : "record_not_found" };

    stage = "read_switch";
    const switchSnap = await firestore.collection("runtimeConfig").doc("teacherPush").get();
    if (!pushAllowedFor(switchSnap.exists ? switchSnap.data() : null, instructorUid)) {
      return { teacherNotice: TEACHER_NOTICE.OFF };
    }

    stage = "read_device";
    const device = await firestore.collection("teacherPush").doc(instructorUid).get();
    const tokens = tokensOf(device.exists ? device.data() : null);
    if (tokens.length === 0) {
      log.warn?.("member_cancel_push_skipped", { ...where, stage, errorDomain: "teacher_push", errorCode: "no_device" });
      return { teacherNotice: TEACHER_NOTICE.NO_DEVICE };
    }

    stage = "claim";
    try {
      await sendRef.create({
        organizationId, lessonId, clientId, kind: KIND, recordId, status: "sending",
        tokenCount: tokens.length, createdAt: stamp(),
      });
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      /* 거의 같은 순간의 두 번째 호출 -- 첫 번째가 보내고 있다. 끝났는지 모르므로 sent 라고 하지 않는다. */
      const raced = await sendRef.get();
      const status = text(raced.exists ? raced.data()?.status : "");
      return {
        teacherNotice: status === TEACHER_NOTICE.SENT ? TEACHER_NOTICE.SENT : TEACHER_NOTICE.FAILED,
        errorCode: status === TEACHER_NOTICE.SENT ? undefined : `previous_${status || "unknown"}`,
        duplicate: true,
      };
    }

    stage = "send";
    let response;
    try {
      response = await messaging.sendEachForMulticast({
        tokens: tokens.map((item) => item.token),
        notification: { title: TITLE, body: teacherCancelBody({ lessonStartsAt: recordData.lessonStartsAt, partnerKept: recordData.partnerKept }) },
        data: { kind: KIND, organizationId, lessonId, open: "schedule" },
        android: { priority: "high", notification: { channelId: ANDROID_CHANNEL } },
        apns: { payload: { aps: { sound: "default" } } },
      });
    } catch (error) {
      const errorCode = text(error?.code) || "unknown";
      await sendRef.update({ status: "failed", errorCodes: [errorCode], finishedAt: stamp() });
      log.warn?.("member_cancel_push_failed", {
        ...where, stage, errorDomain: "fcm", errorCode, message: text(error?.message).slice(0, 200),
      });
      return { teacherNotice: TEACHER_NOTICE.FAILED, errorCode };
    }

    const responses = Array.isArray(response?.responses) ? response.responses : [];
    const errorCodes = [...new Set(responses.filter((item) => !item?.success)
      .map((item) => text(item?.error?.code) || "unknown"))];
    const dead = responses
      .map((item, index) => (!item?.success && DEAD_TOKEN_CODES.has(text(item?.error?.code)) ? tokens[index]?.key : ""))
      .filter(Boolean);
    if (dead.length) {
      const { FieldValue } = require("firebase-admin/firestore");
      await firestore.collection("teacherPush").doc(instructorUid).set({
        tokens: Object.fromEntries(dead.map((key) => [key, FieldValue.delete()])),
      }, { merge: true });
    }
    const successCount = Number(response?.successCount) || 0;
    const failureCount = Number(response?.failureCount) || 0;
    const sent = successCount > 0;
    await sendRef.update({
      status: sent ? "sent" : "failed",
      successCount, failureCount, errorCodes, removedTokens: dead.length, finishedAt: stamp(),
    });
    if (!sent) {
      log.warn?.("member_cancel_push_failed", {
        ...where, stage, errorDomain: "fcm", errorCode: errorCodes[0] || "unknown", failureCount,
      });
      return { teacherNotice: TEACHER_NOTICE.FAILED, errorCode: errorCodes[0] || "unknown" };
    }
    return { teacherNotice: TEACHER_NOTICE.SENT };
  } catch (error) {
    const errorCode = text(error?.code) || "unknown";
    log.error?.("member_cancel_push_failed", {
      ...where, stage, errorDomain: stage === "send" ? "fcm" : "firestore", errorCode,
      message: text(error?.message).slice(0, 200),
    });
    return { teacherNotice: TEACHER_NOTICE.FAILED, errorCode };
  }
}

/**
 * 취소 → 강사 알림. index.js 의 memberCancelLesson(action cancel) 본문이다.
 * 취소가 막히면 그 오류를 그대로 던진다 (아무것도 보내지 않는다). 취소가 되면
 * 알림이 어떻게 끝나든 취소 결과에 teacherNotice 를 붙여 돌려준다 -- 던지지 않는다.
 *
 * @param {any} firestore
 * @param {() => { sendEachForMulticast: Function }} getMessaging 늦게 부른다 -- 초기화 실패도 알림 실패로 본다
 * @param {{ cancel: (firestore: any, input: any, deps: any) => Promise<any> }} parts
 */
async function cancelThenNotifyTeacher(firestore, getMessaging, input, cancelDeps, parts, options = {}) {
  const result = await parts.cancel(firestore, input, cancelDeps);
  const log = options.log || {};
  let notice;
  try {
    notice = await notifyTeacherOfMemberCancel(firestore, getMessaging(), {
      organizationId: input.organizationId, lessonId: result.lessonId || input.lessonId,
      clientId: input.clientId, recordId: result.recordId,
    }, options);
  } catch (error) {
    notice = { teacherNotice: TEACHER_NOTICE.FAILED, errorCode: text(error?.code) || "unknown" };
    log.error?.("member_cancel_push_failed", {
      feature: "member_cancel_push", stage: "messaging_init", organizationId: text(input.organizationId),
      lessonId: text(input.lessonId), correlationId: text(result.recordId), errorDomain: "fcm",
      errorCode: notice.errorCode, message: text(error?.message).slice(0, 200),
    });
  }
  return { ...result, teacherNotice: notice.teacherNotice, teacherNoticeCode: notice.errorCode || "" };
}

/* ── 강사 앱이 부를 등록 통로 (teacherPushSettings) ─────────────────────────
   토큰은 서버만 쓴다 -- 규칙에 문을 내지 않는다 (teacherPush 는 맨 아래 "전부 거부").
   센터 직원(소속 active)만. 강사 앱 쪽 호출 · 네이티브 설정은 아직 없다. */

const PLATFORMS = new Set(["ios", "android"]);
const STAFF_ROLES = new Set(["owner", "area_manager", "manager", "instructor", "staff"]);
const settingsError = (httpsCode, code) => Object.assign(new Error(code), { httpsCode, code });

/**
 * @param {any} firestore
 * @param {{ callerUid: string, organizationId: string, action: string, token?: string, platform?: string, now?: () => Date }} input
 * @param {{ membershipId: (organizationId: string, uid: string) => string }} deps
 */
async function handleTeacherPushSettings(firestore, input, deps) {
  const uid = text(input?.callerUid);
  if (!uid) throw settingsError("unauthenticated", "unauthenticated");
  const organizationId = text(input?.organizationId);
  if (!organizationId) throw settingsError("invalid-argument", "organization_required");
  const membership = await firestore.collection("memberships").doc(deps.membershipId(organizationId, uid)).get();
  const data = membership.exists ? membership.data() || {} : null;
  if (!data || text(data.status) !== "active" || !STAFF_ROLES.has(text(data.role))) {
    throw settingsError("permission-denied", "not_staff");
  }
  const ref = firestore.collection("teacherPush").doc(uid);
  const at = (input?.now || (() => new Date()))();
  const action = text(input?.action);
  if (action === "register" || action === "unregister") {
    const token = text(input?.token);
    if (!token || token.length > 4096) throw settingsError("invalid-argument", "push_token_invalid");
    if (action === "register") {
      const platform = text(input?.platform);
      if (!PLATFORMS.has(platform)) throw settingsError("invalid-argument", "push_platform_invalid");
      await ref.set({ tokens: { [tokenKey(token)]: { token, platform, updatedAt: at } }, updatedAt: at }, { merge: true });
    } else {
      const { FieldValue } = require("firebase-admin/firestore");
      await ref.set({ tokens: { [tokenKey(token)]: FieldValue.delete() }, updatedAt: at }, { merge: true });
    }
  } else if (action !== "get") {
    throw settingsError("invalid-argument", "push_action_invalid");
  }
  const snapshot = await ref.get();
  return { devices: tokensOf(snapshot.exists ? snapshot.data() : null).length };
}

module.exports = {
  ANDROID_CHANNEL,
  TEACHER_NOTICE,
  TITLE,
  cancelThenNotifyTeacher,
  handleTeacherPushSettings,
  lessonWhenLabel,
  notifyTeacherOfMemberCancel,
  sendKey,
  teacherCancelBody,
};
