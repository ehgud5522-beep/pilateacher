import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("App persists sourced memory and renders deterministic briefing in all three requested surfaces", async () => {
  const source = await readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
  assert.match(source, /aiMemory: memoryResult\.memories/);
  assert.match(source, /briefingLine.*b\.h >= 24/);
  assert.match(source, /aria-label="다음 수업 브리핑"/);
  assert.match(source, /data-member-section="memory-first"/);
  assert.match(source, /반복해서 기록된 내용/);
  assert.match(source, /currentSessionId: draft\.id/);
  assert.match(source, /rejectMemoryEntry\(nextMemory, memoryId\)/);
  assert.match(source, />숨기기<\/button>/);
});

test("briefing and memory rules do not import or call an LLM provider", async () => {
  const briefing = await readFile(new URL("../../src/features/member-memory/briefing.js", import.meta.url), "utf8");
  const memory = await readFile(new URL("../../src/features/member-memory/member-memory.js", import.meta.url), "utf8");
  const source = `${briefing}\n${memory}`;
  assert.doesNotMatch(source, /LlmProvider|GatewayLlm|aiProvider|structureLessonRecord|fetch\s*\(/);
});
