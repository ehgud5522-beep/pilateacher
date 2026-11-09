/**
 * 수업일지 D (2026-11-07)의 배선. 저장 경로가 실제로 새 판정을 쓰는지, 실패하면 입력을
 * 지키는지, 안내 줄이 기록하는 자리마다 있는지를 소스와 렌더로 본다.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const source = () => readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");

test("(1) 음성 확정은 그 수업의 음성 기록만 집어 고친다", async () => {
  const app = await source();
  assert.match(app, /noteOptions\?\.upsert && voiceMeta && sid\s*\n\s*\? voiceNoteFor\(target\.notes \|\| \[\], sid\)/);
  assert.doesNotMatch(app, /noteOptions\?\.upsert && voiceMeta && sid\s*\n\s*\? \(target\.notes \|\| \[\]\)\.find\(\(item\) => String\(item\.sid/,
    "같은 sid 의 아무 기록이나 집던 옛 줄이 남아 있으면 안 된다");
});

test("(2) 다시 열면 직접 입력 기록을 불러와 같은 기록을 고친다 — 일정 시트 · 확인할 수업", async () => {
  const app = await source();
  assert.match(app, /const editingNote = manualNoteFor\(activeMember\?\.notes, draft\?\.id\);/);
  assert.match(app, /if \(recordMode !== "write"\) setRecordBody\(editingNote\?\.body \|\| ""\)/);
  assert.match(app, /draft\.id, recordBody\.trim\(\), null, editingNote \? \{ existingNoteId: editingNote\.id \} : null\)/);
  assert.match(app, /const queueEditingNote = manualNoteFor\(/);
  assert.match(app, /task\.s\.id, recordBody\.trim\(\), null, queueEditingNote \? \{ existingNoteId: queueEditingNote\.id \} : null\)/);
});

test("로그인이 풀렸거나 기록이 비어 있으면 저장 실패로 처리한다", async () => {
  const app = await source();
  assert.match(app, /if \(stored !== true\) \{\s*\n\s*deviceLog\("lesson_note_save_failed"/);
  assert.match(app, /\(코드 no_account\)/);
  assert.match(app, /\(코드 empty_record\)/, "빈 기록도 말없이 끝나지 않는다");
});

test("(3) 회원 상세의 기록은 고른 수업에 이어 저장된다", async () => {
  const app = await source();
  assert.match(app, /saveScheduleComment\(member\.id, type, noteOptions\?\.lessonId \|\| null, body, voiceMeta, noteOptions\)/);
  assert.match(app, /onApply=\{\(text, meta\) => onSaveNote\("개인레슨", text, meta, \{ confirmed: true, upsert: true, lessonId: linkLessonId \|\| null \}\)\}/);
  assert.match(app, /data-record-lesson-link/);
  assert.match(app, /<option value="">수업과 잇지 않음<\/option>/);
});

test("(4) 안내 줄 — 문구와, 일정 시트 · 확인할 수업 기록 칸에도 있다", async () => {
  const app = await source();
  assert.ok(app.includes('const DEVICE_ONLY_HINT = "다른 기기에는 보이지 않아요 (본인 계정 백업에 포함)";'));
  const entries = app.split("data-lesson-record-entry").slice(1);
  assert.equal(entries.length, 2, "기록 칸 둘(일정 시트 · 확인할 수업)");
  for (const after of entries) assert.match(after.slice(0, 400), /<DeviceOnlyNote \/>/);
  assert.doesNotMatch(app, /회원·수업 기록은 클라우드에 안전하게 백업됩니다/, "개인정보 안내도 같은 말을 한다");
  assert.match(app, /수업 메모·상담 메모·회원 목표는 입력한 기기에 저장되며 다른 기기·센터·회원 앱에는 보이지 않습니다/);
});

test("(4) 안내 줄을 그리면 문구가 보인다", async (t) => {
  const vite = await createServer({
    root: projectRoot, configFile: false, plugins: [react()], appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true },
    ssr: { noExternal: ["@capgo/camera-preview"] }, logLevel: "silent",
  });
  t.after(() => vite.close());
  const { DeviceOnlyNote } = await vite.ssrLoadModule("/src/App.jsx");
  const html = renderToStaticMarkup(createElement(DeviceOnlyNote));
  assert.match(html, /data-device-only/);
  assert.match(html, /다른 기기에는 보이지 않아요 \(본인 계정 백업에 포함\)/);
});
