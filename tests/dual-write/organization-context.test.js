import assert from "node:assert/strict";
import test from "node:test";
import {
  ORGANIZATION_LOOKUP_TIMEOUT_MS, UNRESOLVED_ORGANIZATION_CONTEXT, readyOrganizationContext,
  resolveOrganizationContext, userIdFingerprint,
} from "../../src/data/repositories/organization-context.js";

const membership = (overrides = {}) => ({
  organizationId: "center-a",
  userId: "user-1",
  role: "instructor",
  status: "active",
  ...overrides,
});

test("an active membership decides the organization and the role", async () => {
  const context = await resolveOrganizationContext("user-1", {
    listActiveMemberships: async (userId) => {
      assert.equal(userId, "user-1");
      return [membership()];
    },
  });
  assert.deepEqual(context, {
    organizationId: "center-a",
    role: "instructor",
    status: "active",
    displayName: "",
    isDeputyDirector: false,
    isLegacy: false,
  });
});

test("the deputy flag travels with the context, so a deduction never has to fetch it", async () => {
  /* 차감할 때 급여 판정 1 이 이 값을 본다. 로그인할 때 이미 읽은 문서에 들어
     있으므로 수업이 끝난 자리에서 누르는 버튼에 왕복이 붙지 않는다. */
  const deputy = await resolveOrganizationContext("user-1", {
    listActiveMemberships: async () => [membership({ isDeputyDirector: true })],
  });
  assert.equal(deputy.isDeputyDirector, true);

  // 지정받은 사람만이다. 값이 없거나 boolean 이 아니면 부원장이 아니다.
  for (const value of [undefined, null, "true", 1]) {
    const other = await resolveOrganizationContext("user-1", {
      listActiveMemberships: async () => [membership({ isDeputyDirector: value })],
    });
    assert.equal(other.isDeputyDirector, false, JSON.stringify(value));
  }
});

test("no membership falls back to the legacy single-instructor organization", async () => {
  const context = await resolveOrganizationContext("user-1", {
    listActiveMemberships: async () => [],
  });
  assert.equal(context.organizationId, "legacy_user-1");
  assert.equal(context.role, "owner");
  assert.equal(context.isLegacy, true);
});

test("a reader that was never supplied is treated as no membership", async () => {
  const context = await resolveOrganizationContext("user-1");
  assert.equal(context.isLegacy, true);
  assert.equal(context.organizationId, "legacy_user-1");
});

test("a membership that is not active is ignored", async () => {
  for (const status of ["invited", "suspended", "revoked"]) {
    const context = await resolveOrganizationContext("user-1", {
      listActiveMemberships: async () => [membership({ status })],
    });
    assert.equal(context.isLegacy, true, `${status} must not become a membership`);
    assert.equal(context.organizationId, "legacy_user-1");
  }
});

test("several memberships take the first one and leave a warning", async () => {
  const warnings = [];
  const context = await resolveOrganizationContext("user-1", {
    listActiveMemberships: async () => [
      membership({ organizationId: "center-a" }),
      membership({ organizationId: "center-b" }),
    ],
    warn: (code, detail) => warnings.push({ code, detail }),
  });
  assert.equal(context.organizationId, "center-a");
  assert.equal(context.isLegacy, false);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].code, "organization_context_multiple_memberships");
  assert.equal(warnings[0].detail.membershipCount, 2);
  assert.equal(warnings[0].detail.selectedOrganizationId, "center-a");
});

test("a single membership leaves no warning", async () => {
  const warnings = [];
  await resolveOrganizationContext("user-1", {
    listActiveMemberships: async () => [membership()],
    warn: (code) => warnings.push(code),
  });
  assert.deepEqual(warnings, []);
});

test("a membership without a role is treated as a plain member", async () => {
  const context = await resolveOrganizationContext("user-1", {
    listActiveMemberships: async () => [membership({ role: undefined })],
  });
  assert.equal(context.role, "member");
});

test("a missing userId is refused before anything is read", async () => {
  let reads = 0;
  await assert.rejects(
    () => resolveOrganizationContext("", { listActiveMemberships: async () => { reads += 1; return []; } }),
    /Missing userId/,
  );
  assert.equal(reads, 0);
});

test("a lookup failure is kept apart from having no membership", async () => {
  const warnings = [];
  const context = await resolveOrganizationContext("user-1", {
    listActiveMemberships: async () => { throw Object.assign(new Error("offline"), { code: "unavailable" }); },
    warn: (code, detail) => warnings.push({ code, detail }),
  });
  assert.equal(context.status, "unknown");
  assert.equal(context.isLegacy, false);
  assert.equal(context.organizationId, "");
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].code, "organization_context_lookup_failed");
  assert.equal(warnings[0].detail.errorCode, "unavailable");
  assert.equal(warnings[0].detail.errorDomain, "firestore");
});

test("ready marks a resolved context and the unresolved one stays not ready", async () => {
  assert.equal(UNRESOLVED_ORGANIZATION_CONTEXT.ready, false);
  assert.equal(UNRESOLVED_ORGANIZATION_CONTEXT.isLegacy, false);
  const resolved = await resolveOrganizationContext("user-1", {
    listActiveMemberships: async () => [membership()],
  });
  const ready = readyOrganizationContext(resolved);
  assert.equal(ready.ready, true);
  assert.equal(ready.organizationId, "center-a");
  assert.equal(ready.role, "instructor");
});

test("signing out returns to the unresolved context", () => {
  const signedIn = readyOrganizationContext({ organizationId: "center-a", role: "owner", status: "active", isLegacy: false });
  assert.equal(signedIn.ready, true);
  const signedOut = UNRESOLVED_ORGANIZATION_CONTEXT;
  assert.equal(signedOut.ready, false);
  assert.equal(signedOut.organizationId, "");
  assert.equal(signedOut.role, "");
});

test("a legacy context is ready and says so, which unknown never does", async () => {
  const legacy = readyOrganizationContext(await resolveOrganizationContext("user-1", { listActiveMemberships: async () => [] }));
  const unknown = readyOrganizationContext(await resolveOrganizationContext("user-1", {
    listActiveMemberships: async () => { throw new Error("offline"); },
  }));
  assert.equal(legacy.ready, true);
  assert.equal(legacy.isLegacy, true);
  assert.equal(unknown.ready, true);
  assert.equal(unknown.isLegacy, false);
  assert.equal(unknown.status, "unknown");
  assert.notEqual(legacy.organizationId, unknown.organizationId);
});

/* 아래는 §1 "실패를 하나의 문구로 뭉개지 않는다"를 조회 자체에 적용한 것이다.
   조회가 정상이었던 경우와 조회가 아예 없었던 경우가 로그에서 같아 보이면,
   소속이 안 잡힐 때 어느 쪽인지 판정할 수 없다. */

test("a lookup announces that it started, whatever the outcome", async () => {
  for (const listActiveMemberships of [
    async () => [membership()],
    async () => [],
    async () => { throw new Error("offline"); },
  ]) {
    const logs = [];
    await resolveOrganizationContext("user-1", { listActiveMemberships, log: (code, detail) => logs.push({ code, detail }) });
    assert.equal(logs[0].code, "organization_context_lookup_started");
    assert.equal(logs[0].detail.feature, "organization_context");
    assert.equal(logs[0].detail.source, "reader");
  }
});

test("a lookup without a reader says so instead of looking silent", async () => {
  const logs = [];
  await resolveOrganizationContext("user-1", { log: (code, detail) => logs.push({ code, detail }) });
  assert.equal(logs[0].detail.source, "none");
});

test("every outcome is announced with the state that produced it", async () => {
  const outcomes = [
    { read: async () => [membership({ role: "owner" })], state: "membership", expected: { role: "owner", isLegacy: false, membershipCount: 1, selectedOrganizationId: "center-a" } },
    { read: async () => [], state: "legacy", expected: { role: "owner", isLegacy: true, membershipCount: 0 } },
    { read: async () => { throw Object.assign(new Error("offline"), { code: "unavailable" }); }, state: "unknown", expected: { role: "", isLegacy: false, errorDomain: "firestore", errorCode: "unavailable" } },
  ];
  for (const { read: listActiveMemberships, state, expected } of outcomes) {
    const logs = [];
    await resolveOrganizationContext("user-1", { listActiveMemberships, log: (code, detail) => logs.push({ code, detail }) });
    const done = logs.find((entry) => entry.code === "organization_context_resolved");
    assert.ok(done, `${state} must announce its outcome`);
    assert.equal(done.detail.state, state);
    assert.equal(done.detail.feature, "organization_context");
    for (const [key, value] of Object.entries(expected)) assert.equal(done.detail[key], value, `${state}.${key}`);
  }
});

test("the happy path still leaves no warning, only a log", async () => {
  const warnings = [];
  const logs = [];
  await resolveOrganizationContext("user-1", {
    listActiveMemberships: async () => [membership()],
    warn: (code) => warnings.push(code),
    log: (code) => logs.push(code),
  });
  assert.deepEqual(warnings, []);
  assert.deepEqual(logs, ["organization_context_lookup_started", "organization_context_resolved"]);
});

test("a refused userId is loud, not a silent absence of logs", async () => {
  const logs = [];
  await assert.rejects(
    () => resolveOrganizationContext("", { log: (code) => logs.push(code) }),
    /Missing userId/,
  );
  // 여기서 로그가 없는 것이 정상이다 -- 그래서 호출 지점 도달 여부는
  // App.jsx 의 organization_context_requested 가 따로 남긴다.
  assert.deepEqual(logs, []);
});

/* "서버가 0건을 돌려줬다"와 "서버는 맞췄는데 클라이언트 필터가 버렸다"는
   둘 다 legacy 로 끝난다. 구분되지 않으면 쿼리를 볼지 데이터를 볼지 정할 수
   없다 -- 같은 화면·같은 로그에 다른 원인이 뭉개지는 §1 위반이다. */

test("legacy says whether the server returned nothing or the filter dropped it", async () => {
  const cases = [
    { read: async () => [], count: 0, reason: "no_match" },
    { read: async () => [membership({ status: "invited" })], count: 1, reason: "status_not_active" },
    { read: async () => [membership({ organizationId: "" })], count: 1, reason: "organization_id_missing" },
  ];
  for (const { read, count, reason } of cases) {
    const logs = [];
    const context = await resolveOrganizationContext("user-1", {
      listActiveMemberships: read,
      log: (code, detail) => logs.push({ code, detail }),
    });
    assert.equal(context.isLegacy, true);
    const done = logs.find((entry) => entry.code === "organization_context_resolved");
    assert.equal(done.detail.count, count, `raw count for ${reason}`);
    assert.equal(done.detail.membershipCount, 0);
    assert.equal(done.detail.reason, reason);
  }
});

test("a resolved membership reports the raw count alongside the kept one", async () => {
  const logs = [];
  await resolveOrganizationContext("user-1", {
    listActiveMemberships: async () => [membership(), membership({ status: "revoked" })],
    log: (code, detail) => logs.push({ code, detail }),
  });
  const done = logs.find((entry) => entry.code === "organization_context_resolved");
  assert.equal(done.detail.count, 2);
  assert.equal(done.detail.membershipCount, 1);
});

/* uid 지문. 세션이 실제로 쓴 계정과 콘솔에서 본 계정이 같은지를 값 없이
   가른다 -- 원본 uid 는 남기지 않는다 (§7). */

test("the fingerprint pins a uid without recording it", () => {
  const print = userIdFingerprint("CgArUW7A8OdFm0VFhyitRWyucOq2");
  assert.deepEqual(print, { uidLength: 28, uidPrefix: "CgAr", uidSuffix: "cOq2" });
  // 원본은 어느 필드에도 남지 않는다.
  for (const value of Object.values(print)) {
    assert.notEqual(value, "CgArUW7A8OdFm0VFhyitRWyucOq2");
  }
  assert.ok(print.uidPrefix.length + print.uidSuffix.length < print.uidLength);
});

test("the fingerprint survives an absent uid instead of throwing", () => {
  assert.deepEqual(userIdFingerprint(""), { uidLength: 0, uidPrefix: "", uidSuffix: "" });
  assert.deepEqual(userIdFingerprint(undefined), { uidLength: 0, uidPrefix: "", uidSuffix: "" });
});

test("the lookup carries the fingerprint so the session uid is identifiable", async () => {
  const logs = [];
  await resolveOrganizationContext("CgArUW7A8OdFm0VFhyitRWyucOq2", {
    listActiveMemberships: async () => [],
    log: (code, detail) => logs.push({ code, detail }),
  });
  const started = logs.find((entry) => entry.code === "organization_context_lookup_started");
  assert.equal(started.detail.uidLength, 28);
  assert.equal(started.detail.uidPrefix, "CgAr");
  assert.equal(started.detail.uidSuffix, "cOq2");
});

/* ready:false 에는 출구가 없다 -- 메뉴도 배너도 재시도도 그 상태에서는 안
   보인다. 답이 오지 않는 조회를 끝없이 기다리면 사용자는 아무것도 일어나지
   않는 화면에 갇힌다. 시간 안에 못 읽으면 unknown 으로 확정해 [다시 시도]를
   준다 -- 못 읽은 것을 개인 모드로 확정하는 것보다 낫고, 침묵보다 낫다. */

const fakeTimers = () => {
  const pending = new Map();
  let nextId = 1;
  return {
    setTimer: (fn, ms) => { const id = nextId++; pending.set(id, { fn, ms }); return id; },
    clearTimer: (id) => { pending.delete(id); },
    fire: () => { for (const [id, entry] of [...pending]) { pending.delete(id); entry.fn(); } },
    get size() { return pending.size; },
  };
};

test("a lookup that never answers becomes unknown, not a silent wait", async () => {
  const timers = fakeTimers();
  const warnings = [];
  const pending = resolveOrganizationContext("user-1", {
    listActiveMemberships: () => new Promise(() => {}),
    warn: (code, detail) => warnings.push({ code, detail }),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  timers.fire();
  const context = await pending;
  assert.equal(context.status, "unknown");
  assert.equal(context.isLegacy, false, "못 읽은 것을 개인 모드로 확정하면 안 된다");
  assert.equal(readyOrganizationContext(context).ready, true, "ready 여야 배너와 재시도가 보인다");
  assert.equal(warnings[0].code, "organization_context_lookup_failed");
  assert.equal(warnings[0].detail.errorCode, "lookup_timeout");
});

test("a timeout is attributed to this layer, not to Firestore", async () => {
  const timers = fakeTimers();
  const logs = [];
  const pending = resolveOrganizationContext("user-1", {
    listActiveMemberships: () => new Promise(() => {}),
    log: (code, detail) => logs.push({ code, detail }),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  timers.fire();
  await pending;
  const done = logs.find((entry) => entry.code === "organization_context_resolved");
  assert.equal(done.detail.errorDomain, "organization_context");
  assert.equal(done.detail.errorCode, "lookup_timeout");
});

test("a Firestore failure keeps its own domain and original code", async () => {
  const logs = [];
  await resolveOrganizationContext("user-1", {
    listActiveMemberships: async () => { throw Object.assign(new Error("offline"), { code: "unavailable" }); },
    log: (code, detail) => logs.push({ code, detail }),
  });
  const done = logs.find((entry) => entry.code === "organization_context_resolved");
  assert.equal(done.detail.errorDomain, "firestore");
  assert.equal(done.detail.errorCode, "unavailable", "원본 코드를 시간 초과로 덮어쓰면 안 된다");
});

test("an answer inside the deadline clears the timer and resolves normally", async () => {
  const timers = fakeTimers();
  const context = await resolveOrganizationContext("user-1", {
    listActiveMemberships: async () => [membership()],
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  assert.equal(context.organizationId, "center-a");
  assert.equal(timers.size, 0, "타이머를 남기면 테스트도 앱도 붙잡힌다");
});

test("a thrown reader is caught even when it throws synchronously", async () => {
  const context = await resolveOrganizationContext("user-1", {
    listActiveMemberships: () => { throw Object.assign(new Error("boom"), { code: "internal" }); },
  });
  assert.equal(context.status, "unknown");
  assert.equal(context.isLegacy, false);
});

test("the deadline is a real number of milliseconds", () => {
  assert.ok(Number.isFinite(ORGANIZATION_LOOKUP_TIMEOUT_MS));
  assert.ok(ORGANIZATION_LOOKUP_TIMEOUT_MS > 0);
});

/* membership 에 적힌 이름을 함께 싣는다. 대표가 강사 목록에서 uid 가 아니라
   이름을 보게 하는 경로이고, users/{uid} 를 열지 않고 그렇게 하기 위해서다. */

test("the membership name rides along with the context", async () => {
  const context = await resolveOrganizationContext("user-1", {
    listActiveMemberships: async () => [membership({ displayName: "정예진" })],
  });
  assert.equal(context.displayName, "정예진");
});

test("a membership with no name says so with an empty string, not undefined", async () => {
  // 화면이 이름 없음을 uid 로 대체하려면 값이 있어야 한다.
  const context = await resolveOrganizationContext("user-1", {
    listActiveMemberships: async () => [membership()],
  });
  assert.equal(context.displayName, "");
});

test("legacy and unknown carry no name", async () => {
  const legacy = await resolveOrganizationContext("user-1", { listActiveMemberships: async () => [] });
  assert.equal(readyOrganizationContext(legacy).displayName, "");
  const unknown = await resolveOrganizationContext("user-1", {
    listActiveMemberships: async () => { throw new Error("offline"); },
  });
  assert.equal(readyOrganizationContext(unknown).displayName, "");
});
