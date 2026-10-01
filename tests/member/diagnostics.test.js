/**
 * 회원 앱 진단.
 *
 * 이 기록은 **대표에게 그대로 읽히고 캡처되어 돌아다닐 수 있다.** 그래서
 * 고정하는 것이 둘이다: 회원을 가리키는 값이 한 톨도 없을 것, 그리고 막힌
 * 원인을 짚을 만큼은 남을 것. 둘 중 하나만 지키면 이 화면은 쓸모가 없거나
 * 위험하다.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  DIAGNOSTIC_KEY,
  DIAGNOSTIC_LIMIT,
  FORBIDDEN_DIAGNOSTIC_FIELDS,
  MEMBER_FEATURE,
  MEMBER_STAGE,
  clearDiagnostics,
  diagnosticEntry,
  diagnosticsText,
  readDiagnostics,
  recordDiagnostic,
  runtimeInfo,
  scrubMessage,
} from "../../member/src/diagnostics.js";
import { DEVICE_KEYS } from "../../member/src/session.js";

const NOW = new Date(2026, 8, 28, 9, 30, 0);
const runtime = { platform: "ios", appVersion: "1.0.0", appCommit: "5be3511", builtAt: "", device: "iPhone" };

function box({ throwOnSet = false, throwOnGet = false } = {}) {
  const map = new Map();
  return {
    map,
    getItem(key) { if (throwOnGet) throw new Error("막힘"); return map.get(key) ?? null; },
    setItem(key, value) { if (throwOnSet) throw new Error("막힘"); map.set(key, value); },
    removeItem(key) { map.delete(key); },
  };
}

test("전화번호는 어떤 표기로 와도 지운다", () => {
  /* Firebase 오류 문구에 번호가 섞여 온다. 문구를 그냥 두면 그 번호가
     기록에 남고, 그 기록은 캡처되어 돌아다닌다. */
  for (const written of ["+821012345678", "+82 10 1234 5678", "010-1234-5678",
    "01012345678", "010 1234 5678"]) {
    const scrubbed = scrubMessage(`전화번호 ${written} 를 확인할 수 없습니다`);
    assert.doesNotMatch(scrubbed, /\d{4}/, written);
    assert.match(scrubbed, /\[번호\]/, written);
  }
});

test("지우는 것은 값이고 사실이 아니다", () => {
  /* "번호가 있었다" 까지 지우면 왜 거절됐는지 읽을 수 없다. */
  const scrubbed = scrubMessage("TOO_SHORT: phone number +8210 is invalid");
  assert.match(scrubbed, /TOO_SHORT/);
  assert.match(scrubbed, /invalid/);
});

test("메일 주소도 지운다", () => {
  assert.match(scrubMessage("user ehgud@example.com not found"), /\[메일\]/);
  assert.doesNotMatch(scrubMessage("user ehgud@example.com not found"), /example\.com/);
});

test("긴 문구는 자른다", () => {
  /* 스택 전체가 들어오면 화면이 그것만 그린다. */
  assert.equal(scrubMessage("가".repeat(1000)).length, 300);
});

test("허용 목록 밖은 들어오지 않는다", () => {
  /* **여기가 이 파일의 핵심이다.** 부르는 쪽이 실수로 회원 정보를 넘겨도
     한 줄에 담기지 않아야 한다. */
  const entry = diagnosticEntry({
    feature: MEMBER_FEATURE.LINK, stage: MEMBER_STAGE.FAILED,
    errorDomain: "firestore", errorCode: "permission-denied",
    message: "denied",
    phone: "010-1234-5678", name: "김하나", userId: "uid-1", clientId: "c1",
    verificationId: "vid", idToken: "eyJ...",
  }, { now: NOW, runtime });

  const serialized = JSON.stringify(entry);
  for (const forbidden of FORBIDDEN_DIAGNOSTIC_FIELDS) {
    assert.doesNotMatch(serialized, new RegExp(`"${forbidden}"`), forbidden);
  }
  assert.doesNotMatch(serialized, /김하나|uid-1|1234-5678|eyJ/);
});

test("원인을 짚을 만큼은 남는다", () => {
  /* CLAUDE.md §2. 정규화한 코드로 원본을 덮지 않는다 -- 원본이 없으면
     원인 확정이 불가능하다. */
  const entry = diagnosticEntry({
    feature: MEMBER_FEATURE.AUTH_INIT, stage: MEMBER_STAGE.AUTH_STATE_TIMEOUT,
    errorDomain: "firebase_auth", errorCode: "auth_state_never_fired",
    message: "10000ms 안에 로그인 상태가 오지 않았습니다.",
    correlationId: "req-7",
  }, { now: NOW, runtime });

  assert.equal(entry.at, NOW.toISOString());
  assert.equal(entry.feature, "auth_init");
  assert.equal(entry.stage, "auth_state_timeout");
  assert.equal(entry.errorDomain, "firebase_auth");
  assert.equal(entry.errorCode, "auth_state_never_fired");
  assert.equal(entry.correlationId, "req-7");
  assert.equal(entry.platform, "ios");
  assert.equal(entry.appCommit, "5be3511", "번들에 심긴 커밋이 보인다");
});

test("분류하지 못한 것도 unknown 으로 남는다", () => {
  const entry = diagnosticEntry({}, { now: NOW, runtime });
  assert.equal(entry.feature, "unknown");
  assert.equal(entry.stage, "unknown");
});

test("최근 것이 앞이고 오래된 것부터 버린다", () => {
  const store = box();
  for (let i = 0; i < DIAGNOSTIC_LIMIT + 5; i += 1) {
    recordDiagnostic({ feature: "f", stage: `s${i}` }, { store, now: NOW, runtime });
  }
  const rows = readDiagnostics(store);
  assert.equal(rows.length, DIAGNOSTIC_LIMIT);
  assert.equal(rows[0].stage, `s${DIAGNOSTIC_LIMIT + 4}`, "최근 것이 앞");
});

test("저장이 막힌 기기에서도 죽지 않는다", () => {
  assert.doesNotThrow(() => recordDiagnostic({ feature: "f" }, { store: box({ throwOnSet: true }), runtime }));
  assert.deepEqual(readDiagnostics(box({ throwOnGet: true })), []);
  assert.doesNotThrow(() => clearDiagnostics(null));
});

test("깨진 기록은 빈 목록으로 본다", () => {
  const store = box();
  store.setItem(DIAGNOSTIC_KEY, "{ JSON 아님");
  assert.deepEqual(readDiagnostics(store), []);
  store.setItem(DIAGNOSTIC_KEY, JSON.stringify({ 하나: 1 }));
  assert.deepEqual(readDiagnostics(store), []);
});

test("기기를 묻다가 터져도 웹으로 본다", () => {
  const info = runtimeInfo({ Capacitor: { getPlatform() { throw new Error("no"); } } });
  assert.equal(info.platform, "web");
  assert.equal(runtimeInfo({}).platform, "web");
  assert.equal(runtimeInfo({ Capacitor: { getPlatform: () => "ios" } }).platform, "ios");
});

test("빌드를 모르면 지어내지 않는다", () => {
  /* 없는 커밋을 적으면 진단이 거짓말을 한다. */
  const info = runtimeInfo({});
  assert.equal(info.appVersion, "");
  assert.equal(info.appCommit, "");
});

test("복사해서 보낼 한 덩어리", () => {
  const text = diagnosticsText([diagnosticEntry({
    feature: MEMBER_FEATURE.AUTH_INIT, stage: MEMBER_STAGE.AUTH_STATE_TIMEOUT,
    errorDomain: "firebase_auth", errorCode: "auth_state_never_fired",
  }, { now: NOW, runtime })]);
  assert.match(text, /auth_init \/ auth_state_timeout/);
  assert.match(text, /firebase_auth:auth_state_never_fired/);
  assert.match(text, /ios 1\.0\.0 \(5be3511\)/);
  assert.equal(diagnosticsText([]), "기록이 없습니다.");
});

test("계정을 지우면 진단도 걷는다", () => {
  assert.ok(DEVICE_KEYS.includes(DIAGNOSTIC_KEY));
});
