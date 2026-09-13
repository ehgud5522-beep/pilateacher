import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import nodeTest from "node:test";

import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

/* 360° 바디뷰: 회전 체감이 나지 않고 인물 분리 품질도 미달이어서
   2026-09 비활성화. 기능이 꺼져 있는 동안 이 파일의 검사도 함께 멈춘다.
   지우지 않는 이유는 재개할 때 그대로 다시 켜기 위해서다 -- 아래 네 줄을
   지우고 위의 import 를 되돌리면 그대로 다시 돈다. */
const skipped = { skip: "360° 바디뷰 비활성화 (2026-09) -- posture-model.js 의 BODY_VIEW_ENABLED" };
const test = (name, fn) => nodeTest(name, skipped, fn);
test.before = nodeTest.before;
test.after = nodeTest.after;

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
  const labels = (html.match(/<button[^>]*>(?:전면|좌측면|후면|우측면)<\/button>/g) || [])
    .map((button) => button.replace(/<[^>]*>/g, ""));
  assert.deepEqual(labels, ["전면", "좌측면", "후면", "우측면"], "shooting order, not alphabetical");
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
  assert.ok(source.includes(`const photoId = bodyViewPhotoId(assessment, view);`));
  assert.ok(source.includes(`const url = photoId ? await resolvePhotoUrl(photoId) : null;`));
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
  /* Four photographs is four photographs. Separating the person from the
     background takes pixels away; nothing here puts pixels back, and no angle
     is conjured between the four that were shot. */
  const source = withoutComments(await sheetSource());
  for (const forbidden of ["blur(", "perspective(", "rotateY", "rotate3d", "skew", "morph", "inpaint"]) {
    assert.ok(!source.includes(forbidden), `"${forbidden}" would build something that was not photographed`);
  }
});

test("the person is separated on the device, and only the mask is kept", async () => {
  /* The photo never leaves, and neither does the mask. The model file is the
     only thing fetched. */
  const segmenter = withoutComments(await readFile(new URL("../../src/features/posture/body-segmenter.js", import.meta.url), "utf8"));
  for (const forbidden of ["fetch(", "XMLHttpRequest", "FormData", "upload", "navigator.sendBeacon"]) {
    assert.ok(!segmenter.includes(forbidden), `${forbidden} would send the photo somewhere`);
  }
  assert.ok(segmenter.includes("storage.googleapis.com/mediapipe-models"), "the model is the one thing downloaded");
  assert.ok(segmenter.includes("outputConfidenceMasks: true"), "soft edges, so hair and fingertips survive");
});

test("the photo shown is the analysed one, never the untouched original", async () => {
  const source = withoutComments(await sheetSource());
  assert.ok(source.includes("bodyViewPhotoId(assessment, view)"), "it asks for the clean copy by name");
  assert.ok(!/[^n]\.blobId/.test(source), "the full-size original is too large for this screen");
});

/* ------------------------------ the switch ------------------------------- */

test("the screen sends a head label aside before it clamps it to the frame", async () => {
  /* Order matters. Clamping first and moving second would push the pill
     back out of the frame it was just brought into. */
  const source = withoutComments(await sheetSource());
  assert.ok(source.includes("clampLabelWithin(bodyViewLabelAnchor(metric.key, dot, photoRect) || dot, photoRect, {"),
    "past the head first, then inside the edge");
  const pin = source.slice(source.indexOf("const pins = placed.map"), source.indexOf("return { metric, index, dot, label, text, moved };"));
  assert.ok(pin.includes("const dot = { x: fraction.x * photoRect.width, y: fraction.y * photoRect.height };"),
    "the dot is still the measured point, untouched");
  assert.ok(!pin.includes("bodyViewLabelAnchor(metric.key, dot, photoRect) || dot;"), "and the dot is not reassigned");
});

test("the dot and the pill are joined whenever they come apart", async () => {
  /* The head rule reuses the line the edge rule already draws, so a reading
     that was moved still shows where it came from. */
  const source = withoutComments(await sheetSource());
  assert.ok(source.includes("const moved = Math.abs(label.x - dot.x) > 0.5 || Math.abs(label.y - dot.y) > 0.5;"));
  assert.ok(source.includes("{pin.moved && <line x1={pin.dot.x} y1={pin.dot.y} x2={pin.label.x} y2={pin.label.y}"));
});

test("one rule decides what is drawn on the body and what is only listed", async () => {
  /* Two separate conditions could disagree and drop a reading between them. */
  const source = withoutComments(await sheetSource());
  assert.ok(source.includes("const placed = metrics.filter(bodyViewMarkerShows);"));
  assert.ok(source.includes("const unplaced = metrics.filter((metric) => !bodyViewMarkerShows(metric));"));
});

test("a reading with no place on the body is listed beside the photo, not on it", async () => {
  /* Two kinds end up here: a knee, whose joint was never recorded, and a
     tilt that rounds to nothing. Both stay visible, and both stay off the
     body. */
  const source = withoutComments(await sheetSource());
  assert.ok(source.includes(`{photoMarkersVisible && (() => {`), "only the drawn ones go on the photo");
  assert.ok(source.includes(`markersVisible && unplaced.length > 0`), "the rest are listed");
  assert.ok(source.includes("{metric.label} <span"), "and the list says the reading in full");
});

test("the markers are held back until a direction has finished arriving", async () => {
  /* Mid-switch the outgoing body is still on screen. A marker drawn then would
     sit on the wrong body with the next direction's number. */
  const source = withoutComments(await sheetSource());
  assert.match(source, /markersVisible\s*=\s*phase === "idle"/);
  assert.ok(source.includes(`{photoMarkersVisible && (() => {`));
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
  /* Four full-size photographs at once is what makes a cheap phone stall.
     Two is the ceiling, and the second exists only while a finger is
     turning towards it. */
  const source = withoutComments(await sheetSource());
  assert.equal((source.match(/<img/g) || []).length, 2);
  assert.ok(source.includes('{dragTarget && aimPhoto?.status === "ready" && ('), "the second face is mounted only mid-turn");
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

test("without a photo the readings are listed but never pinned", async () => {
  /* A marker points at a spot on a photograph. On an empty frame it is a
     number floating on black, and it lands on top of the line explaining that
     there is no photo. */
  const source = withoutComments(await sheetSource());
  assert.ok(source.includes('const photoMarkersVisible = markersVisible && shownPhoto?.status === "ready" && !!photoRect;'));
  assert.ok(source.includes("{photoMarkersVisible && (() => {"));
  assert.ok(source.includes("{markersVisible && unplaced.length > 0"), "the list is not held back with them");
});

test("the bottom row is kept clear of the system bar", async () => {
  /* The directions and the sentence under them sat behind the navigation bar
     on a phone with gesture keys. */
  const source = withoutComments(await sheetSource());
  assert.ok(source.includes('<div className="safe-b px-3 pt-2">'));
});

test("the markers sit in the photo's own rectangle, not the frame's", async () => {
  /* A portrait photo in a portrait frame still leaves black bands above and
     below it. A marker coordinate is a fraction of the photo, so measuring it
     against the frame lifts every marker off the body by the size of a band. */
  const source = withoutComments(await sheetSource());
  assert.ok(source.includes("const photoRect = containPhotoRect(frameSize, naturalSize);"), "the rectangle is measured, not guessed");
  assert.ok(source.includes("observer.observe(node)"), "and re-measured when the frame changes");
  /* Read out of the event before the state updater runs: by the time React
     calls the updater, currentTarget is already cleared and reading through
     it throws inside render. */
  assert.ok(source.includes("const { naturalWidth: width, naturalHeight: height } = event.currentTarget;"), "its shape comes from the photo that loaded");
  assert.ok(!source.includes("event.currentTarget.natural"), "and not from an event that has moved on");
  const box = source.slice(source.indexOf("left: photoRect.left"), source.indexOf(") : ("));
  assert.ok(box.includes("<img") && box.includes("bodyViewMarkerFraction(metric.at"), "photo and markers share it");
});
test("a reading at the edge of the photo keeps its point and moves only its label", async () => {
  /* A landmark near the border used to put half the number outside the frame,
     where it could not be read. The point stays where it was measured; only
     the pill slides in, and a short line says which point it belongs to. */
  const source = withoutComments(await sheetSource());
  assert.ok(source.includes("const dot = { x: fraction.x * photoRect.width, y: fraction.y * photoRect.height };"), "the point is the measurement");
  assert.ok(source.includes("const label = clampLabelWithin(bodyViewLabelAnchor(metric.key, dot, photoRect) || dot, photoRect, {"),
    "only the label is moved, and the edge has the last word over it");
  assert.ok(source.includes("<circle cx={pin.dot.x} cy={pin.dot.y}"), "the point is drawn where it was measured");
  assert.ok(source.includes("{pin.moved && <line x1={pin.dot.x} y1={pin.dot.y} x2={pin.label.x} y2={pin.label.y}"), "and joined to its label when they part");
  assert.ok(source.includes("left: pin.label.x, top: pin.label.y"), "the pill follows the clamped place");
});

test("the label is placed by the frame edge, never by the size of the number", async () => {
  /* Only the coordinate and the box decide. A bigger reading does not move.
     (The label's own width is read from how many characters it has, which is
     about the pill, not about the measurement.) */
  const source = withoutComments(await sheetSource());
  const block = source.slice(source.indexOf("const pins = placed.map("), source.indexOf("return ("));
  assert.ok(!block.includes("metric.difference"), "the change never enters the placement");
  assert.ok(!block.includes("Math.abs(metric.value"), "nor does the size of the value");
});

test("the record's own verdict about hand-placed joints is repeated here", async () => {
  /* The result screen already says this about the same record. Saying it on
     one screen and not the other leaves the instructor guessing which set of
     numbers to trust. */
  const source = withoutComments(await sheetSource());
  assert.ok(source.includes("isFullyManualAfterAiMiss("), "the existing verdict is reused, not a new one");
  assert.ok(source.includes("관절을 직접 지정한 기록입니다"));
  const resultCopy = await readFile(new URL("../../src/features/posture/result-presentation.js", import.meta.url), "utf8");
  assert.ok(resultCopy.includes("관절을 모두 직접 지정한 결과입니다"), "and it says the same thing the other screen says");
});

test("a record the AI did read says nothing about hand-placed joints", () => {
  /* The fixture has no manual points, so the line must not appear. */
  assert.ok(!render({}).includes("관절을 직접 지정한 기록입니다"));
});

test("the notice sits with the other honest line, not as a warning", async () => {
  const source = withoutComments(await sheetSource());
  const start = source.indexOf("관절을 직접 지정한 기록입니다");
  const line = source.slice(source.lastIndexOf("<p", start), source.indexOf("</p>", start));
  assert.ok(line.includes("var(--sub)"), "the same quiet colour as the unaligned note");
  assert.ok(!line.includes("WARN") && !line.includes("--bad"), "it is not dressed as a fault");
  assert.ok(source.indexOf("MEASURED_FROM_NOTE}</p>") > start, "and it comes just before the source line");
});
test("the markers come off the body while it is being dragged", async () => {
  /* Mid-drag the photo is between two directions. A number pinned to it
     would be pointing at a spot that is no longer where it was measured. */
  const source = withoutComments(await sheetSource());
  assert.ok(source.includes("const markersVisible = phase === \"idle\" && !dragging && introStage >= 2 && !!shownEntry;"));
});

test("the photo is moved and narrowed, never bent", async () => {
  /* The drag shifts the picture sideways and squeezes it a little across
     the middle of the turn. It does not rotate it, skew it, or stretch it
     towards an angle nobody photographed. */
  const source = withoutComments(await sheetSource());
  assert.ok(source.includes("const css = `translateX(${shift * width}px) scaleX(${squeeze})`;"),
    "sideways travel and a horizontal squeeze, and nothing else");
  for (const forbidden of ["rotateY", "rotate3d", "skew", "perspective", "matrix3d", "scaleY"]) {
    assert.ok(!source.includes(forbidden), `${forbidden} would bend the body`);
  }
});

test("the body swings out and comes back, rather than fading in place", async () => {
  /* A fade says the picture changed. A body that leaves towards the side it
     was pushed, narrows, and comes back says it turned. */
  const model = withoutComments(await readFile(new URL("../../src/features/posture/posture-model.js", import.meta.url), "utf8"));
  assert.ok(model.includes("const swing = Math.sin(Math.PI * away);"), "out and back, not a ramp");
  assert.ok(model.includes("shift: (at < 0 ? -1 : 1) * swing * BODY_VIEW_DRAG_TRAVEL,"), "it goes the way the finger went");
  assert.ok(model.includes("squeeze: 1 - BODY_VIEW_DRAG_SQUEEZE * swing,"), "narrowest in the middle of the turn");
  assert.ok(model.includes("showTarget: away >= BODY_VIEW_DRAG_COMMIT_RATIO,"), "the faces swap where the body is narrowest");
});

test("where the finger is is where the screen is", async () => {
  /* The point of the fourth pass: it follows, rather than waiting for a
     threshold and jumping. And it follows without re-rendering -- a cheap
     phone drops frames if the alignment is worked out again each time. */
  const source = withoutComments(await sheetSource());
  assert.ok(source.includes("progress.current = bodyViewDragProgress(dx, frame.current?.clientWidth || 0, { blocked: !target });"));
  assert.ok(source.includes("painting.current = requestAnimationFrame(paint);"), "one paint per frame at most");
  const paint = source.slice(source.indexOf("const paint = useCallback"), source.indexOf("useAfterPaint"));
  for (const forbidden of ["useState", "setDrag", "composeBodyViewAlignment", "bodyViewMetrics", "bodyViewMarkerFraction"]) {
    assert.ok(!paint.includes(forbidden), `${forbidden} inside the paint would cost a frame`);
  }
});

test("the position dots move with the body, not after it", async () => {
  /* Otherwise the eye sees the next direction standing there while the dot
     still says the last one, and neither can be trusted. */
  const source = withoutComments(await sheetSource());
  assert.ok(source.includes("const eye = turned || shownView;"), "the dots read the face on screen");
  assert.ok(source.includes('node.style.backgroundColor = view === eye ? "var(--brand)" : "transparent";'));
});

test("a device asked to reduce motion is not dragged along in real time", async () => {
  /* Nothing follows the finger, and letting go changes direction straight
     away rather than gliding into place. */
  const source = withoutComments(await sheetSource());
  const move = source.slice(source.indexOf("const onPointerMove = useCallback"), source.indexOf("const endDrag = useCallback"));
  assert.ok(move.includes("if (reduced) return;"), "the follow is skipped before any progress is written");
  assert.ok(move.indexOf("if (reduced) return;") < move.indexOf("progress.current ="), "skipped, not undone afterwards");
  assert.ok(source.includes("if (reduced || from === to) { land(); return; }"), "and the settle is immediate");
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
  const move = source.slice(source.indexOf("const onPointerMove = useCallback"), source.indexOf("const endDrag = useCallback"));
  assert.ok(move.includes("finishIntro();"), "so does a finger");
  assert.ok(move.indexOf("finishIntro();") < move.indexOf("progress.current ="), "before it starts following, not after");
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
  assert.ok(source.includes("const pins = placed.map((metric, index) => {"));
  assert.ok(source.includes("filter((pin) => pin.index < revealed)"), "the list order is the reveal order");
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

/* --------------------------- separating the person ----------------------- */

test("only the direction on screen is separated", async () => {
  /* Four masks at once is what stalls a cheap phone. The work is keyed to the
     direction being looked at, and each direction is attempted once. */
  const source = withoutComments(await sheetSource());
  assert.ok(source.includes('if (!shownView || shownPhoto?.status !== "ready") return undefined;'));
  assert.ok(source.includes('if (cutoutRuns.current[runKey]) return undefined;'), 'a direction already attempted is left alone');
  assert.ok(source.includes('cutoutRuns.current[runKey] = true;'));
});

test("what the segmenter finishes is not thrown away", async () => {
  /* The defect this pins: the attempt was remembered in state, and that state
     was one of the effect's own dependencies. Starting the work changed the
     state, the dependencies changed, React ran the cleanup of the run that had
     only just begun, and the result was discarded -- so no cutout ever
     appeared. Nothing that reruns on a dependency change may cancel the work. */
  const source = withoutComments(await sheetSource());
  const start = source.indexOf('const runKey =');
  const deps = source.indexOf('}, [assessment, shownView, shownPhoto', start);
  assert.ok(start > 0 && deps > start, 'the cutout effect is where it is expected');
  const effect = source.slice(start, deps);
  assert.ok(!effect.includes('alive'), 'no per-run flag -- a dependency change would clear it');
  assert.ok(!source.slice(deps, source.indexOf(']);', deps)).includes('cutouts'), 'the cutout state is not its own dependency');
  assert.ok(effect.includes('if (!onScreen.current) return;'), 'only leaving the screen stops it');
});

test("leaving the screen is the one thing that stops the cutout", async () => {
  /* And the flag is armed on the way in, not only at birth: StrictMode keeps
     the same instance -- and so the same refs -- across its extra detach. */
  const source = withoutComments(await sheetSource());
  const armed = source.indexOf('onScreen.current = true;');
  assert.ok(armed > 0, 'the flag is set when the screen appears');
  const unmount = source.slice(armed, source.indexOf('}, []);', armed));
  assert.ok(unmount.includes('onScreen.current = false;'), 'turned off in the unmount cleanup');
  assert.equal((source.match(/onScreen\.current = false;/g) || []).length, 1, 'and nowhere else');
});

test("a mask already made is read, not made again", async () => {
  /* Re-entering the screen must not re-run the model. The mask lives on the
     pose, so the second visit is a read. */
  const source = withoutComments(await sheetSource());
  assert.ok(source.includes("const savedMaskId = bodyViewMaskId(assessment, shownView);"));
  assert.ok(source.includes("let maskUrl = savedMaskId ? await resolvePhotoUrl?.(savedMaskId) : null;"));
  const block = source.slice(source.indexOf("const savedMaskId"), source.indexOf("const mask = await decodeImage"));
  assert.ok(block.indexOf("if (!maskUrl) {") < block.indexOf("personMaskPng"), "the model runs only when there is no mask");
});

test("a mask that had to be made is kept for next time", async () => {
  const source = withoutComments(await sheetSource());
  assert.ok(source.includes("const storedId = await onSaveMask?.(assessment?.id, shownView, made.blob);"));
});

test("the original stays on screen until the cutout is ready", async () => {
  /* The photo is already up. Nothing waits on the model. */
  const source = withoutComments(await sheetSource());
  assert.ok(source.includes('src={shownCutout?.status === "ready" ? shownCutout.url : shownPhoto.url}'));
});

test("a failure anywhere leaves the photograph as it was", async () => {
  /* Model missing, mask unreadable, compose failing -- every branch falls back
     to the original rather than taking the direction away. */
  const source = withoutComments(await sheetSource());
  const from = source.indexOf('mark("working")');
  const block = source.slice(from, source.indexOf("return undefined;", from));
  assert.ok((block.match(/mark\("none"\)/g) || []).length >= 4, "every dead end marks it and stops");
  assert.ok(block.includes("catch (_error) {"), "and a thrown error does the same");
});

test("the diagnostics say how far the cutout got", async () => {
  /* Otherwise the screen shows the plain photograph and nothing says why. */
  const source = withoutComments(await sheetSource());
  assert.ok(source.includes('onSegmenterEvent?.("segmenter_cutout", { state: status, view: shownView });'));
  const voice = await readFile(new URL('../../src/features/voice/voice-session.js', import.meta.url), 'utf8');
  assert.ok(voice.includes('"segmenter_cutout"'), 'an unregistered event is dropped in silence');
});

test("the alignment and the markers are untouched by the cutout or the drag", async () => {
  /* The cutout changes only the alpha channel of the same pixel grid, and
     the drag moves the rectangle the photo sits in rather than the photo.
     Either way the transform the alignment produced, and the coordinates
     the markers are placed by, are the ones from the first pass. */
  const source = withoutComments(await sheetSource());
  const img = source.slice(source.indexOf("<img"), source.indexOf("/>", source.indexOf("<img")));
  assert.ok(img.includes("transform: shownEntry?.transform"), "the alignment, and nothing else, is on the photo");
  assert.ok(img.includes("scale(${shownEntry.transform.scale})"), "at the scale the first pass worked out");
  assert.ok(!img.includes("translateX") && !img.includes("scaleX"), "the drag is not folded into it");
  assert.ok(source.includes("placeOnFrame") === false, "markers still read bodyViewMarkerFraction");
  assert.ok(source.includes("bodyViewMarkerFraction(metric.at, shownEntry?.transform)"));
});

test("the markers ride with the photo instead of being placed again", async () => {
  /* The rectangle carrying the drag is the same one the photo and the pins
     are inside, so nothing has to be recomputed while a finger is moving. */
  const source = withoutComments(await sheetSource());
  const stage = source.indexOf("ref={stage}");
  assert.ok(stage > 0, "the rectangle is the thing that moves");
  assert.ok(stage < source.indexOf("photoMarkersVisible &&"), "and the markers are inside it");
});

test("the model is let go when the screen closes", async () => {
  const source = withoutComments(await sheetSource());
  assert.ok(source.includes("closeBodySegmenter();"));
});
