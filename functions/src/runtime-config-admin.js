"use strict";

/**
 * 운영 설정 쓰기 — **대표 전용 통로다.**
 *
 * ── 왜 서버인가 ──
 * 규칙은 `runtimeConfig/*` 의 쓰기를 닫아 두었다. 숫자 하나가 센터 전체의
 * 수업 확정을 막을 수 있어, 앱에서 실수로 눌러지는 자리를 만들지 않기로 했다.
 * 그렇다고 콘솔에서만 고치게 두면 대표가 Firestore 문서 구조를 알아야 한다.
 *
 * Admin SDK 는 규칙을 우회한다. 그래서 규칙은 계속 "아무도 못 쓴다" 라고 말하고,
 * 그 예외는 여기 하나뿐이다 -- pass-admin.js 와 같은 판단이다.
 *
 * ── 들어오는 값을 믿지 않는다 ──
 * 빌드 번호는 숫자 문자열이거나 빈 문자열이다. 빈 문자열은 "정하지 않았다" 이고
 * 그대로 저장한다 -- 0 으로 채우면 "모두 통과" 로 읽혀, 나중에 값을 넣었을 때와
 * 동작이 달라진다.
 *
 * **최소 빌드를 최신 빌드보다 높게 둘 수 없다.** 그렇게 두면 최신 앱을 깐
 * 사람까지 필수 팝업에 갇히고, 그 상태를 푸는 길은 이 화면뿐인데 그 화면도
 * 폰에 있다.
 */

const text = (value) => String(value ?? "").trim();

/** 빌드 번호 칸. 숫자 문자열이거나 빈 문자열이다. */
function buildField(value, label) {
  const raw = text(value);
  if (!raw) return "";
  if (!/^\d+$/.test(raw)) throw new Error(`${label}_invalid`);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${label}_invalid`);
  return String(parsed);
}

/** 왜 거부됐는가. 코드 없는 "저장하지 못했습니다" 를 남기지 않는다. */
const CONFIG_ERROR = Object.freeze({
  UNKNOWN_DOCUMENT: "unknown_document",
  MINIMUM_ABOVE_LATEST: "minimum_above_latest",
});

/**
 * 앱 업데이트 설정 한 벌. 플랫폼마다 최신·최소·문구다.
 *
 * @param {any} input
 */
function appUpdatePayload(input) {
  const platform = (key) => {
    const row = input?.[key] && typeof input[key] === "object" ? input[key] : {};
    const latestBuild = buildField(row.latestBuild, `${key}_latest_build`);
    const minimumBuild = buildField(row.minimumBuild, `${key}_minimum_build`);
    /* 최소가 최신보다 높으면 최신 앱을 깐 사람까지 갇힌다. 최신을 비워 둔
       채 최소만 올리는 것은 막지 않는다 -- 그때는 최소가 곧 기준이다. */
    if (latestBuild && minimumBuild && Number(minimumBuild) > Number(latestBuild)) {
      throw new Error(CONFIG_ERROR.MINIMUM_ABOVE_LATEST);
    }
    return { latestBuild, minimumBuild, message: text(row.message).slice(0, 200) };
  };
  return { android: platform("android"), ios: platform("ios") };
}

/** 확정 최소 빌드. 플랫폼마다 번호 체계가 달라 하나로 묶지 않는다. */
function settlementPayload(input) {
  const table = input?.minBuilds && typeof input.minBuilds === "object" ? input.minBuilds : {};
  return {
    minBuilds: {
      web: buildField(table.web, "web_min_build"),
      android: buildField(table.android, "android_min_build"),
      ios: buildField(table.ios, "ios_min_build"),
    },
  };
}

/**
 * 일정 동기화 스위치 (2026-10-31, 서버 기준 동기화 2단계).
 *
 * 서버의 일정을 받아 기기에 합치는 것(서버가 기준)을 누구에게 켤 것인가. 대표
 * 결정: 대표 → 강사 한 명 → 전체 순서로 켠다. 폰도 쓰는 계정은 그 폰이 새 빌드를
 * 받은 뒤에 켠다 (Android 프로덕션 100% · 최소 버전 강제) -- 옛 폰은 일정을 서버에
 * 보내지 않아, 켜도 그 폰의 일정은 따라오지 않는다.
 *
 * mode: off (아무도) · listed (userIds 만) · all (전부). 앱은 못 읽으면 꺼진 것으로 본다.
 */
function scheduleSyncPayload(input) {
  const mode = text(input?.mode);
  if (!["off", "listed", "all"].includes(mode)) throw new Error("schedule_sync_mode_invalid");
  const userIds = [...new Set((Array.isArray(input?.userIds) ? input.userIds : []).map(text).filter(Boolean))];
  if (userIds.length > 50) throw new Error("schedule_sync_too_many_users");
  /* 계정 id 만 담는다. 이 문서는 로그인한 누구나 읽는다 -- 이름 · 연락처가 들어가면
     센터 밖까지 보인다. 이름(한글) · 이메일(@ .)은 아래 모양에서 걸리고, 숫자만인
     값(전화번호)은 따로 막는다. Firebase 계정 id 는 숫자만으로 되지 않는다. */
  if (userIds.some((id) => !/^[A-Za-z0-9_-]{6,128}$/.test(id) || /^[0-9-]+$/.test(id))) {
    throw new Error("schedule_sync_user_invalid");
  }
  return { mode, userIds };
}

const WRITERS = Object.freeze({
  appUpdate: appUpdatePayload,
  settlement: settlementPayload,
  scheduleSync: scheduleSyncPayload,
  /* 본인 일정 · 메모 동기화 (3단계). 센터 수업과 따로 켜고 끈다 -- 모양은 같다. */
  privateSync: scheduleSyncPayload,
});

/**
 * 설정 문서 하나를 쓴다. 두 문서만 쓸 수 있다.
 *
 * @param {any} firestore
 * @param {{ document: string, value: any, actorId: string, now?: () => Date }} input
 */
async function writeRuntimeConfig(firestore, input) {
  const name = text(input?.document);
  const build = WRITERS[name];
  // 목록에 없는 문서는 쓰지 않는다. 통로를 하나 내면서 전부를 열지 않는다.
  if (!build) throw new Error(CONFIG_ERROR.UNKNOWN_DOCUMENT);

  const at = (input?.now || (() => new Date()))();
  const payload = build(input?.value);
  await firestore.collection("runtimeConfig").doc(name).set({
    ...payload,
    /* 누가 언제 바꿨는가. 이 숫자가 센터 전체를 막을 수 있어, 바뀐 뒤에
       "왜 이렇게 되어 있지" 에 답할 것이 있어야 한다. */
    updatedAt: at,
    updatedBy: text(input?.actorId),
  });
  return { document: name, value: payload };
}

/** 지금 적혀 있는 값. 화면이 고치기 전에 보여준다. */
async function readRuntimeConfig(firestore, documents = Object.keys(WRITERS)) {
  const out = {};
  for (const name of documents) {
    if (!WRITERS[name]) continue;
    const snapshot = await firestore.collection("runtimeConfig").doc(name).get();
    out[name] = snapshot.exists ? snapshot.data() : null;
  }
  return out;
}

/** 요청을 거부할 때. index.js 가 httpsCode 그대로 HttpsError 로 바꾼다. */
const requestError = (httpsCode, message) => Object.assign(new Error(message), { httpsCode });

/**
 * updateRuntimeConfig 의 본문 (2026-10-31 index.js 에서 옮김). 동작은 그대로다 --
 * 테스트가 역할마다 이 길을 그대로 지나게 하려고 옮겼다.
 *
 * 1. 로그인 · 소속 확인 → 2. **대표만** (총괄매니저도 아니다) → 3. 문서가 없으면 읽기만,
 * 있으면 그 문서를 쓰고 지금 값 전체를 돌려준다.
 *
 * @param {any} firestore
 * @param {{ callerUid: string, organizationId: string, document?: string, value?: any, now?: () => Date }} input
 * @param {{ membershipId: (organizationId: string, uid: string) => string, isActiveOwner: (membership: any) => boolean }} deps
 */
async function handleRuntimeConfigRequest(firestore, input, deps) {
  const callerUid = text(input?.callerUid);
  const organizationId = text(input?.organizationId);
  if (!callerUid) throw requestError("unauthenticated", "Please sign in again.");
  if (!organizationId) throw requestError("invalid-argument", "organizationId is required.");
  const membership = await firestore
    .collection("memberships").doc(deps.membershipId(organizationId, callerUid)).get();
  if (!deps.isActiveOwner(membership.exists ? membership.data() : null)) {
    throw requestError("permission-denied", "Only the centre owner can change this.");
  }
  const document = text(input?.document);
  if (!document) return { config: await readRuntimeConfig(firestore) };
  /* 쓰기 실패만 따로 표시한다 -- index.js 가 그것만 failed-precondition 으로 바꾸고,
     읽기 · 소속 조회 실패는 전처럼 그대로 던진다. */
  let result;
  try {
    result = await writeRuntimeConfig(firestore, {
      document, value: input?.value, actorId: callerUid, now: input?.now,
    });
  } catch (error) {
    throw Object.assign(error, { writeFailed: true });
  }
  return { ...result, config: await readRuntimeConfig(firestore) };
}

module.exports = {
  CONFIG_ERROR,
  handleRuntimeConfigRequest,
  buildField,
  appUpdatePayload,
  settlementPayload,
  scheduleSyncPayload,
  readRuntimeConfig,
  writeRuntimeConfig,
};
