import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/* 2026-11-28 대표: "전체적으로 로딩 동그라미 느낌으로 -- 기다려야 하는 것들 다 바꿔 줘",
   "내 몸 상태 전하기 -- 보내고 난 뒤 자동으로 창 꺼지게, 부드럽게". */

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");
const FILES = [
  "member/src/screens.jsx", "member/src/App.jsx", "member/src/update-gate.jsx", "member/src/lesson-rating.jsx",
  "member/src/before-after.jsx", "member/src/member-extras.jsx", "member/src/lesson-sheet.jsx", "member/src/lesson-condition.jsx",
];
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("보니따 화면에 '…중…' · '…있어요…' 같은 글자 대기가 남지 않는다", async () => {
  for (const file of FILES) {
    const body = code(await read(file));
    assert.doesNotMatch(body, /"[^"]*(중|있어요|잠시만요)…"/, file);
    assert.doesNotMatch(body, />[^<]*(중|있어요)…</, file);
  }
});

test("동그라미는 동작 줄이기 기기에서 멈추지 않고 천천히 숨 쉰다 -- 기다린다는 것은 보여야 한다", async () => {
  const css = await read("member/src/styles.css");
  assert.match(css, /\.spinner-ring \{ display: block; animation: member-spin/);
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*member-spin-breathe/);
});

test("몸 상태를 보내면 완료를 잠깐 보여 주고 수업 창이 부드럽게 닫힌다", async () => {
  const box = await read("member/src/lesson-condition.jsx");
  assert.match(box, /setPhase\("sent"\);/);
  assert.match(box, /setTimeout\(onSent, CONDITION_CLOSE_DELAY_MS\)/);
  assert.match(box, /export const CONDITION_CLOSE_DELAY_MS = 1200;/);
  const sheet = await read("member/src/lesson-sheet.jsx");
  // close 는 useMotionClose 의 것 -- 아래로 미끄러지며 닫힌다.
  assert.match(sheet, /const \{ closing, close \} = useMotionClose\(onClose\);/);
  assert.match(sheet, /<ConditionBox[^>]*onSent=\{close\}/);
});
