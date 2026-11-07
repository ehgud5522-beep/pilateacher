"use strict";

/**
 * 회원 수업 알림 (2026-11-07 대표, 지시서 2차 기본 기능).
 *
 * 두 가지다. 문구는 대표가 정한 그대로이고 **회원 이름은 어디에도 싣지 않는다** --
 * 잠금 화면에 그대로 뜬다.
 *
 *   수업 30시간 전  "내일 수업이 예정되어 있습니다. 변경이 필요하면 취소 마감 전까지 확인해 주세요."
 *   수업 30분 전    "잠시 후 수업이 시작됩니다. 수업 준비를 부탁드립니다."
 *
 * ── 언제 보내는가 ──
 * 5분마다 돈다. 지난번에 훑은 곳(sweptUntil)부터 지금까지를 한 칸으로 보고,
 * 수업 시작이 그 칸 + 30분 / + 30시간 안에 드는 것만 고른다. 칸이 이어 붙어서
 * 겹침도 빈틈도 없다. 함수가 한동안 못 돌았으면 최대 15분까지만 거슬러 간다 --
 * 오래 멈췄다 깨어나 지난 알림을 한꺼번에 쏟지 않게.
 *
 * 그래서 **늦게 잡힌 수업은 놓친다**: 30분 안쪽에 새로 넣은 수업, 시작 시각을 이미
 * 훑은 칸 안쪽으로 옮긴 수업. 기본 기능의 한계이고 PR 에 적었다.
 *
 * ── 보내기 직전에 다시 본다 ──
 * 수업 문서를 다시 읽어 취소 · 삭제 · 확정 · 회원 빠짐이면 보내지 않는다. 시각이
 * 바뀌었으면 새 시각으로 다시 판정한다 (칸 밖이면 이번에는 안 보내고, 새 시각이
 * 다음 칸에 들어올 때 보낸다).
 *
 * ── 한 번만 ──
 * (수업, 회원, 종류) 하나에 기록 문서 하나 -- notificationSends/{lessonId}_{clientId}_{kind}.
 * create 는 이미 있으면 실패하므로, 두 실행이 겹쳐도 하나만 보낸다.
 *
 * ── 누구에게 ──
 * 수업의 clientIds 각각 (듀엣은 회원마다 따로). 회원 문서의 userId 가 연결된 회원
 * 앱 계정이다. 그 계정의 memberPush/{uid} 에 기기 토큰과 알림 설정이 있다.
 *
 * ── 스위치 ──
 * runtimeConfig/memberPush { mode: off | listed | all, userIds }. 없거나 못 읽으면
 * 꺼진 것이다. listed 는 회원 계정 uid 목록이다 (시험용).
 *
 * 로그와 기록에는 이름 · 번호 · 토큰 값을 남기지 않는다 (§7). 토큰은 개수만.
 */

const crypto = require("node:crypto");

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

const PUSH_KIND = Object.freeze({ LESSON_30H: "lesson30h", LESSON_30M: "lesson30m" });

/** 종류마다 문구와 "시작 몇 분 전" . 문구는 대표 확정(2026-11-07) 그대로다. */
const PUSH_COPY = Object.freeze({
  [PUSH_KIND.LESSON_30H]: Object.freeze({
    title: "수업 30시간 전",
    body: "내일 수업이 예정되어 있습니다. 변경이 필요하면 취소 마감 전까지 확인해 주세요.",
    label: "취소 마감 안내",
    lead: 30 * HOUR,
  }),
  [PUSH_KIND.LESSON_30M]: Object.freeze({
    title: "수업 30분 전",
    body: "잠시 후 수업이 시작됩니다. 수업 준비를 부탁드립니다.",
    label: "수업 리마인드",
    lead: 30 * MINUTE,
  }),
});

/** 오래 멈췄다 깨어나도 이만큼만 거슬러 간다. */
const MAX_CATCH_UP = 15 * MINUTE;

/** 안드로이드 알림 채널. 회원 앱이 같은 id 로 만든다. */
const ANDROID_CHANNEL = "lesson_reminders";

/** 이 오류는 그 토큰이 죽었다는 뜻이다 -- 지운다. */
const DEAD_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
]);

const text = (value) => String(value ?? "").trim();

const toMillis = (value) => {
  if (!value) return NaN;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return new Date(value).getTime();
};

/** 이 계정에 보내도 되는가 (스위치). */
function pushAllowedFor(config, userId) {
  const mode = text(config?.mode);
  if (mode === "all") return true;
  if (mode === "listed") return (Array.isArray(config?.userIds) ? config.userIds : []).map(text).includes(text(userId));
  return false;
}

/**
 * 이번 실행이 훑을 칸. (from, to] -- 왼쪽은 열고 오른쪽은 닫는다.
 *
 * @param {{ now: number, sweptUntil?: number | null }} input
 */
function sweepWindow({ now, sweptUntil = null }) {
  const floor = now - MAX_CATCH_UP;
  const from = Number.isFinite(sweptUntil) ? Math.max(sweptUntil, floor) : floor;
  return { from: Math.min(from, now), to: now };
}

/**
 * 이 수업이 이 칸에서 받을 알림 종류. 시작이 (from + lead, to + lead] 안이면 그 종류다.
 * 이미 시작한 수업은 아무것도 받지 않는다.
 *
 * @param {number} startsAt @param {{ from: number, to: number }} window
 */
function dueKinds(startsAt, window) {
  if (!Number.isFinite(startsAt) || startsAt <= window.to) return [];
  return Object.entries(PUSH_COPY)
    .filter(([, copy]) => startsAt > window.from + copy.lead && startsAt <= window.to + copy.lead)
    .map(([kind]) => kind);
}

/** 보낼 수 있는 수업인가. */
function sendableLesson(lesson) {
  return Boolean(lesson) && text(lesson.status) === "scheduled" && !lesson.deletedAt
    && Array.isArray(lesson.clientIds) && lesson.clientIds.length > 0;
}

const sendKey = (lessonId, clientId, kind) => `${text(lessonId)}_${text(clientId)}_${text(kind)}`;

/** 토큰을 문서 칸 이름으로. 값 자체는 칸 이름에 쓰지 않는다. */
const tokenKey = (token) => crypto.createHash("sha256").update(text(token)).digest("hex").slice(0, 32);

/** 회원 알림 설정. 없으면 둘 다 켜짐이다. */
function prefsOf(doc) {
  const prefs = doc?.prefs && typeof doc.prefs === "object" ? doc.prefs : {};
  return {
    [PUSH_KIND.LESSON_30H]: prefs[PUSH_KIND.LESSON_30H] !== false,
    [PUSH_KIND.LESSON_30M]: prefs[PUSH_KIND.LESSON_30M] !== false,
  };
}

function tokensOf(doc) {
  const map = doc?.tokens && typeof doc.tokens === "object" ? doc.tokens : {};
  return Object.entries(map)
    .map(([key, value]) => ({ key, token: text(value?.token) }))
    .filter((item) => item.token);
}

/** FCM 에 보낼 한 통. 이름 없음 -- 데이터는 수업 id 와 종류뿐이다. */
function messageFor({ kind, organizationId, lessonId, tokens }) {
  const copy = PUSH_COPY[kind];
  return {
    tokens,
    notification: { title: copy.title, body: copy.body },
    data: { kind, organizationId: text(organizationId), lessonId: text(lessonId), open: "home" },
    android: { priority: "high", notification: { channelId: ANDROID_CHANNEL } },
    apns: { payload: { aps: { sound: "default" } } },
  };
}

/**
 * 한 번 돈다. firestore 는 Admin SDK, messaging 은 { sendEachForMulticast }.
 *
 * @param {any} firestore
 * @param {{ sendEachForMulticast: (message: any) => Promise<any> }} messaging
 * @param {{ now?: () => number, log?: { info?: Function, warn?: Function, error?: Function }, serverTimestamp?: () => any }} [options]
 */
async function runMemberPush(firestore, messaging, options = {}) {
  const now = (options.now || Date.now)();
  const log = options.log || {};
  const stamp = options.serverTimestamp || (() => new Date(now));
  const tally = { lessons: 0, planned: 0, sent: 0, failed: 0, skipped: 0, duplicate: 0, noAccount: 0, reads: 0 };

  const switchSnap = await firestore.collection("runtimeConfig").doc("memberPush").get();
  tally.reads += 1;
  const config = switchSnap.exists ? switchSnap.data() : null;
  const stateRef = firestore.collection("notificationState").doc("memberPush");
  const stateSnap = await stateRef.get();
  tally.reads += 1;
  const window = sweepWindow({ now, sweptUntil: toMillis(stateSnap.exists ? stateSnap.data()?.sweptUntil : null) });

  if (text(config?.mode) !== "all" && text(config?.mode) !== "listed") {
    /* 꺼져 있어도 칸은 앞으로 민다 -- 켜는 순간 지난 수업 알림이 몰려 나가지 않게. */
    await stateRef.set({ sweptUntil: new Date(window.to), updatedAt: stamp() }, { merge: true });
    return { ...tally, switch: "off", window };
  }

  const organizations = await firestore.collection("organizations").select().get();
  tally.reads += organizations.size;
  for (const organization of organizations.docs) {
    const organizationId = organization.id;
    const lessons = organization.ref.collection("lessons");
    /* 두 칸을 따로 읽는다. 하나로 읽으면 30분 칸과 30시간 칸 사이 하루치를 다 읽는다. */
    const found = new Map();
    for (const copy of Object.values(PUSH_COPY)) {
      const page = await lessons
        .where("startsAt", ">", new Date(window.from + copy.lead))
        .where("startsAt", "<=", new Date(window.to + copy.lead))
        .get();
      tally.reads += page.size;
      for (const doc of page.docs) found.set(doc.id, doc.data());
    }
    for (const [lessonId, lesson] of found) {
      if (!sendableLesson(lesson)) continue;
      tally.lessons += 1;
      for (const kind of dueKinds(toMillis(lesson.startsAt), window)) {
        for (const clientId of lesson.clientIds.map(text).filter(Boolean)) {
          tally.planned += 1;
          const outcome = await sendOne(firestore, messaging, {
            organizationId, lessonId, clientId, kind, window, config, stamp, log,
          });
          tally.reads += outcome.reads || 0;
          tally[outcome.result] = (tally[outcome.result] || 0) + 1;
        }
      }
    }
  }
  await stateRef.set({ sweptUntil: new Date(window.to), updatedAt: stamp() }, { merge: true });
  return { ...tally, switch: text(config?.mode), window };
}

/** 한 회원에게 한 종류를 한 번. 결과: sent | failed | skipped | duplicate | noAccount */
async function sendOne(firestore, messaging, input) {
  const { organizationId, lessonId, clientId, kind, window, config, stamp, log } = input;
  const org = firestore.collection("organizations").doc(organizationId);
  let reads = 0;

  const client = await org.collection("clients").doc(clientId).get();
  reads += 1;
  const userId = text(client.exists ? client.data()?.userId : "");
  if (!userId) return { result: "noAccount", reads };
  if (!pushAllowedFor(config, userId)) return { result: "skipped", reads };

  const device = await firestore.collection("memberPush").doc(userId).get();
  reads += 1;
  const data = device.exists ? device.data() : null;
  if (!prefsOf(data)[kind]) return { result: "skipped", reads };
  const tokens = tokensOf(data);
  if (tokens.length === 0) return { result: "skipped", reads };

  /* 보내기 직전에 다시 본다 -- 강사가 방금 취소했거나 시각을 옮겼을 수 있다. */
  const fresh = await org.collection("lessons").doc(lessonId).get();
  reads += 1;
  const lesson = fresh.exists ? fresh.data() : null;
  if (!sendableLesson(lesson) || !lesson.clientIds.map(text).includes(clientId)
    || !dueKinds(toMillis(lesson.startsAt), window).includes(kind)) {
    return { result: "skipped", reads };
  }

  const ref = firestore.collection("notificationSends").doc(sendKey(lessonId, clientId, kind));
  try {
    await ref.create({
      organizationId, lessonId, clientId, kind, status: "sending",
      startsAt: lesson.startsAt, tokenCount: tokens.length, createdAt: stamp(),
    });
  } catch (error) {
    /* 이미 있다 -- 다른 실행이 보냈거나 보내는 중이다. */
    if (Number(error?.code) === 6 || text(error?.code) === "already-exists") return { result: "duplicate", reads };
    throw error;
  }

  let response;
  try {
    response = await messaging.sendEachForMulticast(messageFor({
      kind, organizationId, lessonId, tokens: tokens.map((item) => item.token),
    }));
  } catch (error) {
    const errorCode = text(error?.code) || "unknown";
    await ref.update({ status: "failed", errorCodes: [errorCode], finishedAt: stamp() });
    log.warn?.("member_push_failed", {
      feature: "member_push", stage: "send", errorDomain: "fcm", errorCode, organizationId, kind,
    });
    return { result: "failed", reads };
  }

  const responses = Array.isArray(response?.responses) ? response.responses : [];
  const errorCodes = [...new Set(responses.filter((item) => !item?.success)
    .map((item) => text(item?.error?.code) || "unknown"))];
  const dead = responses
    .map((item, index) => (!item?.success && DEAD_TOKEN_CODES.has(text(item?.error?.code)) ? tokens[index]?.key : ""))
    .filter(Boolean);
  if (dead.length) {
    const { FieldValue } = require("firebase-admin/firestore");
    await firestore.collection("memberPush").doc(userId).set({
      tokens: Object.fromEntries(dead.map((key) => [key, FieldValue.delete()])),
    }, { merge: true });
  }
  const successCount = Number(response?.successCount) || 0;
  const failureCount = Number(response?.failureCount) || 0;
  await ref.update({
    status: successCount > 0 ? "sent" : "failed",
    successCount, failureCount, errorCodes, removedTokens: dead.length, finishedAt: stamp(),
  });
  if (successCount === 0) {
    log.warn?.("member_push_failed", {
      feature: "member_push", stage: "send", errorDomain: "fcm",
      errorCode: errorCodes[0] || "unknown", organizationId, kind, failureCount,
    });
  }
  return { result: successCount > 0 ? "sent" : "failed", reads };
}

/* ── 회원 앱이 부르는 통로 ─────────────────────────────────────────────────
   토큰과 알림 설정은 서버만 쓴다 (memberPush/{uid}). 회원 앱에 Firestore 쓰기 문을
   새로 내지 않는다 -- 규칙 변경 없이 간다. */

const PLATFORMS = new Set(["ios", "android"]);

const settingsError = (httpsCode, code) => Object.assign(new Error(code), { httpsCode, code });

/**
 * @param {any} firestore
 * @param {{ callerUid: string, action: string, token?: string, platform?: string, prefs?: any, now?: () => Date }} input
 */
async function handleMemberPushSettings(firestore, input) {
  const uid = text(input?.callerUid);
  if (!uid) throw settingsError("unauthenticated", "unauthenticated");
  /* 회원 앱 계정만. 연결 문서가 없는 계정(강사 · 아무나)은 여기에 쓸 일이 없다. */
  const link = await firestore.collection("memberLinks").doc(uid).get();
  if (!link.exists) throw settingsError("permission-denied", "member_link_missing");

  const ref = firestore.collection("memberPush").doc(uid);
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
  } else if (action === "save") {
    const raw = input?.prefs && typeof input.prefs === "object" ? input.prefs : {};
    const prefs = {};
    for (const kind of Object.values(PUSH_KIND)) {
      if (kind in raw) {
        if (typeof raw[kind] !== "boolean") throw settingsError("invalid-argument", "push_prefs_invalid");
        prefs[kind] = raw[kind];
      }
    }
    if (!Object.keys(prefs).length) throw settingsError("invalid-argument", "push_prefs_invalid");
    await ref.set({ prefs, updatedAt: at }, { merge: true });
  } else if (action !== "get") {
    throw settingsError("invalid-argument", "push_action_invalid");
  }

  const snapshot = await ref.get();
  const data = snapshot.exists ? snapshot.data() : null;
  return { prefs: prefsOf(data), devices: tokensOf(data).length };
}

module.exports = {
  ANDROID_CHANNEL,
  MAX_CATCH_UP,
  PUSH_COPY,
  PUSH_KIND,
  dueKinds,
  handleMemberPushSettings,
  messageFor,
  prefsOf,
  pushAllowedFor,
  runMemberPush,
  sendKey,
  sendableLesson,
  sweepWindow,
  tokenKey,
};
