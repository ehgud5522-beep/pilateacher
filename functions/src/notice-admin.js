"use strict";

/**
 * 공지 쓰기 · 고치기 · 지우기 — **대표 · 총괄매니저의 통로 (manageNotice).**
 *
 * ── 왜 서버인가 (2026-10-31 대표 결정) ──
 * 공지는 강사 전원의 화면에 팝업으로 선다. 그전까지는 규칙이 대표 · 총괄매니저의
 * 직접 쓰기를 열어 두었는데, "총괄매니저는 자기가 쓴 공지만 고친다" 와 "작성자
 * 이름을 서버가 적는다" 는 규칙으로 지키기 어렵다 -- 이름은 쓰는 사람이 보낸 값을
 * 믿게 되고, 지우기는 규칙에서 열면 무엇이든 지워진다. 그래서 규칙은 공지 쓰기를
 * 닫고, 그 예외를 여기 하나로 둔다.
 *
 * updateRuntimeConfig 는 넓히지 않는다 -- 그 통로는 계속 대표 전용이다.
 *
 * ── 누가 무엇을 ──
 * - 대표: 모든 공지를 쓰고 고치고 지운다
 * - 총괄매니저: 쓰고, **자기가 쓴 공지만** 고치고 지운다
 * - 그 밖(FC매니저 · 매니저 · 강사 · 회원 · 소속 없음): 거절
 *
 * 받는 칸은 제목 · 본문 · 대상 지점 · 중요 · 표시 종료일뿐이다 (shared/notices.mjs).
 * 작성자 이름은 소속 문서의 displayName 을 서버가 적는다 -- 보낸 값을 믿지 않는다.
 */

const text = (value) => String(value ?? "").trim();

/* functions/ 는 CommonJS 이고 shared/ 는 ESM 이다. 쓰는 순간에 읽는다. */
let sharedModule = null;
const loadShared = async () => {
  if (!sharedModule) sharedModule = await import("../shared/notices.mjs");
  return sharedModule;
};

/** 왜 거부됐는가. 코드 없는 "저장하지 못했습니다" 를 남기지 않는다. */
const NOTICE_REASON = Object.freeze({
  NOT_OWNER_LEVEL: "notice_not_owner_level",
  NOT_AUTHOR: "notice_not_author",
  INVALID: "notice_invalid",
  NOT_FOUND: "notice_not_found",
  UNKNOWN_ACTION: "notice_unknown_action",
});

/** 요청을 거부할 때. index.js 가 httpsCode 와 reason 을 그대로 HttpsError 로 바꾼다. */
const requestError = (httpsCode, reason, message) => Object.assign(new Error(message || reason), { httpsCode, reason });

/** 센터의 오늘 (서울 달력 날짜). 지난 종료일을 거르는 데만 쓴다. */
const seoulDay = (at) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
}).format(at);

const noticePath = (organizationId, noticeId) => `organizations/${organizationId}/notices/${noticeId}`;

/**
 * @param {any} firestore Admin Firestore (또는 같은 모양)
 * @param {{
 *   callerUid: string, organizationId: string, action: "create" | "update" | "delete",
 *   noticeId?: string, value?: any, now?: () => Date,
 * }} input
 * @param {{ membershipId: (organizationId: string, uid: string) => string, newId: () => string }} deps
 */
async function handleNoticeRequest(firestore, input, deps) {
  const callerUid = text(input?.callerUid);
  const organizationId = text(input?.organizationId);
  const action = text(input?.action);
  if (!callerUid) throw requestError("unauthenticated", "unauthenticated", "Please sign in again.");
  if (!organizationId) throw requestError("invalid-argument", "organization_required", "organizationId is required.");
  if (!["create", "update", "delete"].includes(action)) throw requestError("invalid-argument", NOTICE_REASON.UNKNOWN_ACTION);

  const membershipSnapshot = await firestore.collection("memberships").doc(deps.membershipId(organizationId, callerUid)).get();
  const membership = membershipSnapshot.exists ? membershipSnapshot.data() : null;
  const role = membership?.status === "active" ? text(membership.role) : "";
  if (role !== "owner" && role !== "area_manager") {
    throw requestError("permission-denied", NOTICE_REASON.NOT_OWNER_LEVEL, "Only the owner or an area manager can write notices.");
  }

  const at = (input?.now || (() => new Date()))();
  const shared = await loadShared();

  if (action === "create") {
    const refused = shared.noticeError(input?.value, { today: seoulDay(at) });
    if (refused) throw requestError("invalid-argument", NOTICE_REASON.INVALID, refused);
    const noticeId = text(deps.newId());
    const data = {
      organizationId,
      ...shared.noticeContent(input?.value),
      status: shared.NOTICE_STATUS.ACTIVE,
      createdAt: at,
      createdBy: callerUid,
      createdByName: text(membership.displayName).slice(0, 40),
      updatedAt: at,
      updatedBy: callerUid,
    };
    await firestore.doc(noticePath(organizationId, noticeId)).set(data);
    return { action, noticeId };
  }

  const noticeId = text(input?.noticeId);
  if (!noticeId) throw requestError("invalid-argument", "notice_id_required", "noticeId is required.");
  const reference = firestore.doc(noticePath(organizationId, noticeId));
  const snapshot = await reference.get();
  const current = snapshot.exists ? snapshot.data() : null;
  if (!current || text(current.organizationId) !== organizationId) throw requestError("not-found", NOTICE_REASON.NOT_FOUND);
  /* 총괄매니저는 자기가 쓴 공지만. 대표는 전부. */
  if (role === "area_manager" && text(current.createdBy) !== callerUid) {
    throw requestError("permission-denied", NOTICE_REASON.NOT_AUTHOR, "An area manager can only change their own notices.");
  }

  if (action === "delete") {
    await reference.delete();
    return { action, noticeId };
  }

  const refused = shared.noticeError(input?.value, { today: seoulDay(at) });
  if (refused) throw requestError("invalid-argument", NOTICE_REASON.INVALID, refused);
  /* 통째로 다시 쓴다 -- 옛 공지의 이미지 · 링크 · 직급 칸이 남지 않게. 쓴 사람과 시각은 그대로. */
  await reference.set({
    organizationId,
    ...shared.noticeContent(input?.value),
    status: shared.NOTICE_STATUS.ACTIVE,
    createdAt: current.createdAt ?? at,
    createdBy: text(current.createdBy),
    createdByName: text(current.createdByName),
    updatedAt: at,
    updatedBy: callerUid,
  });
  return { action, noticeId };
}

module.exports = { NOTICE_REASON, handleNoticeRequest, seoulDay };
