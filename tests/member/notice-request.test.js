import assert from "node:assert/strict";
import test from "node:test";
import {
  MEMBER_NOTICE_IMAGE_MAX, memberNoticeError, memberNoticeLive, memberNoticeSnoozed, snoozeMemberNotice,
} from "../../functions/shared/member-notice.mjs";
import { requestDone, requestFailure } from "../../member/src/request-copy.js";
import { passTitle, lessonName } from "../../member/src/pass-label.js";
import { CACHED_HISTORY_FIELDS, CACHED_PASS_FIELDS } from "../../member/src/offline-cache.js";

/* 2026-11-28 대표 요청: 공지 팝업 · 선생님께 요청 · 디오사 A/B. */

const memory = () => {
  const box = new Map();
  return { getItem: (key) => box.get(key) ?? null, setItem: (key, value) => box.set(key, String(value)) };
};
const NOW = new Date("2026-11-28T03:00:00Z"); // 서울 11-28 12:00

test("공지는 켜져 있고, 비어 있지 않고, 종료일 당일까지만 뜬다", () => {
  assert.equal(memberNoticeLive({ active: true, title: "공지" }, NOW), true);
  assert.equal(memberNoticeLive({ active: false, title: "공지" }, NOW), false);
  assert.equal(memberNoticeLive({ active: true, title: "", image: "" }, NOW), false);
  assert.equal(memberNoticeLive({ active: true, title: "공지", endsOn: "2026-11-28" }, NOW), true, "종료일 당일은 뜬다");
  assert.equal(memberNoticeLive({ active: true, title: "공지", endsOn: "2026-11-27" }, NOW), false);
  assert.equal(memberNoticeLive(null, NOW), false);
});

test("일주일 동안 안 보기: 7일 동안 안 뜨고, 대표가 글을 고치면 다시 뜬다", () => {
  const storage = memory();
  const notice = { active: true, title: "공지", updatedAt: new Date("2026-11-27T00:00:00Z") };
  assert.equal(memberNoticeSnoozed(storage, "u_c", notice, NOW), false);
  assert.equal(snoozeMemberNotice(storage, "u_c", notice, NOW), true);
  assert.equal(memberNoticeSnoozed(storage, "u_c", notice, new Date(NOW.getTime() + 6 * 86400000)), true);
  assert.equal(memberNoticeSnoozed(storage, "u_c", notice, new Date(NOW.getTime() + 7 * 86400000 + 1)), false, "일주일 뒤 다시");
  const edited = { ...notice, updatedAt: new Date("2026-11-29T00:00:00Z") };
  assert.equal(memberNoticeSnoozed(storage, "u_c", edited, NOW), false, "고친 글은 다시 뜬다");
  assert.equal(memberNoticeSnoozed(storage, "other", notice, NOW), false, "다른 계정 · 센터는 따로");
});

test("저장소가 막혀도 던지지 않는다 -- 공지가 다시 뜰 뿐", () => {
  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.equal(memberNoticeSnoozed(broken, "u", { updatedAt: NOW }, NOW), false);
  assert.equal(snoozeMemberNotice(broken, "u", { updatedAt: NOW }, NOW), false);
});

test("저장 전 판정은 코드 하나씩", () => {
  assert.equal(memberNoticeError({ title: "공지" }), "");
  assert.equal(memberNoticeError({ image: "data:image/jpeg;base64,AAAA" }), "", "이미지만 있어도 된다");
  assert.equal(memberNoticeError({}), "member_notice_empty");
  assert.equal(memberNoticeError({ title: "가".repeat(61) }), "member_notice_title_too_long");
  assert.equal(memberNoticeError({ title: "a", body: "가".repeat(1001) }), "member_notice_body_too_long");
  assert.equal(memberNoticeError({ title: "a", image: "https://x/y.jpg" }), "member_notice_image_type");
  assert.equal(memberNoticeError({ title: "a", image: `data:image/jpeg;base64,${"A".repeat(MEMBER_NOTICE_IMAGE_MAX)}` }), "member_notice_image_too_large");
  assert.equal(memberNoticeError({ title: "a", endsOn: "12/25" }), "member_notice_ends_on");
});

test("요청 결과: 보냄 · 오늘 이미", () => {
  assert.equal(requestDone({ status: "sent" }).kind, "sent");
  assert.equal(requestDone({ status: "duplicate" }).kind, "duplicate");
  assert.match(requestDone({ status: "duplicate" }).message, /오늘 이미/);
});

test("요청 실패는 종류별로 나뉘고 원본 코드를 함께 말한다", () => {
  const cases = [
    [{ code: "functions/unavailable" }, "network", /연결이 불안정/],
    [{ code: "functions/unauthenticated" }, "authentication", /다시 로그인/],
    [{ code: "functions/permission-denied", details: { reason: "member_request_not_linked" } }, "permission", /요청할 수 없어요/],
    [{ code: "functions/failed-precondition", details: { reason: "member_request_no_instructor" } }, "data_conflict", /담당 선생님/],
    [{ code: "functions/invalid-argument", details: { reason: "member_request_bad_kind" } }, "invalid_request", /처리하지 못했어요/],
    [{}, "unknown", /코드 unknown/],
  ];
  for (const [error, kind, pattern] of cases) {
    const view = requestFailure(error);
    assert.equal(view.kind, kind, JSON.stringify(error));
    assert.match(view.message, pattern);
    assert.ok(view.message.includes(`(코드 ${view.code})`), view.message);
  }
});

test("디오사 이름은 등급을 알면 길이를 붙이고, 모르면 지어내지 않는다", () => {
  assert.equal(passTitle({ lessonType: "diosa", diosaGrade: "a", totalSessions: 4 }), "디오사 프로그램 30분 4회");
  assert.equal(passTitle({ lessonType: "diosa", diosaGrade: "b", totalSessions: 4 }), "디오사 프로그램 50분 4회");
  assert.equal(lessonName({ lessonType: "diosa" }), "디오사 프로그램");
  assert.equal(lessonName({ lessonType: "1:1", diosaGrade: "a" }), "1:1 필라테스 수업");
});

test("오프라인 사본도 디오사 등급을 간직한다", () => {
  assert.ok(CACHED_PASS_FIELDS.includes("diosaGrade"));
  assert.ok(CACHED_HISTORY_FIELDS.includes("diosaGrade"));
});
