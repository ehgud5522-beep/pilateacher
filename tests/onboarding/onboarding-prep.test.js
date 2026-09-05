import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

import { ONBOARD_SAMPLE_SESSION } from "../../src/features/onboarding/onboarding-sample.js";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));

test("onboarding sample follows the lesson session view-model and remains presentation-only", () => {
  assert.equal(ONBOARD_SAMPLE_SESSION.today, "리포머");
  assert.equal(ONBOARD_SAMPLE_SESSION.reaction, "허리가 편해졌다고 함");
  assert.equal(ONBOARD_SAMPLE_SESSION.next, "캐딜락으로 흉추");
  assert.equal(Array.isArray(ONBOARD_SAMPLE_SESSION.records), true);
  assert.equal(Object.isFrozen(ONBOARD_SAMPLE_SESSION), true);
  assert.equal("member" in ONBOARD_SAMPLE_SESSION, false);
});

test("preview reuses the lesson row fields without operational controls", async (t) => {
  const vite = await createServer({
    root: projectRoot,
    configFile: false,
    plugins: [react()],
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true },
    logLevel: "silent",
  });
  t.after(() => vite.close());
  const { default: LessonHistorySessionRow } = await vite.ssrLoadModule("/src/features/lesson-record/LessonHistorySessionRow.jsx");

  const preview = renderToStaticMarkup(React.createElement(LessonHistorySessionRow, { session: ONBOARD_SAMPLE_SESSION, sessions: [ONBOARD_SAMPLE_SESSION], variant: "preview" }));
  assert.match(preview, /오늘 수업/);
  assert.match(preview, /리포머/);
  assert.match(preview, /회원 반응/);
  assert.match(preview, /허리가 편해졌다고 함/);
  assert.match(preview, /다음 확인/);
  assert.match(preview, /캐딜락으로 흉추/);
  assert.doesNotMatch(preview, /<button|<a\b|<details|확인 필요|일부 확인|출석 처리/);

  const interactiveSession = { ...ONBOARD_SAMPLE_SESSION, confirmationState: "pending", records: [{ id: "note-1", lessonRecord: { stage: "structured_draft" } }] };
  const interactive = renderToStaticMarkup(React.createElement(LessonHistorySessionRow, { session: interactiveSession, sessions: [interactiveSession], status: { key: "record", label: "확인 필요" } }));
  assert.match(interactive, /<details/);
  assert.match(interactive, /<button/);
  assert.match(interactive, /확인 필요/);
});
