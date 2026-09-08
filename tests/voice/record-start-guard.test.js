import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appSource = () => readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
const starter = async () => {
  const source = await appSource();
  const start = source.indexOf("const startServerRecording = async (mode = \"append\", options = {}) => {");
  return source.slice(start, source.indexOf("const start = async (options = {}) => {", start));
};

/* The guard that stops a second recording from starting on top of the first
   also stops every recording after a failure that leaves it raised.

   A consent check that throws does exactly that: the throw sits above the try
   that would have cleared it, so 다시 녹음 returns at the first line -- no
   recording, no message, nothing to see. Reopening the screen was the only
   way out.

   The flag is modelled here as the component holds it: raised before the work,
   and lowered by whatever unwinds the call. */

function recorder({ consentThrows = false, startThrows = false } = {}) {
  const state = { flag: false, starting: false, on: false, finishing: false, attempts: 0, recordings: 0 };
  const faults = { consentThrows, startThrows };

  async function body() {
    if (faults.consentThrows) throw Object.assign(new Error("consent check failed"), { code: "consent_check_failed" });
    if (faults.startThrows) throw Object.assign(new Error("recorder busy"), { code: "audio_record_start_failed" });
    // The success path lowers the flag itself and turns the recording on.
    state.flag = false;
    state.starting = false;
    state.on = true;
    state.recordings += 1;
  }

  return {
    state,
    faults,
    async start() {
      if (state.flag || state.on || state.finishing) return "blocked";
      state.attempts += 1;
      state.flag = true;
      state.starting = true;
      try {
        await body();
        return "started";
      } finally {
        state.flag = false;
        state.starting = false;
      }
    },
  };
}

/* --------------------- the reported way of getting stuck ---------------- */

test("a consent check that throws still lowers the flag", async () => {
  const tape = recorder({ consentThrows: true });
  await assert.rejects(() => tape.start(), /consent check failed/);
  assert.equal(tape.state.flag, false, "raised flag would silently block every later attempt");
  assert.equal(tape.state.starting, false, "and the button would sit in its preparing state");
});

test("the next tap on the same screen is not swallowed", async () => {
  /* The condition reported: after one failure, 다시 녹음 does nothing at all.
     Same component, same flag -- only the fault is gone. */
  const tape = recorder({ consentThrows: true });
  await assert.rejects(() => tape.start());
  tape.faults.consentThrows = false;
  assert.equal(await tape.start(), "started", "a raised flag would have returned 'blocked'");
  assert.equal(tape.state.recordings, 1);
  assert.equal(tape.state.attempts, 2, "both taps were let through the guard");
});

test("repeated failures do not accumulate into a lockout", async () => {
  const tape = recorder({ consentThrows: true });
  for (let attempt = 0; attempt < 3; attempt += 1) await assert.rejects(() => tape.start());
  tape.faults.consentThrows = false;
  assert.equal(await tape.start(), "started");
});

test("a failure inside the recorder start also lowers it", async () => {
  /* That path had a catch of its own, and it must keep working -- the wrapper
     is an addition, not a replacement. */
  const tape = recorder({ startThrows: true });
  await assert.rejects(() => tape.start());
  assert.equal(tape.state.flag, false);
  tape.faults.startThrows = false;
  assert.equal(await tape.start(), "started");
});

/* ------------------------ what must still be blocked -------------------- */

test("a recording already running still blocks a second start", async () => {
  const tape = recorder();
  assert.equal(await tape.start(), "started");
  assert.equal(tape.state.on, true);
  assert.equal(await tape.start(), "blocked", "the flag is down but the recording is up");
  assert.equal(tape.state.recordings, 1);
});

test("a recording being finished still blocks a start", async () => {
  const tape = recorder();
  tape.state.finishing = true;
  assert.equal(await tape.start(), "blocked");
  assert.equal(tape.state.attempts, 0);
});

test("the success path leaves the flag down and the recording on", async () => {
  const tape = recorder();
  await tape.start();
  assert.equal(tape.state.flag, false);
  assert.equal(tape.state.starting, false);
  assert.equal(tape.state.on, true);
});

/* ------------------------------ the wiring ------------------------------ */

test("the body runs inside a try with a finally that clears the flag", async () => {
  const source = await starter();
  assert.match(source, /try \{\s*\r?\n\s*await startServerRecordingBody\(mode, options\);\s*\r?\n\s*\} finally \{\s*\r?\n\s*startRequestRef\.current = false;\s*\r?\n\s*setStarting\(false\);\s*\r?\n\s*\}/);
});

test("the guard itself is unchanged", async () => {
  const source = await starter();
  assert.match(source, /if \(startRequestRef\.current \|\| on \|\| finishing\) return;/);
  assert.match(source, /startRequestRef\.current = true;/);
});

test("the consent throw is still a throw, and the logic around it untouched", async () => {
  const source = await appSource();
  /* Only the flag handling was in scope. The consent decision, its diagnostic
     and the sheet it opens stay exactly as they were. */
  assert.match(source, /voiceDiagnostic\("voice_pipeline_failed", \{\s*\r?\n\s*source: "server_audio", stage: "consent", code: error\?\.code \|\| "consent_check_failed",/);
  assert.match(source, /presentVoiceConsent\(\(\) => startServerRecording\(mode, \{ skipConsent: true \}\), consent\.message\);/);
});

test("the approved-consent retry can get back in", async () => {
  const source = await appSource();
  /* It is called from a sheet callback, after the outer finally has run, so
     the guard lets it through. */
  const body = source.slice(source.indexOf("const startServerRecordingBody"), source.indexOf("const start = async (options = {}) => {"));
  assert.ok(body.indexOf("startRequestRef.current = false;") < body.indexOf("presentVoiceConsent("),
    "the consent-declined path lowers the flag before opening the sheet");
});
