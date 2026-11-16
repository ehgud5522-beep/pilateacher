/** 설계 문서 1단계-4 · 비교 검증. 기록ID 로 기기와 서버를 맞추고, 숫자만 남긴다. */
import assert from "node:assert/strict";
import test from "node:test";
import { compareRecordSets, parityState } from "../../src/features/lesson-record/record-parity.js";

test("기기에만 있는 것 = 차이, 보낼 줄에 있으면 기다리는 중, 서버의 옛 줄 · 다른 기기 줄은 오류 아님", () => {
  const result = compareRecordSets({
    uid: "t1",
    deviceRecords: [{ recordId: "a" }, { recordId: "b" }, { recordId: "c" }],
    serverRecords: [{ id: "a", createdBy: "t1" }, { id: "old", createdBy: "t1" }, { id: "b", createdBy: "someone-else" }],
    queuedIds: ["c"],
  });
  assert.deepEqual(result, { device: 3, server: 2, missing: 2, missingNotQueued: ["b"], waiting: 1, extra: 1 });
});

test("대표 화면 한 줄: 일치 · 보내는 중 · 확인 필요", () => {
  assert.equal(parityState({ missing: 0 }).key, "ok");
  assert.deepEqual(parityState({ missing: 2, waiting: 2 }), { key: "sending", label: "보내는 중 2건" });
  assert.deepEqual(parityState({ missing: 3, waiting: 1 }), { key: "check", label: "확인 필요 2건" });
});
