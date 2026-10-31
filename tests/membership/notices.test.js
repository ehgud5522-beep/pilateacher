import assert from "node:assert/strict";
import test from "node:test";

import {
  confirmNotice, confirmedNoticeIds, manageNotice,
  noticeError, noticeInWindow, noticeTargets, pendingNotices, visibleNotices,
} from "../../src/data/repositories/notice-repository.js";
import { noticeContent } from "../../functions/shared/notices.mjs";

/**
 * 공지사항 (2026-10-31 개편).
 *
 * 하나. **확인한 것은 그 기기에서 다시 뜨지 않는다.** 확인은 기기에만 적는다 --
 * 서버에 읽음 기록이 없다.
 *
 * 둘. **빈 대상은 전체 강사다.** 빈 목록을 "아무도 아님" 으로 읽으면 공지를 쓰고
 * 아무에게도 안 보이는 일이 생긴다.
 *
 * 셋. **글자만.** 이미지 · 링크 칸은 받지 않는다. 중요 공지는 표시 종료일이 있어야 한다.
 */

const TODAY = "2026-10-11";
const notice = (overrides = {}) => ({ id: "n1", organizationId: "bonita", title: "휴무", body: "본문", status: "active", ...overrides });
const who = (overrides = {}) => ({ locationId: "bansong", title: "instructor", role: "instructor", ...overrides });
const memoryStorage = () => {
  const map = new Map();
  return { getItem: (key) => (map.has(key) ? map.get(key) : null), setItem: (key, value) => map.set(key, String(value)), map };
};

test("표시 종료일은 그날까지 — 지나면 팝업에도 목록에도 없다", () => {
  assert.equal(noticeInWindow(notice({ endsOn: TODAY }), TODAY), true);
  assert.equal(noticeInWindow(notice({ endsOn: "2026-10-10" }), TODAY), false);
  assert.equal(noticeInWindow(notice(), TODAY), true, "종료일 없는 보통 공지");
  assert.equal(noticeInWindow(notice({ status: "ended" }), TODAY), false, "옛 공지의 종료 표시");
  assert.deepEqual(visibleNotices({ notices: [notice({ endsOn: "2026-10-10" })], today: TODAY, who: who() }), []);
});

test("대상 — 비우면 전체 강사, 지점을 고르면 그 지점(맡은 지점 여럿도)만", () => {
  assert.equal(noticeTargets(notice(), who()), true);
  assert.equal(noticeTargets(notice({ locationIds: ["bansong"] }), who()), true);
  assert.equal(noticeTargets(notice({ locationIds: ["haeundae"] }), who()), false);
  assert.equal(noticeTargets(notice({ locationIds: ["haeundae"] }), who({ locationId: "", locationIds: ["bansong", "haeundae"] })), true);
});

test("팝업 — 최신 먼저, 이 기기에서 확인한 것은 빠진다", () => {
  const notices = [
    notice({ id: "old", createdAt: new Date("2026-10-01T00:00:00Z"), important: true }),
    notice({ id: "new", createdAt: new Date("2026-10-10T00:00:00Z") }),
    notice({ id: "mid", createdAt: { seconds: Date.parse("2026-10-05T00:00:00Z") / 1000 } }),
  ];
  assert.deepEqual(pendingNotices({ notices, confirmedIds: [], today: TODAY, who: who() }).map((item) => item.id), ["new", "mid", "old"]);
  assert.deepEqual(pendingNotices({ notices, confirmedIds: new Set(["new"]), today: TODAY, who: who() }).map((item) => item.id), ["mid", "old"]);
  assert.deepEqual(visibleNotices({ notices, today: TODAY, who: who() }).map((item) => item.id), ["new", "mid", "old"], "목록에는 확인한 것도 있다");
});

test("확인은 그 기기에, 계정마다 따로 — 저장소를 못 써도 멈추지 않는다", () => {
  const storage = memoryStorage();
  assert.deepEqual([...confirmedNoticeIds(storage, "uid-a")], []);
  confirmNotice(storage, "uid-a", "n1");
  confirmNotice(storage, "uid-a", "n1");
  assert.deepEqual([...confirmedNoticeIds(storage, "uid-a")], ["n1"], "두 번 눌러도 한 번");
  assert.deepEqual([...confirmedNoticeIds(storage, "uid-b")], [], "다른 계정은 따로");
  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.deepEqual([...confirmedNoticeIds(broken, "uid-a")], []);
  assert.deepEqual([...confirmNotice(broken, "uid-a", "n1")], ["n1"]);
});

test("글 검사 — 중요 공지는 표시 종료일 필수, 지난 종료일 거절", () => {
  assert.equal(noticeError({ title: "", body: "x" }), "제목을 입력해 주세요.");
  assert.equal(noticeError({ title: "x", body: "" }), "내용을 입력해 주세요.");
  assert.equal(noticeError({ title: "x", body: "y", important: true }), "중요 공지는 표시 종료일을 정해 주세요.");
  assert.equal(noticeError({ title: "x", body: "y", important: true, endsOn: TODAY }, { today: TODAY }), "");
  assert.equal(noticeError({ title: "x", body: "y", endsOn: "2026-10-10" }, { today: TODAY }), "표시 종료일이 이미 지났습니다.");
  assert.equal(noticeError({ title: "x", body: "y", endsOn: "10/20" }), "표시 종료일을 확인해 주세요.");
});

test("서버에 둘 칸 — 이미지 · 링크 · 직급 · 역할은 와도 버린다", () => {
  const content = noticeContent({
    title: " 휴무 ", body: "본문 https://example.com", important: true, endsOn: "2026-10-20",
    locationIds: ["bansong", "bansong"], imageUrl: "https://x/a.png", linkUrl: "javascript:alert(1)", titles: ["team_lead"], roles: ["instructor"],
  });
  assert.deepEqual(content, { title: "휴무", body: "본문 https://example.com", important: true, locationIds: ["bansong"], endsOn: "2026-10-20" });
});

test("쓰기는 서버 함수로 — 화면이 먼저 거르고, 지우기는 내용 없이", async () => {
  const calls = [];
  const call = async (payload) => { calls.push(payload); return { noticeId: "n-1" }; };
  await manageNotice({ organizationId: "bonita", action: "create", value: { title: "휴무", body: "본문" }, today: TODAY }, { call });
  await manageNotice({ organizationId: "bonita", action: "delete", noticeId: "n-1" }, { call });
  assert.deepEqual(calls, [
    { organizationId: "bonita", action: "create", value: { title: "휴무", body: "본문" } },
    { organizationId: "bonita", action: "delete", noticeId: "n-1" },
  ]);
  await assert.rejects(
    manageNotice({ organizationId: "bonita", action: "create", value: { title: "휴무", body: "본문", important: true } }, { call }),
    (error) => error.reason === "notice_invalid" && /표시 종료일/.test(error.message),
  );
  assert.equal(calls.length, 2, "거른 글은 서버로 가지 않는다");
});
