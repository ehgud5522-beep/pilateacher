import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { advanceManualCorrection } from "../../src/features/posture/posture-model.js";

const appSource = () => readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");

// Picking 골반 in the correction sheet yields the left/right pair -- the "1 / 2"
// the prompt shows.
const pelvis = () => ({ seq: ["hipL", "hipR"], i: 0, focused: "pelvis" });

test("adjusting the joint being asked for advances the prompt", () => {
  const next = advanceManualCorrection(pelvis(), "hipL");
  assert.equal(next.i, 1);
  assert.deepEqual(next.seq, ["hipL", "hipR"]);
  assert.equal(next.focused, "pelvis", "the rest of the state is carried through");
});

test("adjusting any other joint leaves the prompt where it is", () => {
  const manual = pelvis();
  for (const other of ["hipR", "shL", "kneeR", "ankL"]) {
    assert.equal(advanceManualCorrection(manual, other).i, 0, `${other} must not advance the prompt`);
  }
});

test("dragging the same joint again does not advance twice", () => {
  const first = advanceManualCorrection(pelvis(), "hipL");
  assert.equal(first.i, 1);
  // The prompt now asks for hipR, so hipL no longer matches.
  assert.equal(advanceManualCorrection(first, "hipL").i, 1);
  assert.equal(advanceManualCorrection(advanceManualCorrection(first, "hipL"), "hipL").i, 1);
});

test("the index never runs past the end of the sequence", () => {
  let manual = pelvis();
  manual = advanceManualCorrection(manual, "hipL");
  manual = advanceManualCorrection(manual, "hipR");
  assert.equal(manual.i, manual.seq.length, "finished");

  // Every further adjustment, on any joint, is a no-op.
  for (const key of ["hipL", "hipR", "shL"]) {
    const after = advanceManualCorrection(manual, key);
    assert.equal(after.i, manual.seq.length);
    assert.ok(after.i <= after.seq.length);
  }
});

test("a joint already passed can still be adjusted", () => {
  /* The prompt only moves forward; it never takes away the ability to go back
     and fix an earlier joint. Advancing is a hint, not a lock. */
  const finished = advanceManualCorrection(advanceManualCorrection(pelvis(), "hipL"), "hipR");
  const reAdjusted = advanceManualCorrection(finished, "hipL");
  assert.deepEqual(reAdjusted, finished, "re-adjusting is allowed and simply does not move the prompt");
});

test("a missing or malformed state is returned untouched", () => {
  assert.equal(advanceManualCorrection(null, "hipL"), null);
  assert.equal(advanceManualCorrection(undefined, "hipL"), undefined);
  const noSeq = { i: 0 };
  assert.equal(advanceManualCorrection(noSeq, "hipL"), noSeq);
  const manual = pelvis();
  assert.equal(advanceManualCorrection(manual, "").i, 0);
  assert.equal(advanceManualCorrection(manual, null).i, 0);
  assert.equal(advanceManualCorrection({ seq: ["hipL"], i: -1 }, "hipL").i, -1);
});

test("the full front sequence walks through every joint once", () => {
  const seq = ["earL", "earR", "shL", "shR", "hipL", "hipR"];
  let manual = { seq, i: 0 };
  seq.forEach((key, index) => {
    manual = advanceManualCorrection(manual, key);
    assert.equal(manual.i, index + 1);
  });
  assert.equal(manual.i, seq.length);
});

/* --------------------------- the wiring ------------------------------- */

test("the prompt advances on release, not only when a point is placed", async () => {
  const source = await appSource();
  /* Correction opens on a pose whose points all exist, so onDown always takes
     its "near an existing joint" branch and returns before the placement path
     that used to be the only thing advancing the prompt. */
  assert.match(source, /const adjusted = dragRef\.current;\s*\r?\n\s*if \(adjusted\) \{\s*\r?\n\s*buzz\(4\);\s*\r?\n\s*setManual\(\(m\) => advanceManualCorrection\(m, adjusted\)\);/);
  // The placement path is untouched.
  assert.match(source, /setManual\(\(m\) => \(\{ \.\.\.m, i: m\.i \+ 1 \}\)\);/);
});

test("the sticky action bar gets room to clear the last result row", async () => {
  const source = await appSource();
  // Padding on the containing block is what lets the sticky bar come to rest
  // below the grid instead of covering it.
  assert.match(source, /className=\{`mt-4 space-y-3\$\{res && \(res\.items\.length > 0 \|\| res\.invalidMeasurements\?\.length > 0\) \? " pb-20" : ""\}`\}/);
  // Only when the bar is actually there, so no dead space otherwise.
  assert.match(source, /<div className="sticky bottom-0 -mx-1 rounded-2xl p-2"/);
});
