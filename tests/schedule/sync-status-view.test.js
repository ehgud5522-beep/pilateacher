/**
 * 일정 동기화 상태 한 줄 (2026-11-20). 율하 웹에 수업이 0 인데 이유를 볼 곳이 없었다.
 * 상태 → 문구 → 코드가 한 줄로 이어지는지 (CLAUDE.md 8).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { SYNC_STATUS_TONE, scheduleSyncStatus } from "../../src/features/schedule/sync-status-view.js";

const on = (extra) => scheduleSyncStatus({ organizationMode: true, enabled: true, ...extra });

test("센터 소속이 아니면 그리지 않는다", () => {
  assert.equal(scheduleSyncStatus({ organizationMode: false, enabled: true, state: "error" }), null);
});

test("꺼짐 · 준비 중 · 받는 중", () => {
  assert.equal(scheduleSyncStatus({ organizationMode: true, enabled: false, state: "off" }).label, "꺼짐");
  assert.equal(on({ state: "idle" }).label, "준비 중");
  assert.equal(on({ state: "listening" }).label, "받는 중");
});

test("받지 못함은 원본 코드와 함께, 코드가 없으면 unknown", () => {
  const failed = on({ state: "error", errorCode: "permission-denied" });
  assert.equal(failed.tone, SYNC_STATUS_TONE.BAD);
  assert.match(failed.detail, /\(코드 permission-denied\)/);
  assert.match(on({ state: "error", errorCode: "snapshot:storage/unauthorized" }).detail, /코드 snapshot:storage\/unauthorized/);
  assert.match(on({ state: "error" }).detail, /코드 unknown/);
});

test("받았는데 0건 · 명부에서 못 찾은 회원 · 정상", () => {
  const empty = on({ state: "listening", received: 0 });
  assert.equal(empty.tone, SYNC_STATUS_TONE.WARN);
  assert.match(empty.detail, /코드 server_empty/);
  const unmatched = on({ state: "listening", received: 12, unmatched: 3 });
  assert.equal(unmatched.tone, SYNC_STATUS_TONE.WARN);
  assert.match(unmatched.detail, /12건을 .*회원 3명.*코드 unmatched_clients/);
  const fine = on({ state: "listening", received: 12, unmatched: 0 });
  assert.equal(fine.tone, SYNC_STATUS_TONE.GOOD);
  assert.equal(fine.label, "받음 12건");
});

test("배선: 받은 뒤 건수를 남기고, 일정 탭 빈 화면 · 데이터 상태에 같은 값", () => {
  const app = readFileSync(new URL("../../src/App.jsx", import.meta.url), "utf8");
  assert.match(app, /setSyncState\(\{ state: "listening", errorCode: "", received: docs\.length, unmatched: merged\.unmatchedClientIds\.length \}\)/);
  // scheduleSyncOn 보다 뒤에서 만든다 -- 앞에서 쓰면 그 화면 전체가 ReferenceError 로 꺼진다.
  assert.ok(app.indexOf("const scheduleSyncOn = ") < app.indexOf("const syncStatus = scheduleSyncStatus("));
  assert.match(app, /syncStatus=\{syncStatus\} payCard=/);
  assert.match(app, /<ReferenceSettingsTab syncStatus=\{syncStatus\}/);
  assert.match(app, /일정 동기화 · \{syncStatus\.label\} — \{syncStatus\.detail\}/);
});
