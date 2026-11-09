import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import {
  RATING_COPY, RATING_ITEMS, RATING_ITEM_IDS, RATING_REASON, RATING_WINDOW_DAYS, addToStats, averageOf,
  decideLessonRating, lessonRatingEnabledFor, pickRatingCandidate, ratingDocId, readLessonRatingConfig,
  summarizeStats, validateScores,
} from "../../functions/shared/lesson-rating.mjs";
import {
  RATING_FAILURE_KIND, RATING_SEEN_KEY, addRatingSeen, ratingFailure, readRatingSeen,
} from "../../member/src/rating-copy.js";

/* 수업 후 별점 평가 (2026-11-09). 항목 · 판정 · 실패 분류 · 카드 화면. 서버 이유 코드 → 종류 →
   문구가 한 줄로 이어지는지 고정한다 (CLAUDE.md §8). */

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-11-10T03:00:00Z");
const callableError = (code, reason) => Object.assign(new Error(code), { code: `functions/${code}`, details: reason ? { reason } : undefined });
const memoryStorage = () => {
  const box = new Map();
  return { getItem: (key) => (box.has(key) ? box.get(key) : null), setItem: (key, value) => box.set(key, String(value)), box };
};

test("항목은 한 곳에서 -- id 가 겹치지 않고, 문구 · 양 끝 설명이 다 있다. 첫 항목은 대표가 보낸 화면 그대로", () => {
  assert.equal(new Set(RATING_ITEM_IDS).size, RATING_ITEMS.length);
  for (const item of RATING_ITEMS) {
    assert.ok(item.id && item.question && item.low && item.high, item.id);
    assert.match(item.id, /^[a-z_]+$/, "id 는 저장 열쇠 -- 영문 소문자만");
  }
  assert.deepEqual(RATING_ITEMS[0], { id: "body", question: "오늘 수업 후 몸 상태는 어떠세요?", low: "매우 불편함", high: "매우 좋음" });
  assert.match(RATING_COPY.PRIVACY, /강사님에게는 공개되지 않아요/);
  assert.equal(RATING_COPY.TITLE, "오늘 수업은 어떠셨나요?");
});

test("회원 앱 · 강사 앱 어디에도 항목 문구를 따로 적지 않는다 (한 곳에서만)", () => {
  for (const file of ["../../member/src/lesson-rating.jsx", "../../member/src/App.jsx", "../../src/App.jsx", "../../functions/src/lesson-rating.js"]) {
    const source = readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
    for (const item of RATING_ITEMS) assert.doesNotMatch(source, new RegExp(item.question.replace(/[?]/g, "\\?")), `${file} 에 "${item.question}"`);
  }
});

test("스위치: 없거나 모르는 값이면 꺼짐, listed 는 고른 강사만, all 은 전부", () => {
  assert.deepEqual(readLessonRatingConfig(undefined), { mode: "off", userIds: [] });
  assert.deepEqual(readLessonRatingConfig({ mode: "weird", userIds: ["t1"] }).mode, "off");
  assert.equal(lessonRatingEnabledFor({}, "t1"), false);
  assert.equal(lessonRatingEnabledFor({ memberRating: { mode: "listed", userIds: ["t1"] } }, "t1"), true);
  assert.equal(lessonRatingEnabledFor({ memberRating: { mode: "listed", userIds: ["t1"] } }, "t2"), false);
  assert.equal(lessonRatingEnabledFor({ memberRating: { mode: "listed", userIds: ["t1"] } }, ""), false);
  assert.equal(lessonRatingEnabledFor({ memberRating: { mode: "all" } }, "t9"), true);
  /* 다른 스위치가 켜져 있어도 별점은 따로다. */
  assert.equal(lessonRatingEnabledFor({ mode: "all", memberCancel: { mode: "all", limit: 3, period: "month" } }, "t1"), false);
});

test("판정: 이미 보냄이 꺼짐보다 앞 -- 보낸 뒤 꺼도 두 번째 클릭은 성공으로 끝난다", () => {
  const lesson = { status: "completed", clientIds: ["c1"], instructorId: "t1", startsAt: new Date(NOW.getTime() - DAY) };
  assert.equal(decideLessonRating({ now: NOW, lesson, clientId: "c1", scheduleSyncDoc: {}, existing: true }).reason, RATING_REASON.ALREADY);
  assert.equal(decideLessonRating({ now: NOW, lesson, clientId: "c1", scheduleSyncDoc: {} }).reason, RATING_REASON.FEATURE_OFF);
  const on = { memberRating: { mode: "all" } };
  assert.equal(decideLessonRating({ now: NOW, lesson, clientId: "c1", scheduleSyncDoc: on }).ok, true);
  assert.equal(decideLessonRating({ now: NOW, lesson: { ...lesson, clientIds: [], clientId: "c1" }, clientId: "c1", scheduleSyncDoc: on }).ok, true, "옛 문서의 clientId 하나");
  assert.equal(decideLessonRating({ now: NOW, lesson: { ...lesson, startsAt: new Date(NOW.getTime() - (RATING_WINDOW_DAYS * DAY + 1)) }, clientId: "c1", scheduleSyncDoc: on }).reason, RATING_REASON.EXPIRED);
});

test("점수: 모든 항목에 1~5 정수", () => {
  const full = Object.fromEntries(RATING_ITEM_IDS.map((id) => [id, 5]));
  assert.deepEqual(validateScores(full), { ok: true, scores: full });
  assert.equal(validateScores({ ...full, [RATING_ITEM_IDS[0]]: "5" }).ok, true, "숫자 문자열은 숫자로 받는다");
  assert.equal(validateScores({ ...full, nope: 1 }).field, "nope");
  assert.equal(validateScores({ [RATING_ITEM_IDS[0]]: 3 }).ok, false);
});

test("집계: 항목마다 합계 · 건수, 평균은 소수 첫째 자리, 응답 많은 강사부터 -- 회원 정보 없음", () => {
  let stats = addToStats(null, { body: 5, care: 4, again: 4 });
  stats = addToStats(stats, { body: 4, care: 4, again: 3 });
  stats = addToStats(stats, { body: 4, care: 5, again: 3 });
  assert.deepEqual(stats.items.body, { sum: 13, count: 3 });
  assert.equal(averageOf(stats.items.body), 4.3);
  assert.equal(averageOf({ sum: 0, count: 0 }), null);
  const rows = summarizeStats([
    { instructorId: "t1", ...addToStats(null, { body: 5, care: 5, again: 5 }) },
    { instructorId: "t2", ...stats },
    { instructorId: "t3", count: 0, items: {} },
  ], (id) => ({ t1: "가", t2: "나" })[id]);
  assert.deepEqual(rows.map((row) => [row.instructorName, row.count]), [["나", 3], ["가", 1]], "응답 없는 강사는 빠진다");
  assert.deepEqual(Object.keys(rows[0]).sort(), ["count", "instructorId", "instructorName", "items"]);
});

test("평가 문서 id 는 수업 + 회원 -- 한 회원이 한 수업에 한 번. 경로 문자는 거절", () => {
  assert.equal(ratingDocId("L1", "c1"), "L1_c1");
  assert.equal(ratingDocId("L1", ""), "");
  assert.equal(ratingDocId("a/b", "c1"), "");
});

test("물을 수업: 기간 안 가장 최근 출석(차감) 중 아직 안 물은 것 -- 정정 · 이관 · 수업 id 없는 옛 기록은 빼고", () => {
  const history = [
    { type: "correction", lessonId: "", occurredAt: new Date(NOW.getTime() - 1000) },
    { type: "deduct", lessonId: "", occurredAt: new Date(NOW.getTime() - 2000) },
    { type: "deduct", lessonId: "L2", occurredAt: new Date(NOW.getTime() - DAY) },
    { type: "deduct", lessonId: "L1", occurredAt: new Date(NOW.getTime() - 2 * DAY) },
    { type: "deduct", lessonId: "L0", occurredAt: new Date(NOW.getTime() - 4 * DAY) },
  ];
  assert.equal(pickRatingCandidate(history, { now: NOW })?.lessonId, "L2");
  assert.equal(pickRatingCandidate(history, { now: NOW, skip: new Set(["L2"]) })?.lessonId, "L1");
  assert.equal(pickRatingCandidate(history, { now: NOW, skip: ["L2", "L1"] }), null, "4일 전은 묻지 않는다");
  assert.equal(pickRatingCandidate(undefined, { now: NOW }), null);
});

test("실패 분류: 받지 않는 수업은 오류가 아니다(카드를 접는다), 연결은 다시 시도, 모르는 것은 코드와 함께", () => {
  const rows = [
    [callableError("failed-precondition", "feature_off"), RATING_FAILURE_KIND.CLOSED, true, false, /^$/],
    [callableError("failed-precondition", "rating_expired"), RATING_FAILURE_KIND.CLOSED, true, false, /^$/],
    [callableError("failed-precondition", "lesson_cancelled"), RATING_FAILURE_KIND.CLOSED, true, false, /^$/],
    [callableError("failed-precondition", "lesson_not_attended"), RATING_FAILURE_KIND.CLOSED, true, false, /^$/],
    [callableError("permission-denied", "not_own_lesson"), RATING_FAILURE_KIND.PERMISSION, true, false, /^$/],
    [callableError("invalid-argument", "scores_invalid"), RATING_FAILURE_KIND.INVALID, false, false, /별.*코드 scores_invalid/],
    [callableError("unavailable"), RATING_FAILURE_KIND.NETWORK, false, true, /연결.*코드 unavailable/],
    [callableError("deadline-exceeded"), RATING_FAILURE_KIND.NETWORK, false, true, /코드 deadline-exceeded/],
    [callableError("unavailable", "lesson_rating_failed"), RATING_FAILURE_KIND.UNAVAILABLE, false, true, /코드 lesson_rating_failed/],
    [callableError("unauthenticated"), RATING_FAILURE_KIND.AUTH, false, false, /로그인/],
    [callableError("internal"), RATING_FAILURE_KIND.UNKNOWN, false, false, /처리하지 못했어요 \(코드 internal\)/],
    [new Error("boom"), RATING_FAILURE_KIND.UNKNOWN, false, false, /코드 unknown/],
  ];
  for (const [error, kind, hide, retry, message] of rows) {
    const view = ratingFailure(error);
    assert.equal(view.kind, kind, error.message);
    assert.equal(view.hide, hide, `${error.message} hide`);
    assert.equal(view.retry, retry, `${error.message} retry`);
    assert.match(view.message, message, error.message);
    /* §8: 화면이 "연결" 이라고 말하면 코드도 연결이어야 한다. */
    if (/연결/.test(view.message)) assert.match(view.code, /unavailable|deadline-exceeded/);
  }
});

test("이 기기에서 물은 수업: 수업 id 만, 최근 것이 앞, 칸이 막혀도 화면은 돈다", () => {
  const storage = memoryStorage();
  addRatingSeen(storage, "L1");
  assert.deepEqual(addRatingSeen(storage, "L2"), ["L2", "L1"]);
  assert.deepEqual(addRatingSeen(storage, "L1"), ["L1", "L2"], "겹치지 않는다");
  assert.deepEqual(readRatingSeen(storage), ["L1", "L2"]);
  assert.ok(RATING_SEEN_KEY.startsWith("pilateacher.member."), "로그아웃 · 계정 삭제 때 접두사로 함께 지워진다");
  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.deepEqual(readRatingSeen(broken), []);
  assert.deepEqual(addRatingSeen(broken, "L3"), ["L3"]);
  assert.deepEqual(readRatingSeen(null), []);
  storage.box.set(RATING_SEEN_KEY, "not json");
  assert.deepEqual(readRatingSeen(storage), []);
});

test("카드 화면: 안내 한 줄 · 항목마다 별 5개 · 다 고르기 전엔 보내기 꺼짐 · 고마워요", async (t) => {
  const vite = await createServer({
    root: fileURLToPath(new URL("../../", import.meta.url)),
    configFile: false, plugins: [react()], appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true }, logLevel: "silent",
  });
  t.after(() => vite.close());
  const { LessonRatingCard } = await vite.ssrLoadModule("/member/src/lesson-rating.jsx");
  const base = { lesson: { lessonId: "L1" }, place: { organizationId: "o", clientId: "c" }, api: async () => ({}), onSeen: () => {} };
  const render = (props) => renderToStaticMarkup(createElement(LessonRatingCard, { ...base, ...props }));

  assert.equal(render({}), "", "서버에 묻기 전(loading)에는 아무것도 그리지 않는다 -- 꺼져 있으면 회원은 모른다");
  const fresh = render({ initialPhase: "ready" });
  assert.match(fresh, /오늘 수업은 어떠셨나요\?/);
  assert.match(fresh, /BONITA VIP · 수업 완료/);
  assert.match(fresh, /10초/);
  assert.match(fresh, /강사님에게는 공개되지 않아요/);
  assert.match(fresh, /① 오늘 수업 후 몸 상태는 어떠세요\?/);
  assert.match(fresh, /1 = 매우 불편함 · 5 = 매우 좋음/);
  assert.equal((fresh.match(/role="radio"/g) || []).length, RATING_ITEMS.length * 5);
  assert.match(fresh, /<button type="button" class="btn primary mt" disabled="">보내기<\/button>/, "다 고르기 전엔 보내기 꺼짐");
  assert.match(fresh, /다음에 할게요/);

  const picked = render({ initialPhase: "ready", initialScores: Object.fromEntries(RATING_ITEM_IDS.map((id) => [id, 4])) });
  assert.match(picked, /<button type="button" class="btn primary mt">보내기<\/button>/);
  assert.equal((picked.match(/aria-checked="true"/g) || []).length, RATING_ITEMS.length);

  const done = render({ initialPhase: "done" });
  assert.match(done, /소중한 의견 고마워요/);
  assert.doesNotMatch(done, /role="radio"/);
});
