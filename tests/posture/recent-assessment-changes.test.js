import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  postureMetricChangeText, selectPreviousAssessment, selectRecentAssessmentChanges,
} from "../../src/features/posture/posture-model.js";

const appSource = () => readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");

const metric = (key, label, value) => ({ key, label, value, unit: "°", validity: { valid: true } });
const set = (id, at, poses) => ({ id, status: "completed", scope: "full_body", at, completedAt: at, poses });
const pose = (view, metrics) => ({ view, metrics });

/* ------------------------ which record to compare with ------------------ */

test("the comparison is with the record just before, not the first one", () => {
  /* "이번 변화" is what changed since last time. Against the very first shoot
     it would be the whole history, which is a different claim. */
  const first = set("s1", "2026-07-01T00:00:00Z", []);
  const middle = set("s2", "2026-08-01T00:00:00Z", []);
  const latest = set("s3", "2026-09-01T00:00:00Z", []);
  assert.equal(selectPreviousAssessment([latest, middle, first], latest)?.id, "s2");
  assert.equal(selectPreviousAssessment([latest, middle, first], middle)?.id, "s1");
});

test("the first record has nothing before it", () => {
  const first = set("s1", "2026-07-01T00:00:00Z", []);
  assert.equal(selectPreviousAssessment([first], first), null);
});

test("a record still in progress is not something to compare with", () => {
  const draft = { ...set("s1", "2026-07-01T00:00:00Z", []), status: "analyzing" };
  const latest = set("s2", "2026-09-01T00:00:00Z", []);
  assert.equal(selectPreviousAssessment([latest, draft], latest), null);
});

test("a shoot of a different scope is not compared with", () => {
  const partial = { ...set("s1", "2026-07-01T00:00:00Z", []), scope: "partial" };
  const latest = set("s2", "2026-09-01T00:00:00Z", []);
  assert.equal(selectPreviousAssessment([latest, partial], latest), null);
});

test("a missing or unknown target yields nothing", () => {
  const only = set("s1", "2026-07-01T00:00:00Z", []);
  assert.equal(selectPreviousAssessment([only], null), null);
  assert.equal(selectPreviousAssessment([only], { id: "nope" }), null);
  assert.equal(selectPreviousAssessment(null, only), null);
});

/* --------------------------- which rows to show ------------------------- */

const before = set("s1", "2026-08-01T00:00:00Z", [pose("front", [
  metric("shoulder", "어깨선 각도", 2.8),
  metric("pelvis", "골반선 각도", 6.2),
  metric("head", "귀선 각도", 1.4),
  metric("knee", "무릎선 각도", 9.1),
])]);
const after = set("s2", "2026-09-01T00:00:00Z", [pose("front", [
  metric("shoulder", "어깨선 각도", 1.4),
  metric("pelvis", "골반선 각도", 1.1),
  metric("head", "귀선 각도", 1.2),
  metric("knee", "무릎선 각도", 4.0),
])]);

test("the biggest movements come first, at most three", () => {
  const rows = selectRecentAssessmentChanges(before, after);
  assert.equal(rows.length, 3, "four moved, but only three are shown");
  assert.deepEqual(rows.map((row) => row.difference), [-5, -5, -2]);
  // knee and pelvis both moved 5; the tie is broken by id so the order is stable.
  assert.deepEqual(rows.map((row) => row.key), ["knee", "pelvis", "shoulder"]);
  assert.ok(Math.abs(rows[0].difference) >= Math.abs(rows[1].difference));
  assert.ok(Math.abs(rows[1].difference) >= Math.abs(rows[2].difference));
});

test("a movement inside the shooting tolerance is left out", () => {
  /* 1.4 -> 1.2 both print as 1, and the same rule that says 변화 없음 in the
     comparison view keeps it off this card. */
  const rows = selectRecentAssessmentChanges(before, after);
  assert.ok(!rows.some((row) => row.key === "head"));
  assert.equal(postureMetricChangeText(0), "변화 없음");
});

test("nothing beyond the tolerance means no rows at all", () => {
  /* An empty card would say "이번 변화" and then show nothing, which reads as
     a fault rather than as a quiet month. */
  const flatBefore = set("s1", "2026-08-01T00:00:00Z", [pose("front", [metric("shoulder", "어깨선 각도", 2.2)])]);
  const flatAfter = set("s2", "2026-09-01T00:00:00Z", [pose("front", [metric("shoulder", "어깨선 각도", 1.9)])]);
  assert.deepEqual(selectRecentAssessmentChanges(flatBefore, flatAfter), []);
});

test("the row keeps both readings and the difference between them", () => {
  const [row] = selectRecentAssessmentChanges(before, after, { limit: 1 });
  assert.equal(typeof row.beforeValue, "number");
  assert.equal(typeof row.afterValue, "number");
  assert.equal(row.difference, Math.round(row.afterValue) - Math.round(row.beforeValue));
});

test("no row carries a verdict", () => {
  /* Only the numbers. Whether a smaller angle is better is the instructor's
     call, and nothing here should make it for them. */
  const serialized = JSON.stringify(selectRecentAssessmentChanges(before, after));
  for (const word of ["개선", "악화", "좋", "나빠", "호전", "정상"]) {
    assert.ok(!serialized.includes(word), `a row must not carry "${word}"`);
  }
});

test("the same metric on two directions stays two rows", () => {
  /* front and back both measure a shoulder line. Collapsing them would report
     one direction's change under the other's name. */
  const twoWayBefore = set("s1", "2026-08-01T00:00:00Z", [
    pose("front", [metric("shoulder", "어깨선 각도", 8)]),
    pose("back", [metric("shoulder", "어깨선 각도", 2)]),
  ]);
  const twoWayAfter = set("s2", "2026-09-01T00:00:00Z", [
    pose("front", [metric("shoulder", "어깨선 각도", 2)]),
    pose("back", [metric("shoulder", "어깨선 각도", 9)]),
  ]);
  const rows = selectRecentAssessmentChanges(twoWayBefore, twoWayAfter);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.view).sort(), ["back", "front"]);
  assert.deepEqual([...new Set(rows.map((row) => row.id))].length, 2, "each row is its own view and key");
});

test("ties are ordered the same way every time", () => {
  const tieBefore = set("s1", "2026-08-01T00:00:00Z", [pose("front", [metric("shoulder", "어깨선", 8), metric("pelvis", "골반선", 8)])]);
  const tieAfter = set("s2", "2026-09-01T00:00:00Z", [pose("front", [metric("shoulder", "어깨선", 2), metric("pelvis", "골반선", 2)])]);
  const once = selectRecentAssessmentChanges(tieBefore, tieAfter).map((row) => row.id);
  const twice = selectRecentAssessmentChanges(tieBefore, tieAfter).map((row) => row.id);
  assert.deepEqual(once, twice);
});

/* ------------------------------ the screen ------------------------------ */

test("the card sits above 핵심 상태 on the result screen", async () => {
  const source = await appSource();
  const change = source.indexOf(">이번 변화</h2>");
  const states = source.indexOf(">핵심 상태</h2>");
  assert.ok(change >= 0 && states > change, "the change card comes first");
});

test("the card is not drawn without a previous record or without rows", async () => {
  const source = await appSource();
  assert.match(source, /!selectedIsManualResult && selected\?\.status === "completed" && !!recentChanges\.length && <section/);
  assert.match(source, /const recentChanges = useMemo\(\s*\r?\n\s*\(\) => \(previousAssessment && selected \? selectRecentAssessmentChanges\(previousAssessment, selected\) : \[\]\),/);
});

test("the card names the record it is comparing with", async () => {
  const source = await appSource();
  // Otherwise "이번 변화" is a change since some unstated moment.
  assert.match(source, /\{ymd\(setDate\(previousAssessment\)\.slice\(0, 10\)\)\} 기록과 비교/);
});

test("both numbers print through the one rounding helper", async () => {
  const source = await appSource();
  /* The same rule the comparison row uses, so the pair on this card agrees
     with the difference that decided it belongs here. */
  assert.match(source, /\{memberMetricValue\(metric\.beforeValue, metric\.unit\)\}\{metric\.unit\}/);
  assert.match(source, /\{memberMetricValue\(metric\.afterValue, metric\.unit\)\}\{metric\.unit\}/);
});

test("the direction is named only when rows span more than one", async () => {
  const source = await appSource();
  assert.match(source, /const recentChangeShowsView = new Set\(recentChanges\.map\(\(metric\) => metric\.view\)\)\.size > 1;/);
  assert.match(source, /\{recentChangeShowsView \? ` · \$\{postureViewLabel\(metric\.view\)\}` : ""\}/);
});

test("the card says nothing about better or worse", async () => {
  const source = await appSource();
  const start = source.indexOf(">이번 변화</h2>");
  const card = source.slice(start, source.indexOf(">핵심 상태</h2>", start));
  const code = card.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const word of ["개선", "악화", "좋아", "나빠", "호전"]) {
    assert.ok(!code.includes(word), `the card must not print "${word}"`);
  }
});

test("the readings are recomputed only when the records change", async () => {
  const source = await appSource();
  // The result screen re-renders often; this walks every pose of two shoots.
  assert.match(source, /const previousAssessment = useMemo\(\(\) => selectPreviousAssessment\(sets, selected\), \[sets, selected\]\);/);
  assert.match(source, /\[previousAssessment, selected\],/);
});
