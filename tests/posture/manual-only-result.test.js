import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { MANUAL_ONLY_RESULT_NOTICE, isFullyManualAfterAiMiss } from "../../src/features/posture/result-presentation.js";

const appSource = () => readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");

const hand = (x, y) => ({ x, y, score: 1, source: "manual" });
const ai = (x, y) => ({ x, y, score: 0.9, source: "ai" });
const dragged = (x, y) => ({ x, y, score: 1, source: "manual-corrected" });

/* The reported case: a close-up of a keyboard, "미검출 관절 7개", every joint
   placed by hand, and a shoulder angle comes out. */
const keyboardPhoto = () => ({
  analysisSource: "ai_manual_corrected",
  originalPts: null,
  pts: { shL: hand(0.3, 0.3), shR: hand(0.7, 0.3), hipL: hand(0.35, 0.6), hipR: hand(0.65, 0.6) },
});

test("a result with no AI reading and only hand-placed points is flagged", () => {
  assert.equal(isFullyManualAfterAiMiss(keyboardPhoto()), true);
});

test("an ordinary AI result is not flagged", () => {
  assert.equal(isFullyManualAfterAiMiss({
    analysisSource: "ai",
    originalPts: { shL: ai(0.3, 0.3) },
    pts: { shL: ai(0.3, 0.3), shR: ai(0.7, 0.3) },
  }), false);
});

test("correcting an AI result by dragging is not the same thing", () => {
  /* The AI did find the person; the instructor nudged it. Dragging leaves
     "manual-corrected", which is what keeps these two apart. */
  assert.equal(isFullyManualAfterAiMiss({
    analysisSource: "ai_manual_corrected",
    originalPts: { shL: ai(0.3, 0.3), shR: ai(0.7, 0.3) },
    pts: { shL: dragged(0.31, 0.3), shR: dragged(0.69, 0.3) },
  }), false);
});

test("filling in a few missing joints on a real detection is not flagged", () => {
  // The AI found most of the person; two joints were added by hand.
  assert.equal(isFullyManualAfterAiMiss({
    analysisSource: "ai_manual_corrected",
    originalPts: { shL: ai(0.3, 0.3), shR: ai(0.7, 0.3) },
    pts: { shL: ai(0.3, 0.3), shR: ai(0.7, 0.3), ankL: hand(0.35, 0.95), ankR: hand(0.65, 0.95) },
  }), false);
});

test("choosing to draw by hand from the start is not an AI miss", () => {
  /* Same data shape, different fact: the AI never ran, so it did not fail to
     find anyone. Saying it did would be inventing a cause. */
  assert.equal(isFullyManualAfterAiMiss({
    analysisSource: "manual",
    originalPts: null,
    pts: { shL: hand(0.3, 0.3), shR: hand(0.7, 0.3) },
  }), false);
  assert.equal(isFullyManualAfterAiMiss({ analysisSource: "draw", originalPts: null, pts: { shL: hand(0.3, 0.3) } }), false);
});

test("both stored signals have to agree", () => {
  const base = keyboardPhoto();
  // An AI reading on file contradicts "the AI found nothing".
  assert.equal(isFullyManualAfterAiMiss({ ...base, originalPts: { shL: ai(0.3, 0.3) } }), false);
  // A single point of AI origin contradicts "all placed by hand".
  assert.equal(isFullyManualAfterAiMiss({ ...base, pts: { ...base.pts, shR: ai(0.7, 0.3) } }), false);
});

test("an empty original store counts as no reading", () => {
  for (const originalPts of [null, undefined, {}]) {
    assert.equal(isFullyManualAfterAiMiss({ ...keyboardPhoto(), originalPts }), true);
  }
});

test("a record with no points at all is not flagged", () => {
  // Nothing was measured, so there is no result to explain.
  for (const pts of [null, undefined, {}]) {
    assert.equal(isFullyManualAfterAiMiss({ ...keyboardPhoto(), pts }), false);
  }
});

test("a missing or malformed record is not flagged", () => {
  for (const pose of [null, undefined, "", 0, "pose"]) {
    assert.equal(isFullyManualAfterAiMiss(pose), false);
  }
});

/* ---------------------- what the sentence is allowed to be -------------- */

test("the notice states how the result was produced and nothing else", () => {
  assert.equal(MANUAL_ONLY_RESULT_NOTICE, "AI가 사람을 찾지 못해 관절을 모두 직접 지정한 결과입니다");
  for (const word of ["점수", "신뢰", "%", "부정확", "오류", "실패했습니다", "개선", "악화"]) {
    assert.ok(!MANUAL_ONLY_RESULT_NOTICE.includes(word), `the notice must not read as a ${word} judgement`);
  }
});

/* ------------------------------ the wiring ------------------------------ */

test("the notice appears on the result screen", async () => {
  const source = await appSource();
  assert.match(source, /\{manualOnlyResult && <p className="rounded-xl px-3 py-2 text-xs font-bold"[^>]*>\{MANUAL_ONLY_RESULT_NOTICE\}<\/p>\}/);
});

test("the notice survives into the saved record's screen", async () => {
  const source = await appSource();
  /* Asked for explicitly: the fact has to be on the stored result too, or it
     is lost the moment the screen closes. */
  assert.match(source, /const manualOnlyStored = resultPoses\.some\(isFullyManualAfterAiMiss\);/);
  assert.match(source, /\{manualOnlyStored && <p className="mt-2 rounded-xl px-3 py-2 text-xs font-bold"[^>]*>\{MANUAL_ONLY_RESULT_NOTICE\}<\/p>\}/);
});

test("the live screen asks the same question as the stored one", async () => {
  const source = await appSource();
  /* Built from the same fields the save writes, so a result cannot be flagged
     before saving and unflagged after. */
  assert.match(source, /const manualOnlyResult = useMemo\(\(\) => isFullyManualAfterAiMiss\(\{\s*\r?\n\s*analysisSource: analysisMethod === "manual" \? "manual" : "ai",\s*\r?\n\s*originalPts, pts,\s*\r?\n\s*\}\), \[analysisMethod, originalPts, pts\]\);/);
});

test("the saved record already carries everything the rule reads", async () => {
  const source = await appSource();
  // No new field: pts[].source, originalPts and analysisSource are all stored.
  assert.match(source, /source: p\.source \|\| \(analysisMethod === "manual" \? "manual" : "ai"\)/);
  assert.match(source, /originalPts: Object\.keys\(originalSlim\)\.length \? originalSlim : null/);
  assert.match(source, /analysisSource: source,/);
});

test("hand-placed and dragged points keep different origins", async () => {
  const source = await appSource();
  /* This distinction is the whole rule. A tap stays "manual"; moving a point
     that already existed becomes "manual-corrected". */
  assert.match(source, /source: p\[key\]\?\.source === "manual" \? "manual" : "manual-corrected"/);
  assert.match(source, /source: manual\.focused \? "ai_manual_corrected" : "manual"/);
});

test("nothing is blocked from being saved", async () => {
  const source = await appSource();
  // The path exists to rescue hard photos; the fix marks the result, not bars it.
  assert.doesNotMatch(source, /manualOnlyResult && [^}]*disabled/);
  assert.doesNotMatch(source, /if \(manualOnlyResult\) return/);
});
