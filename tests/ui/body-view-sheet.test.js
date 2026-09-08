import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

const appSource = () => readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
const sheetSource = () => readFile(new URL("../../src/features/posture/BodyViewSheet.jsx", import.meta.url), "utf8");
/* 줄바꿈은 파일마다 다르다. 여러 줄을 한 번에 보는 검사가 그것 때문에
   깨지지 않도록 먼저 맞춰 둔다. */
const withoutComments = (source) => String(source)
  .replace(/\r\n/g, "\n")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

const pt = (x, y) => ({ x, y, score: 1 });
const frontPts = ({ top = 0.08, bottom = 0.92, cx = 0.5 } = {}) => ({
  nose: pt(cx, top), earL: pt(cx - 0.03, top + 0.01), earR: pt(cx + 0.03, top + 0.01),
  shL: pt(cx - 0.1, top + 0.15), shR: pt(cx + 0.1, top + 0.15),
  hipL: pt(cx - 0.08, (top + bottom) / 2), hipR: pt(cx + 0.08, (top + bottom) / 2),
  ankL: pt(cx - 0.06, bottom), ankR: pt(cx + 0.06, bottom),
  footL: pt(cx - 0.06, bottom), footR: pt(cx + 0.06, bottom),
});
const pose = (view, metrics = []) => ({
  id: `p_${view}`, view, cleanBlobId: `clean_${view}`, blobId: `raw_${view}`, pts: frontPts(), metrics,
});
const assessment = (views) => ({
  id: "a1", status: "completed", scope: "full_body", date: "2026-09-01",
  completedAt: "2026-09-01T00:00:00Z", at: "2026-09-01T00:00:00Z",
  poses: views.map((view) => pose(view, [{ key: "shoulder", label: "어깨선 각도", value: 3.4, unit: "°", validity: { valid: true } }])),
  photos: Object.fromEntries(views.map((view) => [view, { id: `p_${view}`, cleanBlobId: `clean_${view}`, blobId: `raw_${view}` }])),
});

/* JSX has to go through the app's own build to run here, the way the screen
   smoke test does it. One server, loaded once for the whole file. */
let BodyViewSheet = null;
let vite = null;
test.before(async () => {
  vite = await createServer({
    root: fileURLToPath(new URL("../../", import.meta.url)),
    configFile: false, plugins: [react()], appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true }, logLevel: "silent",
  });
  ({ default: BodyViewSheet } = await vite.ssrLoadModule("/src/features/posture/BodyViewSheet.jsx"));
});
test.after(async () => { await vite?.close(); });

const render = (props) => renderToStaticMarkup(React.createElement(BodyViewSheet, {
  assessment: assessment(["front", "back"]),
  resolvePhotoUrl: async () => null,
  onClose: () => {},
  ...props,
}));

/* ---------------------------- the four buttons --------------------------- */

test("all four directions are offered, in the order they are shot", () => {
  const html = render({});
  const order = ["전면", "좌측면", "후면", "우측면"].map((label) => html.indexOf(`>${label}<`));
  assert.ok(order.every((at) => at >= 0), "every direction has a button");
  assert.deepEqual([...order].sort((a, b) => a - b), order, "shooting order, not alphabetical");
});

test("a direction that was not shot cannot be opened, and says why", () => {
  const html = render({});
  const buttons = html.match(/<button[^>]*>(?:전면|좌측면|후면|우측면)<\/button>/g) || [];
  const disabled = buttons.filter((button) => button.includes("disabled"));
  assert.equal(disabled.length, 2, "the two unshot directions are closed");
  assert.ok(disabled.some((button) => button.includes("좌측면")) && disabled.some((button) => button.includes("우측면")));
  assert.ok(html.includes("촬영하면 이 방향도 확인할 수 있어요"));
});

test("with every direction shot there is nothing to invite and no closed button", () => {
  const html = render({ assessment: assessment(["front", "leftSide", "back", "rightSide"]) });
  assert.ok(!html.includes("disabled"));
  assert.ok(!html.includes("촬영하면 이 방향도"));
});

test("a single direction still opens rather than refusing", () => {
  const html = render({ assessment: assessment(["back"]) });
  assert.ok(html.includes(">후면<"));
});

test("a record with no analysed photo says so instead of loading forever", async () => {
  /* Older records were saved without the 760px copy. Waiting on one that will
     never arrive leaves the screen spinning with nothing to say. */
  const source = withoutComments(await sheetSource());
  assert.ok(source.includes(`const url = media?.cleanBlobId ? await resolvePhotoUrl(media.cleanBlobId) : null;`));
  assert.ok(source.includes(`const next = url ? { status: "ready", url } : { status: "missing" };`));
  assert.ok(source.includes(`shownPhoto?.status === "missing" ? NO_PHOTO_NOTE : "사진을 불러오는 중"`));
  assert.ok(source.includes("이 기록에는 방향별 사진이 없어요"));
});

test("a direction that was shot is never told to go and shoot it", async () => {
  /* An unreadable photo and an unshot direction are different facts. Greying
     the button out would ask for a photo the instructor already took. */
  const source = withoutComments(await sheetSource());
  assert.ok(source.includes(`disabled={!entry.hasPhoto}`));
  assert.ok(!source.includes("status === \"missing\" ? true"), "the empty state does not close the button");
});

/* --------------------------- what it claims to be ------------------------ */

test("the screen says where the numbers came from", () => {
  assert.ok(render({}).includes("전면·좌측면·후면·우측면 사진에서 측정한 값입니다"));
});

test("one word is used for a direction, on the buttons and in the sentence", async () => {
  /* 전면 on the button and 정면 in the line below reads as two different
     things being talked about. */
  const html = render({});
  assert.ok(html.includes(">전면<"), "the button uses the app's own label");
  assert.ok(!html.includes("정면"), "and the sentence does not invent a second word");
});

test("nothing on screen offers a scan, a model, or an analysis in three dimensions", async () => {
  /* The one place "3D" may appear is the sentence denying that a model is
     built, and that sentence is behind the help button. */
  const source = withoutComments(await sheetSource());
  for (const claim of ["3D 스캔", "3D 분석", "3D 체형", "3D 모델링", "입체 분석"]) {
    assert.ok(!source.includes(claim), `the screen must not offer "${claim}"`);
  }
  assert.ok(source.includes("실제 3D 신체 모델을 생성하지 않습니다"), "the denial is the only mention");
});

test("no body is invented between the photographs", async () => {
  /* Four photographs is four photographs. Filling the gaps would be drawing a
     body nobody shot. */
  const source = withoutComments(await sheetSource());
  for (const forbidden of ["Segmenter", "segmentation", "blur(", "perspective(", "rotateY", "rotate3d", "morph"]) {
    assert.ok(!source.includes(forbidden), `"${forbidden}" would build something that was not photographed`);
  }
});

test("the photo shown is the analysed one, never the untouched original", async () => {
  const source = withoutComments(await sheetSource());
  assert.ok(source.includes("cleanBlobId"));
  assert.ok(!/[^n]\.blobId/.test(source), "the full-size original is too large for this screen");
});

/* ------------------------------ the switch ------------------------------- */

test("a reading with no place on the body is listed beside the photo, not on it", async () => {
  /* The knee reading is one of these: a real number whose joint is not
     recorded. It stays visible, and it stays off the body. */
  const source = withoutComments(await sheetSource());
  assert.ok(source.includes(`const placed = metrics.filter((metric) => metric.at);`));
  assert.ok(source.includes(`const unplaced = metrics.filter((metric) => !metric.at);`));
  assert.ok(source.includes(`{markersVisible && placed.map(`), "only the placed ones go on the photo");
  assert.ok(source.includes(`markersVisible && unplaced.length > 0`), "the rest are listed");
});

test("the markers are held back until a direction has finished arriving", async () => {
  /* Mid-switch the outgoing body is still on screen. A marker drawn then would
     sit on the wrong body with the next direction's number. */
  const source = withoutComments(await sheetSource());
  assert.match(source, /markersVisible\s*=\s*phase === "idle"/);
  assert.ok(source.includes(`{markersVisible && placed.map(`));
});

test("the two bodies never share the screen at full strength", async () => {
  /* One fades out before the other fades in, so there is no frame with two
     people standing in it. */
  const source = withoutComments(await sheetSource());
  assert.match(source, /setPhase\("out"\)/);
  assert.match(source, /setTimeout\(\(\) => \{ setShownView\(view\); setPhase\("in"\); \}, FADE_OUT_MS\)/);
});

test("a device asked to reduce motion gets the direction at once", async () => {
  const source = withoutComments(await sheetSource());
  assert.match(source, /if \(reduced\) \{ setShownView\(view\); setPhase\("idle"\); return; \}/);
});

test("only the direction in view is hung on the screen", async () => {
  /* Four full-size photographs at once is what makes a cheap phone stall. */
  const source = withoutComments(await sheetSource());
  assert.equal((source.match(/<img/g) || []).length, 1);
  assert.match(source, /const wanted = \[order\[at\], order\[\(at \+ 1\)/, "the neighbours are only fetched, not mounted");
});

test("the alignment is worked out once per record, not once per frame", async () => {
  const source = withoutComments(await sheetSource());
  assert.match(source, /const alignment = useMemo\(\(\) => composeBodyViewAlignment\(assessment\), \[assessment\]\)/);
  assert.match(source, /bodyViewMetrics\(assessment, shownView, \{ previousAssessment \}\)/);
});

/* ------------------------------- the drag -------------------------------- */

test("a sideways push turns the body, a vertical one scrolls the page", async () => {
  /* The photo fills most of the screen. If it swallowed every gesture the
     instructor could not scroll past it. */
  const source = withoutComments(await sheetSource());
  assert.ok(source.includes('touchAction: "pan-y"'), "the browser keeps the vertical axis");
  assert.ok(source.includes('drag.current.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";'), "whichever wins decides");
  assert.ok(source.includes('if (drag.current.axis !== "x") return;'), "a vertical drag is left alone");
});

test("the drag is wired to the frame, and lets go of it again", async () => {
  const source = withoutComments(await sheetSource());
  for (const handler of ["onPointerDown={onPointerDown}", "onPointerMove={onPointerMove}", "onPointerUp={endDrag}", "onPointerCancel={endDrag}"]) {
    assert.ok(source.includes(handler), `${handler} is missing`);
  }
});

test("the buttons stay the way in; the drag is the extra one", async () => {
  /* Four buttons are still the plain way to choose a direction. */
  const html = render({ assessment: assessment(["front", "leftSide", "back", "rightSide"]) });
  assert.equal((html.match(/aria-pressed=/g) || []).length, 4);
});

test("the markers come off the body while it is being dragged", async () => {
  /* Mid-drag the photo is between two directions. A number pinned to it
     would be pointing at a spot that is no longer where it was measured. */
  const source = withoutComments(await sheetSource());
  assert.ok(source.includes("const markersVisible = phase === \"idle\" && !dragging && introStage >= 2 && !!shownEntry;"));
});

test("the photo is moved, never bent", async () => {
  /* The drag shifts the picture sideways. It does not turn it, skew it, or
     stretch it towards an angle nobody photographed. */
  const source = withoutComments(await sheetSource());
  assert.ok(source.includes("transform: `translateX(${dragDx}px)"));
  for (const forbidden of ["rotateY", "rotate3d", "skew", "perspective", "matrix3d"]) {
    assert.ok(!source.includes(forbidden), `${forbidden} would bend the body`);
  }
});

test("a device asked to reduce motion is not dragged along in real time", async () => {
  const source = withoutComments(await sheetSource());
  assert.ok(source.includes("if (!reduced) setDragDx(blocked ? dx * DRAG_EDGE_RESISTANCE : dx);"));
});

/* ----------------------------- the entrance ------------------------------ */

test("the entrance runs once, and only once", async () => {
  /* It is about the result being laid out. Replaying it on every button press
     turns it into a delay between the instructor and the photo. */
  const source = withoutComments(await sheetSource());
  assert.ok(source.includes("if (introStarted.current) return undefined;"));
  assert.ok(source.includes("introStarted.current = true;"));
});

test("touching anything ends the entrance instead of waiting it out", async () => {
  const source = withoutComments(await sheetSource());
  assert.ok(source.includes("const switchTo = useCallback((view) => {\n    if (!view || view === activeView) return;\n    finishIntro();"), "a button cuts it short");
  assert.ok(source.includes("        finishIntro();\n        setDragging(true);"), "so does a finger");
  assert.ok(source.includes("setIntroStage(3);\n    setRevealed(Number.MAX_SAFE_INTEGER);"), "and it lands on the finished state, not a half-drawn one");
});

test("the whole entrance fits inside a second", async () => {
  const source = withoutComments(await sheetSource());
  const value = (name) => Number(source.match(new RegExp("const " + name + " = (\\d+)"))?.[1]);
  const total = value("PHOTO_FADE_MS") + value("INTRO_HOLD_MS") + value("MARKER_TOTAL_MAX_MS");
  assert.ok(Number.isFinite(total), "the timings are written down");
  assert.ok(total <= 1000, `the entrance takes ${total}ms`);
  assert.ok(value("MARKER_STEP_MS") <= 80, "the markers do not trickle");
  assert.ok(source.includes("const step = Math.min(MARKER_STEP_MS, MARKER_TOTAL_MAX_MS / count);"), "many markers speed up rather than run over");
});

test("the markers appear in the order they are listed, not by size", async () => {
  /* Revealing the biggest first would rank them, and ranking is a judgement
     about which reading matters. */
  const source = withoutComments(await sheetSource());
  assert.ok(!source.includes(".sort("), "nothing reorders the readings");
  assert.ok(source.includes("placed.map((metric, index) => ("));
  assert.ok(source.includes("hidden={index >= revealed}"), "the list order is the reveal order");
});

test("reduced motion gets the finished screen with no entrance at all", async () => {
  const source = withoutComments(await sheetSource());
  assert.ok(source.includes("useState(reduced ? 3 : 0)"));
  assert.ok(source.includes('if (reduced || settled === "missing") { setIntroStage(3); setRevealed(Number.MAX_SAFE_INTEGER); return undefined; }'));
});

test("a record with no photo does not hold the readings behind an entrance", async () => {
  /* There is nothing to fade in, so waiting on the fade would hide the list
     of readings for good. */
  const source = withoutComments(await sheetSource());
  assert.ok(source.includes('if (settled !== "ready" && settled !== "missing") return undefined;'));
});

test("the timers are dropped when the screen closes", async () => {
  const source = withoutComments(await sheetSource());
  assert.ok(source.includes("introTimers.current.forEach(clearTimeout); introTimers.current = [];"));
});

/* --------------------------- an unaligned photo -------------------------- */

test("a direction that could not be aligned is not dressed up as a failure", async () => {
  /* The photo is on screen and looks fine. A warning badge over it would send
     the instructor looking for a fault that is not there. */
  const source = withoutComments(await sheetSource());
  assert.ok(source.includes("촬영 위치 차이로 자동 정렬이 적용되지 않았어요"));
  for (const word of ["경고", "오류", "실패", "미정렬"]) {
    assert.ok(!source.includes(word), `the screen must not print "${word}"`);
  }
});

/* ------------------------------- the way in ------------------------------ */

test("the result screen has one door into the body view, in one place", async () => {
  const source = withoutComments(await appSource());
  assert.equal((source.match(/360° 바디뷰에서 확인하기/g) || []).length, 1, "one label, defined once");
  assert.match(source, /const bodyViewButton = canOpenBodyView \?/);
});

test("the door is there whether or not there is a change to show", async () => {
  /* A member on their first shoot has nothing to compare, and still has four
     directions worth looking at. */
  const source = withoutComments(await appSource());
  assert.match(source, /\{bodyViewButton\}\r?\n\s*<\/section>\}/, "inside the change card");
  assert.match(source, /\{!recentChanges\.length && bodyViewButton && <section/, "and in its place when there is none");
});

test("the door stays shut for a record with no photograph to show", async () => {
  const source = withoutComments(await appSource());
  assert.match(source, /const canOpenBodyView = !selectedIsManualResult && selected\?\.status === "completed"\r?\n?\s*&& POSTURE_VIEW_KEYS\.some\(\(view\) => assessmentMediaForView\(selected, view\)\)/);
});
