"use strict";

/**
 * 회원 → 담당 강사 요청 (2026-11-28 대표: "비포애프터, 피드백 요청하기 버튼도 작게 만들어주고
 * 해당 강사에게 알림 가게 만들어줘").
 *
 * 보니따 홈의 [비포애프터 요청] · [피드백 요청] 이 부른다. 담당 강사(clients.instructorIds)의
 * 알림함(users/{uid}/inbox)에 한 건씩 만든다 -- 강사 앱의 "새 알림 N건" 띠에 그대로 선다.
 * 강사에게 할 일을 만들지 않는다: 알림 한 줄일 뿐이고, 응답은 강사가 원래 하던 길(비포애프터
 * 보내기 · 회원에게 한마디)이다.
 *
 * ── 하루 한 번 ──
 * 같은 회원 · 같은 종류는 서울 날짜로 하루 한 건 (memberRequests/{kind}_{clientId}_{YYYYMMDD},
 * create). 두 번째는 "duplicate" 로 돌려주고 회원 화면은 "오늘 이미 요청했어요" 라고 한다.
 * 누를 때마다 강사 알림이 쌓이면 강사가 알림함을 끈다.
 *
 * ── 이름 · 내용 없음 ──
 * 알림 문서에 회원 이름을 적지 않는다(강사 앱이 clientId 로 자기 명단에서 찾는다, 취소 알림과 같다).
 * 회원이 적는 글도 받지 않는다 -- 종류 하나만.
 */

const text = (value) => String(value ?? "").trim();

const MEMBER_REQUEST_KIND = Object.freeze({
  BEFORE_AFTER: "member_request_before_after",
  FEEDBACK: "member_request_feedback",
});

const COPY = Object.freeze({
  /* 2026-11-28 대표: "피드백 말고 오늘 수업 내용 요청하기 · 최근 비포애프터 요청하기". kind 값은 그대로 둔다. */
  [MEMBER_REQUEST_KIND.BEFORE_AFTER]: { title: "[최근 비포애프터 요청]", body: "회원이 최근 비포애프터를 받고 싶어 해요" },
  [MEMBER_REQUEST_KIND.FEEDBACK]: { title: "[오늘 수업 내용 요청]", body: "회원이 오늘 수업 내용을 받고 싶어 해요. 회원에게 한마디로 남겨 주세요" },
});

const MEMBER_REQUEST_REASON = Object.freeze({
  UNAUTHENTICATED: "member_request_unauthenticated",
  BAD_KIND: "member_request_bad_kind",
  NOT_LINKED: "member_request_not_linked",
  NO_INSTRUCTOR: "member_request_no_instructor",
});

const LINKED = ["linked", "multi_location"];
const MAX_INSTRUCTORS = 5;

const requestError = (httpsCode, reason) => Object.assign(new Error(reason), { httpsCode, reason });

const seoulStamp = (at) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
}).format(at).replace(/-/g, "");

const isAlreadyExists = (error) => error?.code === 6 || error?.code === "already-exists" || /already exists/i.test(String(error?.message || ""));

/**
 * @param {any} firestore Admin Firestore
 * @param {{ callerUid: string, organizationId: string, clientId: string, kind: string }} input
 * @param {{ now?: () => Date, stamp?: () => any }} deps
 * @returns {Promise<{ status: "sent" | "duplicate", instructors: number }>}
 */
async function sendMemberRequest(firestore, input, deps = {}) {
  const uid = text(input?.callerUid);
  const organizationId = text(input?.organizationId);
  const clientId = text(input?.clientId);
  const kind = text(input?.kind);
  if (!uid) throw requestError("unauthenticated", MEMBER_REQUEST_REASON.UNAUTHENTICATED);
  if (!COPY[kind] || !organizationId || !clientId) throw requestError("invalid-argument", MEMBER_REQUEST_REASON.BAD_KIND);

  /* 이 회원의 연결인가. 연결 문서와 회원 문서가 둘 다 이 사람을 가리켜야 한다. */
  const [linkSnapshot, clientSnapshot] = await Promise.all([
    firestore.collection("memberLinks").doc(uid).get(),
    firestore.collection("organizations").doc(organizationId).collection("clients").doc(clientId).get(),
  ]);
  const link = linkSnapshot.exists ? linkSnapshot.data() || {} : {};
  const linked = LINKED.includes(text(link.status)) && (Array.isArray(link.links) ? link.links : [])
    .some((entry) => text(entry?.organizationId) === organizationId && text(entry?.clientId) === clientId);
  const client = clientSnapshot.exists ? clientSnapshot.data() || {} : null;
  if (!linked || !client || text(client.userId) !== uid) throw requestError("permission-denied", MEMBER_REQUEST_REASON.NOT_LINKED);

  const instructors = [...new Set((Array.isArray(client.instructorIds) ? client.instructorIds : []).map(text).filter(Boolean))]
    .slice(0, MAX_INSTRUCTORS);
  if (!instructors.length) throw requestError("failed-precondition", MEMBER_REQUEST_REASON.NO_INSTRUCTOR);

  const now = (deps.now || (() => new Date()))();
  const stamp = deps.stamp || (() => now);
  const requestId = `${kind}_${clientId}_${seoulStamp(now)}`;
  const requestRef = firestore.collection("organizations").doc(organizationId).collection("memberRequests").doc(requestId);
  /* 요청 기록(create)과 알림을 한 배치로 -- 알림만 빠진 채 "오늘 이미" 가 남지 않는다. */
  const batch = firestore.batch();
  batch.create(requestRef, { organizationId, clientId, kind, instructorIds: instructors, createdAt: stamp() });
  for (const instructorUid of instructors) {
    batch.set(firestore.collection("users").doc(instructorUid).collection("inbox").doc(requestId), {
      kind, organizationId, clientId, recordId: requestId,
      title: COPY[kind].title, body: COPY[kind].body, createdAt: stamp(),
    });
  }
  try {
    await batch.commit();
  } catch (error) {
    if (isAlreadyExists(error)) return { status: "duplicate", instructors: instructors.length };
    throw error;
  }
  return { status: "sent", instructors: instructors.length };
}

module.exports = { MEMBER_REQUEST_KIND, MEMBER_REQUEST_REASON, sendMemberRequest, seoulStamp };
