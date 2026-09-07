import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { appendVoiceSessionDiagnostic, readVoiceSessionDiagnostics } from "../../src/features/voice/voice-session.js";

const appSource = () => readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");

function memoryStorage() {
  const cells = new Map();
  return {
    getItem: (key) => (cells.has(key) ? cells.get(key) : null),
    setItem: (key, value) => cells.set(key, String(value)),
  };
}

/* appendVoiceSessionDiagnostic drops any event name it does not know, and the
   on-device diagnostics screen renders nothing but what it stored. A stage that
   is logged but unregistered therefore looks like working instrumentation while
   leaving no trace on the handset, which is the failure this guards. */
test("every camera and motion stage the app logs is actually recorded", async () => {
  const source = await appSource();
  const stages = new Set(
    [...source.matchAll(/(?:cameraPipelineLog|motionLog|appendVoiceSessionDiagnostic)\(\s*"([a-z0-9_]+)"/g)]
      .map((match) => match[1]),
  );

  assert.ok(stages.size > 10, `expected the camera pipeline to log many stages, found ${stages.size}`);

  const dropped = [...stages].filter((stage) => appendVoiceSessionDiagnostic(stage, { source: "test" }, memoryStorage()) === null);
  assert.deepEqual(dropped, [], "these stages never reach the device diagnostics screen");
});

test("the five motion failures stay distinguishable by stage and code", async () => {
  const source = await appSource();

  // One entry per failure kind, each carrying its own code and error domain.
  const required = [
    { stage: "motion_unsupported", code: "device_orientation_unavailable", domain: "web_api" },
    { stage: "motion_permission_denied", domain: "device_orientation_permission" },
    { stage: "motion_listener_failed", domain: "capacitor_plugin" },
    { stage: "motion_reading_timeout", code: "no_orientation_event", domain: "web_api" },
    { stage: "motion_listener_remove_failed", domain: "capacitor_plugin" },
  ];

  for (const { stage, code, domain } of required) {
    assert.ok(source.includes(`"${stage}"`), `${stage} is never logged`);
    if (code) assert.ok(source.includes(`"${code}"`), `${stage} has no distinct code`);
    assert.ok(source.includes(`"${domain}"`), `${stage} records no error domain`);

    const entry = appendVoiceSessionDiagnostic(stage, {
      source: "device_motion", code: code || "raw_original_code", domain,
    }, memoryStorage());
    assert.ok(entry, `${stage} is dropped before it reaches diagnostics`);
    assert.equal(entry.domain, domain, `${stage} loses its error domain`);
  }

  // Distinct stages, so two different causes cannot collapse into one line.
  assert.equal(new Set(required.map((item) => item.stage)).size, required.length);
});

test("a stalled feed is told apart from an unusable payload in the log itself", () => {
  const storage = memoryStorage();

  // Events never arrived.
  appendVoiceSessionDiagnostic("motion_reading_timeout", {
    source: "device_motion", code: "no_orientation_event", domain: "web_api",
    receivedEvents: 0, invalidEvents: 0,
  }, storage);
  // Events arrived and every payload was unusable.
  appendVoiceSessionDiagnostic("motion_reading_invalid", {
    source: "device_motion", code: "non_finite_orientation", domain: "web_api",
    reason: "beta:null gamma:finite", receivedEvents: 12, invalidEvents: 12,
  }, storage);
  // Events arrived, were fine, then stopped.
  appendVoiceSessionDiagnostic("motion_reading_stalled", {
    source: "device_motion", code: "orientation_event_stalled", domain: "web_api",
    receivedEvents: 40, invalidEvents: 0, elapsedMs: 1400,
  }, storage);

  const [stalled, invalid, timeout] = readVoiceSessionDiagnostics(storage);

  assert.equal(timeout.receivedEvents, 0, "nothing arrived");
  assert.equal(timeout.code, "no_orientation_event");

  assert.ok(invalid.receivedEvents > 0, "events did arrive");
  assert.equal(invalid.invalidEvents, invalid.receivedEvents, "and none of them were usable");
  assert.match(invalid.reason, /beta:null/, "the log names which field was missing");

  assert.ok(stalled.receivedEvents > 0 && stalled.invalidEvents === 0, "good events, then silence");
  assert.ok(stalled.elapsedMs > 0, "the log says how long the feed has been quiet");

  // The three causes carry three different codes.
  assert.equal(new Set([timeout.code, invalid.code, stalled.code]).size, 3);
});

test("the diagnostic payload keeps the original error code instead of a message match", async () => {
  const source = await appSource();

  // rawErrorIdentity preserves code, then name, and never inspects the message.
  assert.match(source, /code: error\?\.code \?\? error\?\.name \?\? "unknown"/);
  assert.match(source, /causeName: error\?\.name/);
  assert.match(source, /causeMessage: error\?\.message/);

  // The legacy message match is recorded as a separate reason, so it cannot
  // stand in for the code.
  assert.match(source, /reason: denied \? "ui_classified_denied_by_message_match" : "ui_classified_error"/);

  const entry = appendVoiceSessionDiagnostic("motion_listener_failed", {
    source: "device_motion", domain: "capacitor_plugin",
    code: "UNIMPLEMENTED", causeName: "CapacitorException",
    causeMessage: "Motion does not have web implementation.",
    reason: "ui_classified_error",
  }, memoryStorage());

  assert.equal(entry.code, "UNIMPLEMENTED", "the original plugin code survives");
  assert.equal(entry.causeName, "CapacitorException");
  assert.match(entry.causeMessage, /web implementation/, "the original wording survives");
});

test("no personal or credential data is carried on a motion diagnostic", async () => {
  const source = await appSource();
  const motionLogBody = /const motionLog = useCallback\(\(stage, details = \{\}\) => \{([\s\S]*?)\}, \[/.exec(source);
  assert.ok(motionLogBody, "motionLog is not where the test expects it");

  for (const banned of ["token", "nonce", "credential", "identityToken", "authorizationCode", "password", "email", "phone"]) {
    assert.doesNotMatch(motionLogBody[1], new RegExp(banned, "i"), `motion diagnostics must not carry ${banned}`);
  }
});
