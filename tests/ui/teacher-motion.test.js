/**
 * 필라티쳐 움직임 (2026-11-15 강사 제보: "보니따 앱처럼 부드럽게").
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8").then((text) => text.replace(/\r\n/g, "\n"));

test("움직임 줄이기를 켠 기기에서는 모든 움직임이 꺼진다 -- 규칙은 한 블록 안에만", async () => {
  const css = await read("src/features/ui/teacher-motion.css");
  const start = css.indexOf("@media (prefers-reduced-motion: no-preference) {");
  assert.ok(start > 0);
  const outside = css.slice(0, start).replace(/@keyframes[^{]+\{(?:[^{}]*\{[^}]*\})*[^{}]*\}/g, "");
  assert.doesNotMatch(outside, /animation\s*:|transition\s*:|scale\s*:/);
});

test("닫히는 움직임은 화면이 기다리는 시간 안에 끝난다", async () => {
  const [css, hook] = await Promise.all([read("src/features/ui/teacher-motion.css"), read("src/features/ui/use-motion-close.js")]);
  const out = Number(css.match(/--t-out:\s*(\d+)ms/)[1]);
  const wait = Number(hook.match(/EXIT_TIMEOUT_MS = (\d+)/)[1]);
  assert.ok(out <= wait, `${out}ms vs ${wait}ms`);
});

test("누름은 transform 이 아니라 scale 속성 -- 가운데 맞춤 버튼이 옆으로 튀지 않게", async () => {
  const css = await read("src/features/ui/teacher-motion.css");
  assert.match(css, /button:not\(:disabled\):not\(\[data-no-press\]\):active \{ scale: \.97; \}/);
  assert.doesNotMatch(css, /:active \{ transform:/);
});

test("강사 앱만 불러오고, 공용 움직임 뒤에 둔다 · 아이폰 :active 를 위한 touchstart", async () => {
  const [main, memberMain] = await Promise.all([read("src/main.jsx"), read("member/src/main.jsx")]);
  assert.ok(main.indexOf('"./features/ui/motion.css"') < main.indexOf('"./features/ui/teacher-motion.css"'));
  assert.match(main, /document\.addEventListener\("touchstart", \(\) => \{\}, \{ passive: true \}\)/);
  assert.doesNotMatch(memberMain, /teacher-motion/, "보니따는 자기 움직임만");
});

test("공용 시트는 닫기 · 어둠 · Esc · 뒤로 가기가 내려가는 움직임을 지난다", async () => {
  const source = await read("src/App.jsx");
  const sheet = source.slice(source.indexOf("function Sheet({ title,"), source.indexOf("function ScheduleBottomSheet("));
  assert.match(sheet, /const \{ closing, close \} = useMotionClose\(onClose\);/);
  assert.match(sheet, /useBackClose\(true, close\)/);
  assert.match(sheet, /e\.stopPropagation\(\); close\(\); return;/);
  assert.match(sheet, /className="teacher-sheet fixed inset-0" data-closing=\{closing \|\| undefined\}/);
  assert.match(sheet, /teacher-sheet-scrim absolute inset-0"[^>]*onClick=\{close\}/);
  assert.match(sheet, /onClick=\{close\} aria-label="닫기"/);
  assert.doesNotMatch(sheet, /onClick=\{onClose\}/);
  assert.match(source, /animateClose = true \}\) \{/, "일정 시트도 내려가며 닫힌다");
  assert.match(source, /data-overlay=\{name\} className=\{`teacher-page-in /, "전체 화면은 옆에서 들어온다");
});
