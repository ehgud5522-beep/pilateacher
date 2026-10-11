import assert from "node:assert/strict";
import test from "node:test";

import {
  NOTICE_STATUS, createNotice, endNotice, markNoticeRead,
  noticeError, noticeInWindow, noticeReadId, noticeReadSummary, noticeTargets, pendingNotices,
} from "../../src/data/repositories/notice-repository.js";

/**
 * 공지사항.
 *
 * 이 파일이 지키는 것은 셋이다.
 *
 * 하나. **본 것은 다시 뜨지 않는다.** 매번 뜨는 창은 곧 X 를 누르는 손버릇이
 * 되고, 그때부터는 중요한 공지도 안 읽힌다.
 *
 * 둘. **빈 조건은 전체다.** 빈 목록을 "아무도 아님" 으로 읽으면 공지를 쓰고
 * 아무에게도 안 보이는 일이 생기고, 쓴 사람은 그것을 알 길이 없다.
 *
 * 셋. **지우지 않는다.** 읽음 기록이 가리킬 글이 사라지면 "읽음 N명" 이
 * 무엇의 N 인지 알 수 없다.
 */

const TODAY = "2026-10-11";

const notice = (overrides = {}) => ({
  id: "n1", organizationId: "bonita", title: "휴무", body: "본문",
  status: NOTICE_STATUS.ACTIVE, ...overrides,
});
const who = (overrides = {}) => ({
  locationId: "bansong", title: "instructor", role: "instructor", ...overrides,
});

/* ── 기간 ────────────────────────────────────────────────────────────────── */

test("a notice with no dates runs until it is ended", () => {
  assert.equal(noticeInWindow(notice(), TODAY), true);
  assert.equal(noticeInWindow(notice({ status: NOTICE_STATUS.ENDED }), TODAY), false);
});

test("the end day is included, because that is what people mean", () => {
  /* 사람이 "10일까지" 라고 쓸 때 10일을 빼고 생각하지 않는다. */
  assert.equal(noticeInWindow(notice({ endsOn: TODAY }), TODAY), true);
  assert.equal(noticeInWindow(notice({ endsOn: "2026-10-10" }), TODAY), false);
  assert.equal(noticeInWindow(notice({ startsOn: TODAY }), TODAY), true);
  assert.equal(noticeInWindow(notice({ startsOn: "2026-10-12" }), TODAY), false);
});

test("dates are calendar days, never absolute moments", () => {
  /* 절대 순간으로 비교하면 UTC 기기에서 하루 어긋나고, "오늘부터" 라고 쓴
     공지가 어제 뜨거나 내일 뜬다. */
  assert.equal(noticeInWindow(notice({ startsOn: "2026-10-11T00:00:00Z" }), TODAY), true,
    "읽을 수 없는 값은 조건이 없는 것으로 둔다 -- 안 뜨는 것보다 뜨는 것이 낫다");
  assert.equal(noticeInWindow(notice(), ""), false, "오늘을 모르면 띄우지 않는다");
});

/* ── 대상 ────────────────────────────────────────────────────────────────── */

test("an empty target list means everyone", () => {
  /* "아무도 아님" 으로 읽으면 공지를 쓰고 아무에게도 안 보이는 일이 생긴다. */
  assert.equal(noticeTargets(notice(), who()), true);
  assert.equal(noticeTargets(notice({ locationIds: [], titles: [], roles: [] }), who()), true);
});

test("several conditions all have to hold", () => {
  /* 반송점 ∩ 점장처럼 좁히는 것이 실제 쓰임이다. 합집합이면 "반송점 전체" 가
     되어 쓴 사람이 놀란다. */
  const narrow = notice({ locationIds: ["bansong"], titles: ["branch_manager"] });
  assert.equal(noticeTargets(narrow, who({ title: "branch_manager" })), true);
  assert.equal(noticeTargets(narrow, who({ title: "instructor" })), false);
  assert.equal(noticeTargets(narrow, who({ locationId: "centum", title: "branch_manager" })), false);
});

test("a role target keeps a notice off the people it is not for", () => {
  const forManagers = notice({ roles: ["manager"] });
  assert.equal(noticeTargets(forManagers, who({ role: "manager" })), true);
  assert.equal(noticeTargets(forManagers, who({ role: "instructor" })), false);
});

/* ── 띄우는 순서 ─────────────────────────────────────────────────────────── */

test("what was read does not come back", () => {
  /* 매번 뜨는 창은 곧 X 를 누르는 손버릇이 되고, 그때부터는 중요한 공지도
     안 읽힌다. */
  const found = pendingNotices({
    notices: [notice({ id: "n1" }), notice({ id: "n2" })],
    readIds: ["n1"], today: TODAY, who: who(),
  });
  assert.deepEqual(found.map((item) => item.id), ["n2"]);
});

test("important comes first, then the newest", () => {
  /* 하나씩 띄우므로 순서가 곧 "무엇을 먼저 보는가" 다. 중요한 것을 뒤에 두면
     앞의 셋을 넘기다 손버릇으로 같이 넘긴다. */
  const found = pendingNotices({
    notices: [
      notice({ id: "old", startsOn: "2026-10-01" }),
      notice({ id: "new", startsOn: "2026-10-10" }),
      notice({ id: "urgent", startsOn: "2026-10-02", important: true }),
    ],
    today: TODAY, who: who(),
  });
  assert.deepEqual(found.map((item) => item.id), ["urgent", "new", "old"]);
});

test("a notice outside its window or off target never queues", () => {
  const found = pendingNotices({
    notices: [
      notice({ id: "over", endsOn: "2026-10-01" }),
      notice({ id: "elsewhere", locationIds: ["centum"] }),
      notice({ id: "ended", status: NOTICE_STATUS.ENDED }),
      notice({ id: "mine" }),
    ],
    today: TODAY, who: who(),
  });
  assert.deepEqual(found.map((item) => item.id), ["mine"]);
});

/* ── 쓰는 글 ─────────────────────────────────────────────────────────────── */

test("an empty title or body is not a notice", () => {
  assert.match(noticeError({ title: "", body: "본문" }), /제목/);
  assert.match(noticeError({ title: "제목", body: "  " }), /내용/);
  assert.equal(noticeError({ title: "제목", body: "본문" }), "");
});

test("a link that is not http is refused before it reaches anyone", () => {
  /* javascript: 가 들어오면 누르는 사람의 앱 안에서 돈다. 쓰는 사람이
     대표라도 그 문을 열어 둘 이유가 없다. */
  for (const bad of ["javascript:alert(1)", "data:text/html,x", "/etc/passwd"]) {
    assert.match(noticeError({ title: "t", body: "b", linkUrl: bad }), /링크/, bad);
  }
  assert.equal(noticeError({ title: "t", body: "b", linkUrl: "https://example.com" }), "");
});

test("an end before its start is caught where the person can still fix it", () => {
  assert.match(
    noticeError({ title: "t", body: "b", startsOn: "2026-10-20", endsOn: "2026-10-10" }),
    /종료일이 시작일보다 빠릅니다/,
  );
});

/* ── 저장 ────────────────────────────────────────────────────────────────── */

const fakeStore = () => {
  const writes = [];
  return {
    writes,
    list: async () => [],
    commit: async (items) => { writes.push(...items); },
    serverTimestamp: async () => "SERVER_TIME",
    newId: () => "n-new",
  };
};

test("a new notice carries who wrote it and when", async () => {
  const store = fakeStore();
  await createNotice("bonita", {
    title: "휴무", body: "본문", createdBy: "owner-uid", important: true,
    locationIds: ["bansong"], linkUrl: "https://example.com",
  }, { store });

  const [write] = store.writes;
  assert.equal(write.path, "organizations/bonita/notices/n-new");
  assert.equal(write.data.createdBy, "owner-uid");
  assert.equal(write.data.createdAt, "SERVER_TIME");
  assert.equal(write.data.status, NOTICE_STATUS.ACTIVE);
  assert.equal(write.data.important, true);
  assert.deepEqual(write.data.locationIds, ["bansong"]);
});

test("empty optional fields are left out, not sent blank", async () => {
  /* 규칙이 모양을 따지는 칸들이라, 빈 문자열은 "없음" 이 아니라 "잘못된 값"
     이 되어 공지 전체가 거부된다. */
  const store = fakeStore();
  await createNotice("bonita", {
    title: "휴무", body: "본문", createdBy: "owner-uid",
    imageUrl: "", linkUrl: "  ", startsOn: "", locationIds: [], titles: [],
  }, { store });

  const { data } = store.writes[0];
  for (const key of ["imageUrl", "linkUrl", "startsOn", "endsOn", "locationIds", "titles", "roles"]) {
    assert.equal(key in data, false, key);
  }
});

test("a malformed notice is refused here, not at the rules", async () => {
  /* 규칙이 거부하면 화면에는 permission-denied 한 줄로만 돌아오고, 무엇이
     잘못됐는지 알 수 없다. */
  const store = fakeStore();
  await assert.rejects(() => createNotice("bonita", {
    title: "", body: "본문", createdBy: "owner-uid",
  }, { store }));
  assert.equal(store.writes.length, 0);
});

test("ending a notice moves the status and nothing else", async () => {
  /* 지우면 읽음 기록이 가리킬 글이 사라지고, "읽음 N명" 이 무엇의 N 인지
     알 수 없다. */
  const store = fakeStore();
  await endNotice("bonita", "n1", { updatedBy: "owner-uid" }, { store });
  const [write] = store.writes;
  assert.equal(write.operation, "update");
  assert.deepEqual(write.data, {
    status: NOTICE_STATUS.ENDED, updatedAt: "SERVER_TIME", updatedBy: "owner-uid",
  });
});

test("a read is one document per person, however many times they press", async () => {
  // 두 건이 되면 "읽음 N명" 이 사람 수가 아니게 된다.
  const store = fakeStore();
  await markNoticeRead("bonita", "n1", { userId: "u1" }, { store });
  await markNoticeRead("bonita", "n1", { userId: "u1" }, { store });
  assert.equal(store.writes[0].path, store.writes[1].path);
  assert.equal(noticeReadId("n1", "u1"), "n1_u1");
});

/* ── 읽음 집계 ───────────────────────────────────────────────────────────── */

const member = (overrides = {}) => ({
  userId: "u1", status: "active", locationId: "bansong", title: "instructor",
  role: "instructor", displayName: "정예진", ...overrides,
});

test("the owner sees who has not read it, counted against the real audience", () => {
  /* 전체가 센터 전원이면 지점 공지의 "3/20" 이 영영 안 찬다. 대상인 사람만
     분모다. */
  const found = noticeReadSummary({
    notice: notice({ locationIds: ["bansong"] }),
    audience: [
      member({ userId: "u1" }),
      member({ userId: "u2" }),
      member({ userId: "u3", locationId: "centum" }),
      member({ userId: "u4", status: "revoked" }),
    ],
    reads: [{ userId: "u1" }],
  });
  assert.equal(found.total, 2, "반송점의 재직자 둘");
  assert.equal(found.read, 1);
  assert.deepEqual(found.unread.map((item) => item.userId), ["u2"]);
});

test("nobody who left is counted as not having read", () => {
  /* 퇴사자가 분모에 남으면 "읽음 N/전체" 가 영영 안 차고, 대표는 끝난 공지를
     계속 들여다본다. */
  const found = noticeReadSummary({
    notice: notice(),
    audience: [member({ userId: "u1", status: "revoked" })],
    reads: [],
  });
  assert.equal(found.total, 0);
  assert.deepEqual(found.unread, []);
});
