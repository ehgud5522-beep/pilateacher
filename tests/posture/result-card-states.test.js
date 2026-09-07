import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { POSTURE_RESULT_METRIC_KEYS, selectStoredPostureResultStates } from "../../src/features/posture/result-presentation.js";

const appSource = () => readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");

/* ------------------- the four the selector can speak for ---------------- */

test("the covered keys come from the selector, not from a second list", () => {
  assert.deepEqual([...POSTURE_RESULT_METRIC_KEYS], ["shoulder", "pelvis", "knee", "head"]);
});

test("the selector answers for each of them and for nothing else", () => {
  const metric = (key, value) => ({ key, label: key, value, unit: "°", validity: { valid: true } });
  const pose = {
    pts: { shL: { x: 0.3, y: 0.30 }, shR: { x: 0.7, y: 0.34 }, hipL: { x: 0.35, y: 0.6 }, hipR: { x: 0.65, y: 0.6 }, earL: { x: 0.4, y: 0.1 }, earR: { x: 0.6, y: 0.1 } },
    metrics: [metric("shoulder", 6), metric("pelvis", 1), metric("knee", 8), metric("head", 0.5), metric("trunk", 9), metric("fha", 12)],
  };
  const states = selectStoredPostureResultStates(pose);
  assert.deepEqual(states.map((item) => item.key).sort(), ["head", "knee", "pelvis", "shoulder"]);
  for (const item of states) assert.ok(item.status, `${item.key} must carry a status`);
  // The side metrics it does not know about produce nothing rather than a guess.
  assert.ok(!states.some((item) => ["trunk", "fha", "kneeSide", "align", "twist"].includes(item.key)));
});

/* ------------------------------ the card -------------------------------- */

test("the card reads its status from that selector", async () => {
  const source = await appSource();
  /* 3-C replaced the angles with statuses on the result screen; the card is a
     canvas drawn separately, which is how 5.8° survived there. Calling the
     same selector is what stops the two drifting again. */
  assert.match(source, /const state = statusFor\(rec, k\);/);
  assert.match(source, /statesByRecord\.set\(rec, new Map\(selectStoredPostureResultStates\(rec\)\.map\(\(item\) => \[item\.key, item\.status\]\)\)\)/);
});

test("the card prints no measurement value at all", async () => {
  const source = await appSource();
  const start = source.indexOf("async function composeResultCard(");
  const card = source.slice(start, source.indexOf("function ResultCardMaker(", start));
  // The decimals reported in item 4 came from this string.
  assert.doesNotMatch(card, /memberMetricValue/);
  assert.doesNotMatch(card, /\{m\.unit\}|\$\{m\.unit\}/);
  assert.match(card, /const txt = `\$\{CARD_SHORT\[k\] \|\| k\}\$\{state \? ` \$\{state\}` : ""\}\$\{isAfter \? " · AFTER" : ""\}`\.trim\(\);/);
});

test("an item the selector does not cover falls back to its name", async () => {
  const source = await appSource();
  /* Rather than the card inventing a status of its own -- which is exactly how
     the two screens would come apart again. */
  assert.match(source, /\$\{state \? ` \$\{state\}` : ""\}/);
});

test("the selector is run once per record, not once per item", async () => {
  const source = await appSource();
  assert.match(source, /if \(!statesByRecord\.has\(rec\)\) statesByRecord\.set\(rec,/);
});

test("the metric lookup the card no longer needs is gone", async () => {
  const source = await appSource();
  assert.doesNotMatch(source, /const mFor = \(k\) => validPostureMetrics\(rec\)/);
});

/* ------------------------- the item picker ------------------------------ */

test("the picker marks the items that only give a name", async () => {
  const source = await appSource();
  /* Asked for directly: picking one and getting a bare label would read as a
     broken card. */
  assert.match(source, /\{!POSTURE_RESULT_METRIC_KEYS\.includes\(k\) && <span className="ml-1 font-bold opacity-70">이름만<\/span>\}/);
});

test("the picker explains the split once, from the same list", async () => {
  const source = await appSource();
  assert.match(source, /상태값은 \{POSTURE_RESULT_METRIC_KEYS\.map\(\(k\) => CARD_SHORT\[k\] \|\| k\)\.join\(" · "\)\}에만 있습니다/);
  // Naming the four in prose would drift the day the selector changes.
  assert.doesNotMatch(source, /상태값은 어깨 · 골반 · 무릎 · 머리에만/);
});

test("the explanation is shown only when it applies", async () => {
  const source = await appSource();
  // A shoot with only covered items needs no caveat.
  assert.match(source, /\{commonKeys\.some\(\(k\) => !POSTURE_RESULT_METRIC_KEYS\.includes\(k\)\) && <Sub/);
});

test("every offered item is still offered", async () => {
  const source = await appSource();
  /* Marking them was the ask, not removing them -- the side items still carry
     their joints and their name onto the card. */
  assert.match(source, /\{commonKeys\.map\(\(k\) => \(/);
  assert.match(source, /const commonKeys =[\s\S]{0,200}Object\.keys\(CARD_JOINTS\)/);
});
