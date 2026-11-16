/** 설계 결정 4 · 회원 단위 수업기록 서버 보관 · AI 처리 동의. 동의 없으면 서버로 보내지 않고, 문구가 바뀌면 다시 받는다. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  MEMBER_AI_CONSENT_VERSION, MEMBER_DATA_CONSENT_SECTIONS, memberDataConsentGranted, memberDataConsentState,
} from "../../src/features/consent/member-data-consent.js";
import { createRecordStore, migrationRecordsFor } from "../../src/features/lesson-record/record-store.js";

const granted = { status: "granted", version: MEMBER_AI_CONSENT_VERSION, grantedAt: "x", grantedBy: "t1" };

test("동의 상태: 동의함 · 철회함 · 문구가 바뀜 · 없음", () => {
  assert.equal(memberDataConsentState({ orgAiConsent: granted }).key, "granted");
  assert.equal(memberDataConsentState({ orgAiConsent: { status: "revoked", version: MEMBER_AI_CONSENT_VERSION } }).key, "revoked");
  assert.equal(memberDataConsentState({ orgAiConsent: { ...granted, version: "2000-01-01" } }).key, "outdated");
  assert.equal(memberDataConsentState({}).key, "missing");
  assert.equal(memberDataConsentGranted({ aiConsent: granted }), true);
});

test("문구는 법이 알리라는 것과 민감정보 · 국외 이전 · 거부 권리를 담는다", () => {
  const all = MEMBER_DATA_CONSENT_SECTIONS.map((section) => `${section.heading} ${section.body}`).join("\n");
  for (const word of ["저장", "왜", "누가", "OpenAI", "미국", "보관", "동의하지 않으셔도", "민감정보", "철회"]) assert.match(all, new RegExp(word), word);
});

const note = { id: "n1", sid: "L1", date: "2026-11-15", type: "개인레슨", body: "브릿지" };

test("동의 없는 회원의 기록은 서버로 보내지 않는다 -- 기기 저장은 이미 끝남", () => {
  const queued = [];
  const store = createRecordStore({
    isEnabled: () => true,
    enqueue: (record) => queued.push(record),
    context: () => ({ organizationId: "o1", uid: "t1", resolveClientId: () => "c1", consentFor: (memberId) => memberId === "yes" }),
  });
  assert.equal(store.afterDeviceSave({ note, memberId: "no" }).reason, "consent_missing");
  assert.equal(store.afterDeviceSave({ note, memberId: "yes" }).queued, true);
  assert.equal(queued.length, 1);
});

test("이관 · 비교도 동의한 회원만", () => {
  const members = [
    { id: "a", orgClientId: "c1", orgAiConsent: granted, notes: [note] },
    { id: "b", orgClientId: "c2", orgAiConsent: null, notes: [{ ...note, id: "n2" }] },
  ];
  const result = migrationRecordsFor({ members, consentOf: memberDataConsentGranted, organizationId: "o1", uid: "t1" });
  assert.deepEqual(result.records.map((record) => record.data.clientId), ["c1"]);
});

test("서버와 앱이 같은 동의 버전을 본다", () => {
  const shared = readFileSync(new URL("../../functions/shared/member-summary.mjs", import.meta.url), "utf8");
  assert.match(shared, new RegExp(`MEMBER_AI_CONSENT_VERSION = "${MEMBER_AI_CONSENT_VERSION}"`));
});

test("명부가 회원 문서의 동의 칸을 싣는다", () => {
  const bridge = readFileSync(new URL("../../src/features/roster/roster-bridge.js", import.meta.url), "utf8");
  assert.match(bridge, /orgAiConsent: client\.aiConsent/);
});

test("동의 카드는 서버 저장 · AI 요약 스위치가 켜진 계정에서만, 실패는 코드와 함께", () => {
  const app = readFileSync(new URL("../../src/App.jsx", import.meta.url), "utf8");
  assert.match(app, /const memberConsentOn = Boolean\(organizationRoster\) && \(lessonRecordServerOn \|\| scheduleSyncEnabledFor\(scheduleSyncConfig\?\.memberSummary, account\?\.id\)\);/);
  assert.match(app, /if \(!context\.consentOn \|\| !clientId\) return null;/);
  assert.match(app, /기록하지 못했어요\. 연결을 확인하고 다시 눌러 주세요 \(코드 /);
  assert.match(app, /consentFor: \(memberId\) => memberDataConsentGranted\(findRosterMemberRef\.current\(memberId\)\)/);
});
