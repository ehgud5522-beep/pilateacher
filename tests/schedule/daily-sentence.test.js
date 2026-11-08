import assert from "node:assert/strict";
import test from "node:test";
import {
  DAILY_SENTENCE_HIDE_KEY, SENTENCES, SENTENCE_KIND, WEEKDAY_KIND, dailySentence, dayKey, hideToday, isHiddenToday,
} from "../../src/features/schedule/daily-sentence.js";

/* 오늘의 한 문장 (2026-11-08). 요일마다 종류, 하루 동안 같은 문장, 한 종류를 다 쓸 때까지 겹치지 않는다. */

const at = (y, m, d, h = 9) => new Date(y, m - 1, d, h);

test("요일 → 종류: 월 자부심 · 화/목 회원 관리 · 수 전문성 · 금 성장 · 토/일 주말 격려", () => {
  assert.deepEqual(WEEKDAY_KIND, ["cheer", "pride", "care", "craft", "care", "growth", "cheer"]);
  assert.equal(dailySentence(at(2026, 11, 9)).kind, SENTENCE_KIND.PRIDE, "11/9 는 월요일");
  assert.equal(dailySentence(at(2026, 11, 8)).kind, SENTENCE_KIND.CHEER, "11/8 은 일요일");
});

test("같은 날은 몇 시에 열어도 같은 문장", () => {
  const morning = dailySentence(at(2026, 11, 10, 6));
  const night = dailySentence(at(2026, 11, 10, 23));
  assert.equal(morning.message, night.message);
  assert.equal(morning.day, "2026-11-10");
});

test("한 종류를 다 쓸 때까지 겹치지 않는다 — 화 · 목, 토 · 일도 같은 주에 다른 문장", () => {
  for (const [kind, weekdays] of [["pride", [1]], ["craft", [3]], ["growth", [5]], ["care", [2, 4]], ["cheer", [6, 0]]]) {
    const seen = new Set();
    const first = at(2026, 11, 9); // 월요일
    for (let day = 0; seen.size < SENTENCES[kind].length; day += 1) {
      const date = new Date(first.getFullYear(), first.getMonth(), first.getDate() + day, 9);
      if (!weekdays.includes(date.getDay())) continue;
      const picked = dailySentence(date);
      assert.equal(picked.kind, kind);
      assert.ok(!seen.has(picked.message), `${kind} 겹침: ${dayKey(date)}`);
      seen.add(picked.message);
    }
  }
});

test("문장 은행: 종류마다 12개 이상, 실천이 붙어 있고 이름 · 숫자 없이 짧다", () => {
  for (const [kind, list] of Object.entries(SENTENCES)) {
    assert.ok(list.length >= 12, kind);
    for (const item of list) {
      assert.ok(item.message && item.action, kind);
      assert.ok(item.message.length <= 60, `${kind} 길다: ${item.message}`);
    }
  }
  assert.equal(new Set(Object.values(SENTENCES).flat().map((item) => item.message)).size, Object.values(SENTENCES).flat().length, "같은 문장이 둘이면 안 된다");
});

test("오늘은 닫기: 그날만, 다음 날에는 다시", () => {
  const map = new Map();
  const storage = { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) };
  assert.equal(isHiddenToday(storage, at(2026, 11, 10)), false);
  hideToday(storage, at(2026, 11, 10));
  assert.equal(map.get(DAILY_SENTENCE_HIDE_KEY), "2026-11-10");
  assert.equal(isHiddenToday(storage, at(2026, 11, 10, 22)), true);
  assert.equal(isHiddenToday(storage, at(2026, 11, 11)), false);
  assert.equal(isHiddenToday(null), false, "저장소가 없어도 깨지지 않는다");
});

/* ── 열 때마다 바뀐다 (2026-11-08 대표 요청) ── */
import { LAST_SENTENCE_KEY, pickSentence, readLastSentence, rememberSentence } from "../../src/features/schedule/daily-sentence.js";

test("열 때마다 그날 종류 안에서 고르고, 직전 문장은 연달아 나오지 않는다", () => {
  const monday = at(2026, 11, 9);
  const list = SENTENCES[SENTENCE_KIND.PRIDE];
  for (const previous of list.map((item) => item.message)) {
    for (const roll of [0, 0.3, 0.5, 0.999999]) {
      const picked = pickSentence({ date: monday, previous, random: () => roll });
      assert.equal(picked.kind, SENTENCE_KIND.PRIDE, "요일 종류는 그대로");
      assert.notEqual(picked.message, previous, "직전과 같은 문장은 안 나온다");
      assert.ok(list.some((item) => item.message === picked.message));
    }
  }
  /* 처음 열 때(직전 없음)는 종류 전체에서. 이상한 random 값에도 깨지지 않는다. */
  assert.equal(pickSentence({ date: monday, random: () => 0 }).message, list[0].message);
  assert.equal(pickSentence({ date: monday, random: () => 1 }).message, list[list.length - 1].message);
  assert.equal(pickSentence({ date: monday, random: () => Number.NaN }).message, list[0].message);
});

test("여러 번 열면 여러 문장이 돈다 — 연달아 같은 것 없이", () => {
  let previous = "";
  const seen = new Set();
  let seed = 7;
  const random = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  for (let open = 0; open < 40; open += 1) {
    const picked = pickSentence({ date: at(2026, 11, 10), previous, random });
    assert.notEqual(picked.message, previous);
    seen.add(picked.message);
    previous = picked.message;
  }
  assert.ok(seen.size >= 5, `돈 문장 ${seen.size}개`);
});

test("직전 문장은 이 기기에 적어 둔다 — 저장소가 없거나 막혀도 깨지지 않는다", () => {
  const map = new Map();
  const storage = { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) };
  assert.equal(readLastSentence(storage), "");
  rememberSentence(storage, "문장 하나");
  assert.equal(map.get(LAST_SENTENCE_KEY), "문장 하나");
  assert.equal(readLastSentence(storage), "문장 하나");
  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.equal(readLastSentence(broken), "");
  rememberSentence(broken, "x");
  assert.equal(readLastSentence(null), "");
});
