/**
 * 확인할 수업 시트와 첫 화면 요약을 **실제로 그린다** (2026-11-07).
 * 탭 넷 · 듀엣 한 카드 · 지난 항목은 접힘 · "오늘 미처리 N건".
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

import { organizeLessonQueue } from "../../src/features/schedule/lesson-queue.js";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
let vite = null;
const app = async () => {
  vite ||= await createServer({
    root: projectRoot, configFile: false, plugins: [react()], appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true },
    ssr: { noExternal: ["@capgo/camera-preview"] }, logLevel: "silent",
  });
  return vite.ssrLoadModule("/src/App.jsx");
};
test.after(async () => { if (vite) await vite.close(); });

const TODAY = "2026-11-07";
const members = [{ id: "m1", name: "회원가" }, { id: "m2", name: "회원나" }, { id: "m3", name: "회원다" }];
const lesson = (id, date) => ({ id, date, start: "10:00", type: "듀엣", attendees: [] });
const duet = lesson("L-duet", TODAY);
const tasks = [
  { key: "settle|L-duet", kind: "settlement", memberId: "m1", lessonId: "L-duet", s: duet, a: { memberId: "m1" } },
  { key: "m2|L-duet", kind: "attendance", memberId: "m2", lessonId: "L-duet", s: duet, a: { memberId: "m2" } },
  { key: "m3|L-old", kind: "attendance", memberId: "m3", lessonId: "L-old", s: lesson("L-old", "2026-11-03"), a: { memberId: "m3" } },
  { key: "m3|L-oct", kind: "attendance", memberId: "m3", lessonId: "L-oct", s: lesson("L-oct", "2026-10-30"), a: { memberId: "m3" } },
];
const queue = organizeLessonQueue({ tasks, today: TODAY, serverStates: {} });

const render = async (props) => {
  const { ScheduleQueueSheet } = await app();
  return renderToStaticMarkup(createElement(ScheduleQueueSheet, { queue, members, onClose: () => {}, ...props }));
};

test("탭 넷과 개수 · 오늘 탭이 먼저 · 듀엣은 한 카드", async () => {
  const html = await render({});
  const tabs = [...html.matchAll(/data-queue-tab="([^"]+)" aria-pressed="(true|false)"[^>]*>([^<]*)</g)].map((m) => [m[1], m[2], m[3].replace(/<!-- -->/g, "")]);
  assert.deepEqual(tabs, [["today", "true", "오늘 1"], ["overdue", "false", "지난 미처리 1"], ["admin", "false", "관리자 확인 0"], ["archived", "false", "지난 항목 1"]]);
  assert.match(html, /오늘 미처리 1건/);
  const cards = [...html.matchAll(/data-queue-group="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(cards, ["lesson|L-duet"], "회원 둘 + 확정이 한 카드");
  assert.match(html, /회원가 · 회원나/);
  assert.match(html, /확정 · 출석/);
});

test("지난 항목은 접혀 있다 -- 펼치면 보인다", async () => {
  const closed = await render({ initialTab: "archived" });
  assert.match(closed, /11월 1일 이전 수업 1건/);
  assert.doesNotMatch(closed, /data-queue-group=/);
  const open = await render({ initialTab: "archived", initialArchivedOpen: true });
  assert.match(open, /data-queue-group="lesson\|L-oct"/);
});

test("묶음을 고르면 첫 일(확정)과 보류 · 관리자 확인 · 회원 목록이 보인다", async () => {
  const html = await render({ initialGroupKey: "lesson|L-duet" });
  assert.match(html, /수업 확정하기/);
  assert.match(html, /data-queue-snooze/);
  assert.match(html, /data-queue-escalate/);
  assert.match(html, /한 수업 · 회원 2명/);
});

test("첫 화면 요약과 진단 배선", async () => {
  const source = await readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
  assert.match(source, /`오늘 미처리 \$\{organizedQueue\.todayCount\}건`/);
  assert.match(source, /<ScheduleQueueSheet queue=\{organizedQueue\}/);
  assert.match(source, /deviceLog\("lesson_queue_reconcile", \{/);
  assert.match(source, /data-queue-diagnostics/);
  assert.match(source, /readQueueLessonStates=\{organizationRoster && organizationContext\.organizationId \? queueLessonStatesReader : null\}/);
  // 큐에서 수업을 여는 길은 그대로 -- 바로 확정하지 않는다.
  const sheet = source.slice(source.indexOf("function ScheduleQueueSheet"), source.indexOf("function coverDraw"));
  assert.match(sheet, /onClick=\{\(\) => onOpenLesson\?\.\(task\.s \|\| task\.lesson\)\}/);
});
