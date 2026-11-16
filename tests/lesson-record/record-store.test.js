/**
 * 설계 문서 1단계-1 · 저장 계층 분리. 기기 기록 → 서버 기록 모양. 이 단계에서는 보내지 않는다.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  SERVER_RECORD_KIND, contentHash, createRecordStore, isServerEligibleNote, serverRecordFromNote, serverRecordId,
} from "../../src/features/lesson-record/record-store.js";

const voice = (overrides = {}) => ({
  id: "n1", sid: "L1", date: "2026-11-15", type: "개인레슨", body: "오늘 수업: 브릿지", transcript: "회원 김지민 오늘 브릿지", voiceSource: "native",
  aiSummary: { didToday: ["원래 AI"] },
  lessonRecord: { stage: "confirmed_record", confirmationStatus: "confirmed", confirmedAt: "2026-11-15T10:00:00Z",
    confirmedRecord: { didToday: [{ text: "브릿지", origin: "ai" }], observations: [], responses: ["허리가 편하다고 함"], nextFocus: [{ text: "골반 정렬", origin: "instructor" }], uncertain: [] } },
  ...overrides,
});
const ctx = { memberId: "client-1", organizationId: "org", uid: "teacher-1", appBuild: "1.1.53 (76)" };

test("확정된 음성 기록 → 서버 한 줄: 네 칸 · 본문 · 수업 · 강사, 이름 · 전사문 · 음성 없음", () => {
  const record = serverRecordFromNote({ note: voice(), lesson: { date: "2026-11-15", start: "10:00" }, ...ctx });
  assert.equal(record.data.kind, SERVER_RECORD_KIND.VOICE);
  assert.equal(record.data.clientId, "client-1");
  assert.equal(record.data.lessonId, "L1");
  assert.equal(record.data.lessonStart, "10:00");
  assert.equal(record.data.instructorId, "teacher-1");
  assert.equal(record.data.createdBy, "teacher-1");
  assert.deepEqual(record.data.fields.responses, [{ text: "허리가 편하다고 함", origin: "ai" }]);
  assert.deepEqual(record.data.fields.nextFocus, [{ text: "골반 정렬", origin: "instructor" }]);
  assert.equal(record.data.source, "app");
  const json = JSON.stringify(record);
  assert.doesNotMatch(json, /김지민|transcript|audio|원래 AI/, "전사문 · AI 원본 · 이름은 가지 않는다");
});

test("같은 내용은 같은 기록ID (여러 번 보내도 한 줄), 고치면 새 ID 와 앞 줄 가리킴", () => {
  const first = serverRecordFromNote({ note: voice(), ...ctx });
  assert.equal(serverRecordFromNote({ note: voice(), ...ctx }).recordId, first.recordId);
  const edited = serverRecordFromNote({ note: voice({ body: "오늘 수업: 브릿지 · 롤업" }), previousRecordId: first.recordId, ...ctx });
  assert.notEqual(edited.recordId, first.recordId);
  assert.equal(edited.data.supersedes, first.recordId);
  assert.match(first.recordId, /^teacher-1_n1_[0-9a-f]{8}$/);
  assert.equal(serverRecordId("a/b", "c d", "x"), "a-b_c-d_x", "문서 ID 에 못 쓰는 글자는 바꾼다");
  assert.equal(contentHash({ a: 1 }), contentHash({ a: 1 }));
});

test("보내지 않는 것: 확인 대기 초안 · 상담 메모 · 빈 기록 · 회원/센터/강사 모름", () => {
  assert.equal(isServerEligibleNote(voice({ lessonRecord: { stage: "structured_draft", confirmationStatus: "pending" } })), false);
  assert.equal(isServerEligibleNote({ id: "c", type: "상담", body: "가격 상담" }), false);
  assert.equal(isServerEligibleNote({ id: "e", type: "개인레슨", body: "  " }), false);
  assert.equal(serverRecordFromNote({ note: voice(), ...ctx, organizationId: "" }), null);
  assert.equal(serverRecordFromNote({ note: voice(), ...ctx, uid: "" }), null);
});

test("직접 입력 · 노코멘트는 저장이 곧 확정 -- 구조 칸 없이 본문만", () => {
  const manual = serverRecordFromNote({ note: { id: "m1", sid: "L2", date: "2026-11-15", type: "개인레슨", body: "골반 위주로 진행" }, ...ctx });
  assert.equal(manual.data.kind, SERVER_RECORD_KIND.MANUAL);
  assert.equal("fields" in manual.data, false);
  const none = serverRecordFromNote({ note: { id: "m2", sid: "L3", date: "2026-11-15", type: "개인레슨", body: "특이사항 없음" }, ...ctx });
  assert.equal(none.data.kind, SERVER_RECORD_KIND.NO_COMMENT);
});

test("후크: 꺼져 있으면 아무것도 하지 않고, 켜지면 보낼 줄에 넣고, 실패해도 던지지 않는다", () => {
  const sent = [];
  assert.deepEqual(createRecordStore().afterDeviceSave({ note: voice(), memberId: "client-1" }), { queued: false, reason: "disabled" });
  const on = createRecordStore({ isEnabled: () => true, enqueue: (record) => sent.push(record), context: () => ({ organizationId: "org", uid: "teacher-1" }) });
  assert.equal(on.afterDeviceSave({ note: voice(), memberId: "client-1" }).queued, true);
  assert.equal(sent.length, 1);
  const broken = createRecordStore({ isEnabled: () => true, enqueue: () => { throw new Error("x"); }, context: () => ({ organizationId: "org", uid: "teacher-1" }) });
  assert.equal(broken.afterDeviceSave({ note: voice(), memberId: "client-1" }).reason, "error");
});

test("앱: 두 저장 경로가 기기 저장 성공 뒤 후크를 부른다 (켜고 끄는 것은 1-2 의 스위치)", async () => {
  const source = await readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
  assert.match(source, /const lessonRecordStore = useMemo\(\(\) => createRecordStore\(\{/);
  assert.match(source, /if \(shouldConfirm\) lessonRecordStore\.afterDeviceSave\(\{ note, memberId: id, lesson: linkedLesson \}\);/);
  assert.match(source, /if \(stored === false\) return false;\n    lessonRecordStore\.afterDeviceSave\(\{ note: finalizedWithSession/);
});

test("후크: 기기 회원 id 를 센터 회원 id(orgClientId)로 바꿔 보내고, 이어지지 않은 회원은 보내지 않는다", () => {
  const sent = [];
  const store = createRecordStore({
    isEnabled: () => true, enqueue: (record) => sent.push(record),
    context: () => ({ organizationId: "org", uid: "teacher-1", resolveClientId: (id) => (id === "legacy-7" ? "client-42" : "") }),
  });
  assert.equal(store.afterDeviceSave({ note: voice(), memberId: "legacy-7" }).queued, true);
  assert.equal(sent[0].data.clientId, "client-42");
  assert.deepEqual(store.afterDeviceSave({ note: voice({ id: "n2" }), memberId: "device-only" }), { queued: false, reason: "not_centre_member" });
});
