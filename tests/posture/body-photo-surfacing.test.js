import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  postureCalendarDays,
  selectMemberBodyPhotoSurface,
} from "../../src/features/posture/posture-model.js";
import { DARK_COLORS } from "../../src/design-system/tokens/colors.js";

const appPath = new URL("../../src/App.jsx", import.meta.url);
const photo = (id, view, date, assessmentId = `assessment-${id}`) => ({ id, view, date, assessmentId, src: `blob:${id}` });
const select = (photos) => selectMemberBodyPhotoSurface(photos, { now: new Date(2026, 8, 5, 12, 0, 0) });
const luminance = (hex) => {
  const channels = hex.slice(1).match(/../g).map((value) => Number.parseInt(value, 16) / 255);
  const [red, green, blue] = channels.map((value) => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
};
const contrast = (first, second) => {
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
};

test("0 photos exposes the first-photo state", () => {
  assert.deepEqual(select({}), {
    state: "empty", photoCount: 0, comparisonPairAvailable: false, view: null,
    before: null, latest: null, beforeDate: "", latestDate: "",
    comparisonElapsedDays: null, daysSinceLatest: null,
    beforeAssessmentId: null, afterAssessmentId: null,
  });
});

test("one front photo remains a single photo with an empty capture slot", () => {
  const current = photo("front-1", "front", "2026-06-12");
  const result = select({ front: [current] });
  assert.equal(result.state, "single");
  assert.equal(result.latest, current);
  assert.equal(result.view, "front");
  assert.equal(result.comparisonPairAvailable, false);
});

test("two dated front photos form a first/latest same-view pair", () => {
  const before = photo("front-1", "front", "2026-06-12");
  const latest = photo("front-2", "front", "2026-09-04");
  const result = select({ front: [latest, before] });
  assert.equal(result.state, "comparison");
  assert.equal(result.view, "front");
  assert.equal(result.before, before);
  assert.equal(result.latest, latest);
  assert.equal(result.comparisonElapsedDays, 84);
  assert.equal(result.daysSinceLatest, 1);
});

test("front one plus legacy side one never becomes a cross-view pair", () => {
  const result = select({
    front: [photo("front-1", "front", "2026-06-12")],
    side: [photo("side-1", "side", "2026-09-04")],
  });
  assert.equal(result.photoCount, 2);
  assert.equal(result.comparisonPairAvailable, false);
  assert.equal(result.state, "single");
});

test("front pair wins over an unrelated side photo", () => {
  const result = select({
    front: [photo("front-1", "front", "2026-06-12"), photo("front-2", "front", "2026-09-04")],
    side: [photo("side-1", "side", "2026-09-05")],
  });
  assert.equal(result.comparisonPairAvailable, true);
  assert.equal(result.view, "front");
  assert.equal(result.before.view, "front");
  assert.equal(result.latest.view, "front");
});

test("left-side pair is valid when front has no pair", () => {
  const result = select({ leftSide: [
    photo("left-1", "leftSide", "2026-06-12"),
    photo("left-2", "leftSide", "2026-09-04"),
  ] });
  assert.equal(result.comparisonPairAvailable, true);
  assert.equal(result.view, "leftSide");
});

test("different-view before/latest records are never paired", () => {
  const result = select({
    front: [photo("before", "front", "2026-06-12")],
    rightSide: [photo("latest", "rightSide", "2026-09-04")],
  });
  assert.equal(result.comparisonPairAvailable, false);
  assert.equal(result.before, null);
  assert.equal(result.latest.view, "rightSide");
});

test("ten photos surface only the same-view first/latest pair without cloning records", () => {
  const front = Array.from({ length: 10 }, (_, index) => photo(`front-${index}`, "front", `2026-08-${String(index + 1).padStart(2, "0")}`));
  const result = select({ front });
  assert.equal(result.photoCount, 10);
  assert.equal(result.before, front[0]);
  assert.equal(result.latest, front[9]);
  assert.equal(result.before.src, "blob:front-0");
  assert.equal(result.latest.src, "blob:front-9");
});

test("elapsed and since-latest dates are separate calendar values", () => {
  assert.equal(postureCalendarDays("2026-06-12", "2026-09-04"), 84);
  assert.equal(postureCalendarDays("2026-09-04", "2026-09-05"), 1);
  const result = select({ front: [photo("a", "front", "2026-06-12"), photo("b", "front", "2026-09-04")] });
  assert.deepEqual([result.comparisonElapsedDays, result.daysSinceLatest], [84, 1]);
});

test("photo removal immediately transitions comparison to single to empty", () => {
  const before = photo("a", "front", "2026-06-12");
  const latest = photo("b", "front", "2026-09-04");
  assert.equal(select({ front: [before, latest] }).state, "comparison");
  assert.equal(select({ front: [latest] }).state, "single");
  assert.equal(select({ front: [] }).state, "empty");
});

test("dark-mode photo captions keep at least 4.5:1 contrast", () => {
  assert.ok(contrast(DARK_COLORS.ink2, DARK_COLORS.card) >= 4.5);
  assert.ok(contrast(DARK_COLORS.ink2, DARK_COLORS.photo) >= 4.5);
});

test("member-detail surfacing reuses src, preserves 390px containment, and locks card IDs", async () => {
  const source = await readFile(appPath, "utf8");
  const start = source.indexOf("function ReferenceMemberDetail(");
  const end = source.indexOf("\nfunction ChangeSummary(", start);
  const detail = source.slice(start, end);
  const makerStart = source.indexOf("function ResultCardMaker(");
  const makerEnd = source.indexOf("\nconst aiMetaFrom", makerStart);
  const maker = source.slice(makerStart, makerEnd);

  assert.match(detail, /bodyPhotoSurface\.state === "empty"/);
  assert.match(detail, /첫 사진 촬영/);
  assert.match(detail, /비교 카드 만들어 보내기/);
  assert.match(detail, /data-body-photo-pair-view=\{bodyPhotoSurface\.view\}/);
  assert.match(detail, /grid-cols-2 gap-2 overflow-hidden/);
  assert.match(detail, /text-center text-\[10px\] font-bold tabular-nums" style=\{\{ color: INK2 \}\}/);
  assert.match(detail, /item\.photo\?\.src/);
  assert.doesNotMatch(detail, /URL\.createObjectURL/);
  assert.match(detail, /beforeAssessmentId: bodyPhotoSurface\.beforeAssessmentId/);
  assert.match(detail, /afterAssessmentId: bodyPhotoSurface\.afterAssessmentId/);
  assert.match(detail, /detailStatus\.risk !== "normal" && bodyPhotoSurface\.latest/);
  assert.match(detail, /style=\{\{ color: INK2, opacity: 0\.78 \}\}/);
  assert.match(maker, /const pairUnavailable = locked && !pairView/);
  assert.match(maker, /normalizePostureView\(bRec\.view\) === normalizePostureView\(aRec\.view\)/);
  assert.match(maker, /같은 방향의 사진이 두 장 있어야 비교할 수 있습니다/);
  assert.match(source, /photo=\{setPhoto\(reportPair\.before, reportView\)\}/);
  assert.match(source, /photo=\{setPhoto\(reportPair\.after, reportView\)\}/);
});
