import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  LEVEL_RELEASE_THRESHOLD_DEG,
  LEVEL_THRESHOLD_DEG,
  LEVEL_TONES,
  LEVEL_TONE_COLORS,
  PITCH_LEVEL_THRESHOLD_DEG,
  PITCH_RELEASE_THRESHOLD_DEG,
  SENSOR_STATUSES,
  evaluateDeviceLevel,
  resolveLevelTone,
} from "../../src/features/posture/posture-camera.js";

const appSource = () => readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");

const OUT_ROLL = LEVEL_THRESHOLD_DEG + 6;    // 12 deg, clearly past 6
const IN_ROLL = LEVEL_THRESHOLD_DEG - 4;     // 2 deg
const OUT_PITCH = PITCH_LEVEL_THRESHOLD_DEG + 8; // 23 deg, clearly past 15
const IN_PITCH = PITCH_LEVEL_THRESHOLD_DEG - 5;  // 10 deg

const read = (roll, pitch) => evaluateDeviceLevel({ roll, pitch });
const toneOf = (roll, pitch) => resolveLevelTone(read(roll, pitch));

/* --------------- the four states the instructor moves through ----------- */

test("both axes out: red, and pitch is what the coach asks for first", () => {
  const state = read(OUT_ROLL, OUT_PITCH);
  assert.equal(toneOf(OUT_ROLL, OUT_PITCH), LEVEL_TONES.red);
  assert.equal(state.rollLevel, false);
  assert.equal(state.pitchLevel, false);
  /* Correcting roll first changes nothing visible while pitch is still out,
     which is what made the guidance look wrong on the device. */
  assert.match(state.code, /^tilted_(forward|backward)$/, "pitch must be coached before roll");
  assert.match(state.message, /휴대폰 상단을/);
});

test("pitch fixed, roll still out: amber, and now the coach asks for roll", () => {
  const state = read(OUT_ROLL, IN_PITCH);
  assert.equal(toneOf(OUT_ROLL, IN_PITCH), LEVEL_TONES.amber, "one axis in range must show progress");
  assert.equal(state.pitchLevel, true);
  assert.equal(state.rollLevel, false);
  assert.match(state.code, /^tilted_(left|right)$/);
  assert.match(state.message, /휴대폰을 (왼쪽|오른쪽)으로/);
});

test("roll fixed, pitch still out: amber, and the coach still asks for pitch", () => {
  const state = read(IN_ROLL, OUT_PITCH);
  assert.equal(toneOf(IN_ROLL, OUT_PITCH), LEVEL_TONES.amber);
  assert.equal(state.rollLevel, true);
  assert.equal(state.pitchLevel, false);
  assert.match(state.code, /^tilted_(forward|backward)$/);
});

test("both axes in: green", () => {
  const state = read(IN_ROLL, IN_PITCH);
  assert.equal(toneOf(IN_ROLL, IN_PITCH), LEVEL_TONES.green);
  assert.equal(state.isLevel, true);
  assert.equal(state.code, "level");
});

/* ------------------ the colour always matches the axes ------------------ */

test("the tone matches the axis state across the whole range", () => {
  for (let roll = -20; roll <= 20; roll += 1) {
    for (let pitch = -30; pitch <= 30; pitch += 2) {
      const state = read(roll, pitch);
      const tone = resolveLevelTone(state);
      const matched = (state.rollLevel ? 1 : 0) + (state.pitchLevel ? 1 : 0);
      if (matched === 2) {
        assert.equal(tone, LEVEL_TONES.green, `${roll}/${pitch}: both axes in range must be green`);
      } else if (matched === 1) {
        assert.equal(tone, LEVEL_TONES.amber, `${roll}/${pitch}: one axis in range must be amber`);
      } else {
        assert.equal(tone, LEVEL_TONES.red, `${roll}/${pitch}: neither axis in range must be red`);
      }
    }
  }
});

test("a red frame never carries a roll instruction", () => {
  // Red means both axes are out, so the instruction must be the pitch one.
  for (let roll = -20; roll <= 20; roll += 1) {
    for (let pitch = -30; pitch <= 30; pitch += 2) {
      const state = read(roll, pitch);
      if (resolveLevelTone(state) !== LEVEL_TONES.red) continue;
      assert.match(state.code, /^tilted_(forward|backward)$/, `${roll}/${pitch} asked for roll while both axes were out`);
    }
  }
});

test("dwell holds amber rather than dropping back to red", () => {
  /* A gate can report not-level while both axes sit in range, because the dwell
     timer is still running. Falling to red for 400ms right before green would
     read as the correction being undone. */
  const dwelling = evaluateDeviceLevel({ roll: IN_ROLL, pitch: IN_PITCH, level: false });
  assert.equal(dwelling.isLevel, false);
  assert.equal(dwelling.rollLevel, true);
  assert.equal(dwelling.pitchLevel, true);
  assert.equal(resolveLevelTone(dwelling), LEVEL_TONES.amber);
});

test("a sensor that is not reporting shows red, not partial progress", () => {
  for (const status of [SENSOR_STATUSES.loading, SENSOR_STATUSES.unavailable, SENSOR_STATUSES.stale, SENSOR_STATUSES.denied]) {
    const state = evaluateDeviceLevel({ status });
    assert.equal(state.rollLevel, false);
    assert.equal(state.pitchLevel, false);
    assert.equal(resolveLevelTone(state), LEVEL_TONES.red, `${status} must not look like progress`);
  }
});

/* ------------------------------- wiring --------------------------------- */

test("the thresholds this coaching depends on are unchanged", () => {
  assert.equal(LEVEL_THRESHOLD_DEG, 6);
  assert.equal(LEVEL_RELEASE_THRESHOLD_DEG, 8);
  assert.equal(PITCH_LEVEL_THRESHOLD_DEG, 15);
  assert.equal(PITCH_RELEASE_THRESHOLD_DEG, 20);
});

test("the frame reads its colour from the shared rule", async () => {
  const source = await appSource();
  assert.match(source, /const frameColor = LEVEL_TONE_COLORS\[resolveLevelTone\(sensor\)\]/);
  // The amber already in the palette is reused rather than a fourth colour added.
  assert.equal(LEVEL_TONE_COLORS.amber, "#F2B84B");
  assert.equal(LEVEL_TONE_COLORS.green, "#63D7A3");
  assert.equal(LEVEL_TONE_COLORS.red, "#FF6B6B");
  // Still one coach line, and still a 180ms transition.
  assert.match(source, /transition: "border-color 180ms ease"/);
  assert.match(source, /\{sensor\.isLevel \? directionGuide : sensor\.message\}/);
});
