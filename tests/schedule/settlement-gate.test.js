import assert from "node:assert/strict";
import test from "node:test";
import {
  SETTLEMENT_GATE, blocksSettlement, buildNumberOf, minBuildFor, settlementGate,
} from "../../src/features/schedule/settlement-gate.js";

const config = (minBuilds) => ({ minBuilds });

test("빌드가 최소보다 낮으면 막는다", () => {
  const gate = settlementGate({ platform: "android", build: "62", config: config({ android: 64 }) });
  assert.equal(gate.state, SETTLEMENT_GATE.OUTDATED);
  assert.equal(gate.build, 62);
  assert.equal(gate.minBuild, 64);
  assert.equal(blocksSettlement(gate), true);
});

test("같거나 높으면 통과한다", () => {
  for (const build of ["64", "65", "1200"]) {
    const gate = settlementGate({ platform: "android", build, config: config({ android: 64 }) });
    assert.equal(gate.state, SETTLEMENT_GATE.ALLOWED, build);
  }
});

test("플랫폼마다 따로 센다 -- versionCode 와 CFBundleVersion 은 다른 수열이다", () => {
  /* 하나로 두면 한쪽을 막으려다 다른 쪽을 통째로 막거나, 막아야 할 쪽을 놓친다. */
  const both = config({ android: 64, ios: 12 });
  assert.equal(settlementGate({ platform: "ios", build: "12", config: both }).state, SETTLEMENT_GATE.ALLOWED);
  assert.equal(settlementGate({ platform: "android", build: "12", config: both }).state, SETTLEMENT_GATE.OUTDATED);
  // 설정에 없는 플랫폼은 막을 근거가 없다.
  assert.equal(settlementGate({ platform: "web", build: "1", config: both }).state, SETTLEMENT_GATE.ALLOWED);
});

test("설정을 못 읽으면 막지 않는다 -- 열어 두고 실패한다", () => {
  /* 네트워크가 흔들렸다고 센터 전체가 확정을 못 하게 되는 쪽이, 한 번 더
     옛 규칙으로 차감되는 쪽보다 나쁘다. 진짜 차단은 규칙이 한다. */
  for (const broken of [null, undefined, {}, { minBuilds: null }, { minBuilds: {} }, "nope"]) {
    const gate = settlementGate({ platform: "android", build: "1", config: broken });
    assert.equal(gate.state, SETTLEMENT_GATE.ALLOWED, JSON.stringify(broken));
  }
});

test("빌드 번호를 못 읽으면 막지 않는다 -- 0 으로 바꾸지 않는다", () => {
  /* 0 으로 바꾸면 "읽지 못했다" 가 "아주 낮은 빌드" 가 되어, 번호를 못 읽는
     기기가 전부 차단된다. */
  for (const unreadable of ["", null, undefined, "1.1.30 (64)", "64a", "-3", {}]) {
    assert.equal(buildNumberOf(unreadable), null, JSON.stringify(unreadable));
    const gate = settlementGate({ platform: "android", build: unreadable, config: config({ android: 64 }) });
    assert.equal(gate.state, SETTLEMENT_GATE.ALLOWED, JSON.stringify(unreadable));
  }
});

test("숫자만 받는다 -- 라벨을 여기서 쪼개지 않는다", () => {
  assert.equal(buildNumberOf("64"), 64);
  assert.equal(buildNumberOf(" 64 "), 64);
  assert.equal(buildNumberOf(64), 64);
  assert.equal(buildNumberOf("0"), 0);
});

test("설정의 최소값도 같은 규칙으로 읽는다", () => {
  assert.equal(minBuildFor(config({ android: "64" }), "android"), 64);
  assert.equal(minBuildFor(config({ android: "일흔" }), "android"), null);
  assert.equal(minBuildFor(config({ ANDROID: 64 }), "android"), null, "키는 소문자다");
  assert.equal(minBuildFor(config({ android: 64 }), "ANDROID"), 64, "플랫폼 이름은 대소문자를 가리지 않는다");
});
