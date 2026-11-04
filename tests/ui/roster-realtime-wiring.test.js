/**
 * 명단 실시간(2단계)의 배선. 스위치 · 범위 · 끊기 · 진단 · 지점 칩 알림 · 관리 카드.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");

test("스위치는 이미 읽는 scheduleSync 문서에서 — 꺼지면 범위가 none", () => {
  assert.match(source, /const rosterRealtimeOn = Boolean\(organizationRoster\) && rosterRealtimeEnabledFor\(scheduleSyncConfig, account\?\.id\);/);
  assert.match(source, /: \{ kind: REALTIME_SCOPE\.NONE, reason: "off", key: "none:off" \}\),/);
});

test("범위가 바뀌면 끊고 다시 건다 — key 와 센터로만 다시 돈다", () => {
  assert.match(source, /\}, \[realtimeScope\.key, organizationContext\.organizationId\]\);/);
  assert.match(source, /return \(\) => \{\s+alive = false;\s+stop\(\);/);
});

test("강사 범위는 나간 회원을 뺀다 · 새 회원의 회원권만 골라 읽는다", () => {
  assert.match(source, /applyClientChanges\(rosterClientsRef\.current, snapshot\.changes, \{ removeOnLeave: removesOnLeave\(realtimeScope\) \}\)/);
  assert.match(source, /readPassesForClients\(organizationId, missing\)/);
});

test("읽기 횟수를 진단에 남긴다 — 첫 스냅샷 · 50건마다 · 끊을 때", () => {
  assert.match(source, /deviceLog\("roster_realtime", \{\s+feature: "centre_roster", stage: snapshot\.first \? "initial" : "change",\s+count: total/);
  assert.match(source, /deviceLog\("roster_realtime", \{ feature: "centre_roster", stage: "stop", count: total/);
  assert.match(source, /deviceLog\("roster_realtime_failed", \{\s+feature: "centre_roster", stage: "listen", errorDomain: "firestore",\s+errorCode: error\?\.code/);
});

test("회원 목록이 고른 지점 칩을 알린다 · 실시간이면 그렇게 말한다", () => {
  assert.match(source, /useEffect\(\(\) => \{ if \(organizationMode\) reportLocationChip\?\.\(effectiveLocation\); \}/);
  assert.match(source, /roster\.live \? "실시간으로 받는 중"/);
});

test("관리 화면에 세 번째 스위치 카드", () => {
  assert.match(source, /document="rosterRealtime" title="회원 명단 실시간"/);
});
