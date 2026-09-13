import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("App rebuilds and persists memory for draft or confirmed lesson saves before briefing consumers read it", async () => {
  const source = await readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
  const save = source.slice(source.indexOf("const saveScheduleComment"), source.indexOf("const noComment"));
  assert.match(save, /const memoryResult = buildMemberMemorySafely\(\{ memberId: id, notes: nextNotes, existingMemory: target\.aiMemory \|\| \[\], schedule: currentDb\.schedule \}\)/);
  assert.doesNotMatch(save, /const memoryResult = shouldConfirm/);
  assert.match(save, /notes: nextNotes, aiMemory: memoryResult\.memories, memoryRebuildNeeded: memoryResult\.failed/);
  assert.match(save, /const stored = await saveDb\(nextDb\)/);
  assert.match(source, /createMemberBriefing\(\{ member: target, currentSessionId: sessionId, schedule: db\.schedule \}\)/);
  assert.match(source, /data-member-section="next-preparation"/);
});

test("briefing and memory rules do not import or call an LLM provider", async () => {
  const briefing = await readFile(new URL("../../src/features/member-memory/briefing.js", import.meta.url), "utf8");
  const memory = await readFile(new URL("../../src/features/member-memory/member-memory.js", import.meta.url), "utf8");
  const source = `${briefing}\n${memory}`;
  assert.doesNotMatch(source, /LlmProvider|GatewayLlm|aiProvider|structureLessonRecord|fetch\s*\(/);
});
