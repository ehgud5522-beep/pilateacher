import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { AI_STATUSES } from "../../src/ai/contracts.js";
import { GatewayLlmProvider } from "../../src/features/lesson-record/llm-provider.js";
import { listPendingLessonRecords, loadPendingLessonRecord, removePendingLessonRecord, savePendingLessonRecord } from "../../src/features/lesson-record/draft-queue.js";
import { editStructuredField, structuredRecordBody, validateStructuredOutput } from "../../src/features/lesson-record/record-schema.js";
import { mapPilatesTerms, PILATES_TERMS } from "../../src/features/lesson-record/term-mapper.js";
import { readLessonRecordUsage, trackLessonRecordUsage } from "../../src/features/lesson-record/usage-telemetry.js";

const memoryStorage = () => {
  const data = new Map();
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)), removeItem: (key) => data.delete(key), dump: () => [...data.values()].join("\n") };
};

const structured = { didToday: ["리포머 풋워크"], observations: ["흉추 가동성 관찰"], responses: ["편안하다고 말함"], nextFocus: ["브릿지 확인"], uncertain: [] };

test("term mapping preserves raw transcript and keeps uncertain candidates separate", () => {
  const raw = "리포머에서 브리지 후 고관절 가동성을 확인했다. 캐딜락크도 사용했다.";
  const result = mapPilatesTerms(raw);
  assert.equal(result.rawTranscript, raw);
  assert.ok(result.mapped.some((item) => item.canonical === "브릿지" && item.bodyKey === "exercise.bridge"));
  assert.ok(result.mapped.some((item) => item.canonical === "고관절" && item.category === "anatomy"));
  assert.ok(result.uncertain.some((item) => item.raw === "캐딜락크" && item.canonical === "캐딜락"));
  assert.ok(PILATES_TERMS.length >= 20);
});

test("structured records validate exact fields and instructor edits retain origin", () => {
  const draft = validateStructuredOutput(structured);
  assert.equal(draft.didToday[0].origin, "ai");
  const edited = editStructuredField(draft, "didToday", "체어 풋워크\n브릿지");
  assert.deepEqual(edited.didToday.map((item) => item.origin), ["instructor", "instructor"]);
  assert.match(structuredRecordBody(edited), /오늘 한 내용: 체어 풋워크 · 브릿지/);
  assert.throws(() => validateStructuredOutput({ ...structured, diagnosis: [] }));
  const missingNormalized = validateStructuredOutput({ didToday: ["브릿지"], responses: [{ text: "편안함" }] });
  assert.deepEqual(missingNormalized.observations, []);
  assert.equal(missingNormalized.responses[0].text, "편안함");
});

test("LlmProvider repairs once, validates output, and downgrades to raw after failure", async () => {
  let calls = 0;
  const provider = new GatewayLlmProvider({
    gatewayProvider: { async structureLessonRecord() { calls += 1; if (calls < 2) throw Object.assign(new Error("temporary"), { code: "invalid_output" }); return { status: AI_STATUSES.DRAFT, output: structured, usage: { totalTokens: 42 } }; } },
    retryDelayMs: 0,
  });
  const result = await provider.structureLessonRecord({ rawTranscript: "원문" });
  assert.equal(result.status, "structured");
  assert.equal(result.attempts, 2);
  assert.equal(result.output.didToday[0].origin, "ai");

  const failed = new GatewayLlmProvider({ gatewayProvider: { async structureLessonRecord() { throw Object.assign(new Error("down"), { code: "provider_unavailable", retryable: true }); } }, retryDelayMs: 0 });
  assert.equal((await failed.structureLessonRecord({ rawTranscript: "그대로" })).status, "unstructured");
  const offline = new GatewayLlmProvider({ gatewayProvider: {}, online: () => false });
  assert.equal((await offline.structureLessonRecord({ rawTranscript: "대기" })).status, "queued");
});

test("pending queue survives exit and usage telemetry stores counters without transcript", () => {
  const storage = memoryStorage();
  savePendingLessonRecord("m1", "l1", { rawTranscript: "민감한 원문", status: "queued" }, storage);
  assert.equal(loadPendingLessonRecord("m1", "l1", storage).rawTranscript, "민감한 원문");
  assert.equal(listPendingLessonRecords(storage).length, 1);
  removePendingLessonRecord("m1", "l1", storage);
  assert.equal(listPendingLessonRecords(storage).length, 0);

  trackLessonRecordUsage("stt_complete", { seconds: 12, transcript: "저장 금지 원문" }, storage);
  trackLessonRecordUsage("llm_complete", { attempts: 1, latencyMs: 320, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, transcript: "저장 금지 원문" }, storage);
  trackLessonRecordUsage("record_confirmed", {}, storage);
  const usage = readLessonRecordUsage(storage);
  assert.equal(usage.sttSeconds, 12);
  assert.equal(usage.totalTokens, 15);
  assert.equal(usage.completedRecords, 1);
  assert.doesNotMatch(storage.dump(), /저장 금지 원문/);
});

test("App exposes four post-attendance choices, 90-second cap, pending save and post-confirm audio deletion", async () => {
  const source = await readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
  assert.match(source, /말하기<\/button>/);
  assert.match(source, /직접입력<\/button>/);
  assert.match(source, />노코멘트<\/button>/);
  assert.match(source, />나중에<\/button>/);
  assert.match(source, /elapsed >= MAX_STT_SECONDS/);
  assert.match(source, /savePendingLessonRecord/);
  const saveIndex = source.indexOf("const stored = await saveDb", source.indexOf("const saveScheduleComment"));
  const deleteIndex = source.indexOf("await blobDel(voiceMeta.audioBlobId)", saveIndex);
  assert.ok(saveIndex >= 0 && deleteIndex > saveIndex, "temporary audio must be deleted only after persistence succeeds");
  assert.match(source, /stage: "confirmed_record"/);
  assert.match(source, /status: voiceMeta\.lessonRecord\.structuredDraft \? "confirmed" : "confirmed_unstructured"/);
  assert.match(source, /ignored_pre_start_stopped/);
  assert.match(source, /startRequestRef\.current/);
  assert.match(source, /시작 중…/);
  assert.match(source, /원문으로 저장/);
});
