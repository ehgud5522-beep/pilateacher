import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

import {
  ANNOTATION_MIN_CORE_WIDTH,
  ANNOTATION_OUTLINE_DARK,
  ANNOTATION_OUTLINE_LIGHT,
  ANNOTATION_OUTLINE_MAX_WIDTH,
  ANNOTATION_OUTLINE_MIN_WIDTH,
  ANNOTATION_PRESET_COLORS,
  annotationOutlineColor,
  annotationOutlineWidth,
  annotationRelativeLuminance,
  annotationStrokeLayers,
} from "../../src/features/posture/posture-annotations.js";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));

const contrastRatio = (a, b) => {
  const [high, low] = [annotationRelativeLuminance(a), annotationRelativeLuminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
};

/* ------------------------------------------------------------- the rule ---- */

test("every stroke colour gets a halo on the opposite side of the luminance range", () => {
  for (const { color, label } of ANNOTATION_PRESET_COLORS) {
    const outline = annotationOutlineColor(color);
    assert.ok(
      outline === ANNOTATION_OUTLINE_DARK || outline === ANNOTATION_OUTLINE_LIGHT,
      `${label} got an unexpected halo`,
    );
    assert.ok(contrastRatio(color, outline) >= 3, `${label} (${color}) has too little contrast against its halo`);
  }

  // The colours that caused the report are the ones that gain the most.
  assert.equal(annotationOutlineColor("#FFFFFF"), ANNOTATION_OUTLINE_DARK);
  assert.equal(annotationOutlineColor("#17171F"), ANNOTATION_OUTLINE_LIGHT);
  assert.ok(contrastRatio("#FFFFFF", annotationOutlineColor("#FFFFFF")) > 15);
});

test("the halo removes the background that made each colour vanish", () => {
  /* The symptom was a white line on a white wall. For every colour there is
     some background it matches almost exactly, where the bare stroke drops to
     about 1.0 -- invisible. Sweeping the grey range measures the worst case
     with and without the halo. */
  const backgrounds = Array.from({ length: 101 }, (_, step) => {
    const channel = Math.round((step / 100) * 255).toString(16).padStart(2, "0").toUpperCase();
    return `#${channel}${channel}${channel}`;
  });

  for (const { color, label } of ANNOTATION_PRESET_COLORS) {
    const outline = annotationOutlineColor(color);
    let bareFloor = Infinity;
    let haloedFloor = Infinity;
    for (const background of backgrounds) {
      const bare = contrastRatio(color, background);
      bareFloor = Math.min(bareFloor, bare);
      haloedFloor = Math.min(haloedFloor, Math.max(bare, contrastRatio(outline, background)));
    }

    assert.ok(bareFloor < 1.1, `${label} was expected to have a background it vanishes against`);
    assert.ok(haloedFloor >= 1.85, `${label} (${color}) still vanishes somewhere: floor ${haloedFloor.toFixed(2)}`);
    assert.ok(haloedFloor / bareFloor >= 1.8, `${label} gained too little: x${(haloedFloor / bareFloor).toFixed(2)}`);
  }

  // White and black are the colours the report named, and they gain the most.
  for (const color of ["#FFFFFF", "#17171F"]) {
    const outline = annotationOutlineColor(color);
    const floor = Math.min(...backgrounds.map((background) => Math.max(
      contrastRatio(color, background),
      contrastRatio(outline, background),
    )));
    assert.ok(floor >= 4.2, `${color} floor is only ${floor.toFixed(2)}`);
  }
});

test("an arbitrary custom colour is handled, not just the presets", () => {
  for (let hue = 0; hue < 360; hue += 15) {
    for (const lightness of [10, 30, 50, 70, 90]) {
      const channel = Math.round((lightness / 100) * 255).toString(16).padStart(2, "0").toUpperCase();
      const color = `#${channel}${Math.min(255, hue).toString(16).padStart(2, "0").toUpperCase()}${channel}`;
      const outline = annotationOutlineColor(color);
      assert.ok(contrastRatio(color, outline) >= 2.4, `${color} has too little contrast against its halo`);
    }
  }
  // An unparseable colour still yields a usable halo rather than throwing.
  assert.equal(annotationOutlineColor("not a colour"), ANNOTATION_OUTLINE_LIGHT);
});

/* ------------------------------------------------------------ the width ---- */

test("the halo grows the stroke by one outline width, not two", () => {
  for (const markWidth of [2, 4, 6]) {
    for (const lineScale of [1, 1.2, 1.43, 3]) {
      const strokeWidth = Math.max(0.8, markWidth * lineScale);
      const { halo, core, outline } = annotationStrokeLayers(strokeWidth, lineScale);
      assert.equal(halo, strokeWidth + outline, "the halo takes half the outline outwards");
      if (strokeWidth - outline >= ANNOTATION_MIN_CORE_WIDTH) {
        assert.equal(core, strokeWidth - outline, "and the other half off the core");
      }
      // Option (c): the footprint grows by one outline, never two.
      assert.ok(halo <= strokeWidth + ANNOTATION_OUTLINE_MAX_WIDTH);
      assert.ok(halo / strokeWidth <= 1.6, `a ${markWidth}px stroke at ${lineScale}x grew ${(halo / strokeWidth).toFixed(2)}x`);
      assert.ok(core > 0, "the coloured core must survive");
      assert.ok(core < halo, "the halo must be wider than the core to show at all");
    }
  }
});

test("the outline tracks the render scale but stays within one to two pixels", () => {
  assert.equal(annotationOutlineWidth(1), 1);
  assert.ok(annotationOutlineWidth(0.05) === ANNOTATION_OUTLINE_MIN_WIDTH, "never thinner than the floor");
  assert.ok(annotationOutlineWidth(99) === ANNOTATION_OUTLINE_MAX_WIDTH, "never thicker than the cap");
  // The editor renders around 1.2x and an exported card at 3x; both stay in range.
  for (const lineScale of [1.2, 1.43, 3]) {
    const outline = annotationOutlineWidth(lineScale);
    assert.ok(outline >= ANNOTATION_OUTLINE_MIN_WIDTH && outline <= ANNOTATION_OUTLINE_MAX_WIDTH);
  }
});

test("a hairline stroke keeps a visible core instead of being swallowed", () => {
  const { core, halo } = annotationStrokeLayers(0.8, 3);
  assert.equal(core, ANNOTATION_MIN_CORE_WIDTH);
  assert.ok(halo > core);
});

/* ------------------------------- the two renderers must not diverge -------- */

/* Records what the canvas renderer paints. drawAnnotationMark only uses these
   primitives, so a plain recorder is enough -- no canvas implementation needed. */
function recordingContext() {
  const strokes = [];
  const fills = [];
  const state = { strokeStyle: "", fillStyle: "", lineWidth: 0, font: "", globalAlpha: 1 };
  const stack = [];
  return {
    strokes,
    fills,
    get state() { return state; },
    save() { stack.push({ ...state }); },
    restore() { Object.assign(state, stack.pop() || state); },
    beginPath() {}, moveTo() {}, lineTo() {}, arc() {}, ellipse() {}, rect() {},
    setLineDash() {}, strokeRect() {}, fillRect() {},
    stroke() { strokes.push({ color: String(state.strokeStyle).toUpperCase(), width: Number(state.lineWidth), alpha: state.globalAlpha }); },
    fill() { fills.push({ color: String(state.fillStyle).toUpperCase() }); },
    strokeText() { strokes.push({ color: String(state.strokeStyle).toUpperCase(), width: Number(state.lineWidth), text: true }); },
    fillText() { fills.push({ color: String(state.fillStyle).toUpperCase(), text: true }); },
    measureText(value) { return { width: String(value).length * 7 }; },
    set strokeStyle(value) { state.strokeStyle = value; }, get strokeStyle() { return state.strokeStyle; },
    set fillStyle(value) { state.fillStyle = value; }, get fillStyle() { return state.fillStyle; },
    set lineWidth(value) { state.lineWidth = value; }, get lineWidth() { return state.lineWidth; },
    set font(value) { state.font = value; }, get font() { return state.font; },
    set globalAlpha(value) { state.globalAlpha = value; }, get globalAlpha() { return state.globalAlpha; },
    set lineCap(value) { state.lineCap = value; }, get lineCap() { return state.lineCap; },
    set lineJoin(value) { state.lineJoin = value; }, get lineJoin() { return state.lineJoin; },
    set miterLimit(value) { state.miterLimit = value; }, get miterLimit() { return state.miterLimit; },
    set textAlign(value) { state.textAlign = value; }, get textAlign() { return state.textAlign; },
    set textBaseline(value) { state.textBaseline = value; }, get textBaseline() { return state.textBaseline; },
    set shadowColor(value) { state.shadowColor = value; }, get shadowColor() { return state.shadowColor; },
    set shadowBlur(value) { state.shadowBlur = value; }, get shadowBlur() { return state.shadowBlur; },
    set shadowOffsetY(value) { state.shadowOffsetY = value; }, get shadowOffsetY() { return state.shadowOffsetY; },
  };
}

/* Every stroke and stroke-width the SVG renderer emits, in document order. */
function svgStrokes(markup) {
  return [...markup.matchAll(/<(?:path|line|ellipse|rect|circle|text)\b[^>]*>/g)]
    .map((match) => match[0])
    .map((tag) => ({
      color: (/stroke="([^"]+)"/.exec(tag)?.[1] || "").toUpperCase(),
      width: Number(/stroke-width="([^"]+)"/.exec(tag)?.[1] || 0),
    }))
    .filter((entry) => entry.color && entry.color !== "NONE" && entry.width > 0);
}

const TOOLS = [
  { tool: "pen", pts: [{ x: 0.2, y: 0.2 }, { x: 0.5, y: 0.4 }, { x: 0.7, y: 0.8 }] },
  { tool: "arrow", pts: [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.7 }] },
  { tool: "hline", pts: [{ x: 0.1, y: 0.35 }] },
  { tool: "vline", pts: [{ x: 0.45, y: 0.1 }] },
  { tool: "circle", pts: [{ x: 0.2, y: 0.2 }, { x: 0.7, y: 0.6 }] },
  { tool: "rect", pts: [{ x: 0.2, y: 0.2 }, { x: 0.7, y: 0.6 }] },
  { tool: "point", pts: [{ x: 0.4, y: 0.4 }] },
  { tool: "angle", pts: [{ x: 0.3, y: 0.3 }, { x: 0.7, y: 0.5 }] },
  { tool: "text", pts: [{ x: 0.3, y: 0.3 }], label: "메모" },
];

test("the canvas renderer and the SVG overlay agree on every halo colour and width", async (t) => {
  const vite = await createServer({
    root: projectRoot,
    configFile: false,
    plugins: [react()],
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true },
    ssr: { noExternal: ["@capgo/camera-preview"] },
    logLevel: "silent",
  });
  t.after(() => vite.close());
  const { annotationRenderers } = await vite.ssrLoadModule("/src/App.jsx");
  const { drawAnnotationMark, AnnotationSvgMark } = annotationRenderers;

  // Both renderers use canvasWidth/300 as their scale, so the same size makes
  // their numbers directly comparable.
  const width = 300, height = 400;

  for (const { color, label } of ANNOTATION_PRESET_COLORS) {
    for (const shape of TOOLS) {
      for (const markWidth of [2, 4, 6]) {
        const mark = { id: `${shape.tool}_${markWidth}`, color, width: markWidth, opacity: 1, ...shape };

        const ctx = recordingContext();
        drawAnnotationMark(ctx, mark, width, height, { lineScale: width / 300, fontScale: width / 300 });

        const emitted = svgStrokes(renderToStaticMarkup(
          AnnotationSvgMark({ mark, canvasWidth: width, canvasHeight: height, hideLabel: false }),
        ));

        const outline = annotationOutlineColor(color);
        const where = `${label} ${shape.tool} w${markWidth}`;

        // Both must paint the halo colour, and with identical widths.
        const canvasHalo = ctx.strokes.filter((entry) => entry.color === outline.toUpperCase());
        const svgHalo = emitted.filter((entry) => entry.color === outline.toUpperCase());
        assert.ok(canvasHalo.length > 0, `${where}: canvas painted no halo`);
        assert.ok(svgHalo.length > 0, `${where}: svg painted no halo`);

        const round = (list) => [...new Set(list.map((entry) => Number(entry.width.toFixed(3))))].sort((a, b) => a - b);
        assert.deepEqual(
          round(svgHalo),
          round(canvasHalo),
          `${where}: halo widths differ between canvas and svg`,
        );

        // And the coloured core, likewise.
        if (shape.tool !== "text") {
          const canvasCore = round(ctx.strokes.filter((entry) => entry.color === color.toUpperCase()));
          const svgCore = round(emitted.filter((entry) => entry.color === color.toUpperCase()));
          assert.deepEqual(svgCore, canvasCore, `${where}: core widths differ between canvas and svg`);
        }
      }
    }
  }
});

test("both renderers keep a translucent mark's halo equally translucent", async (t) => {
  const vite = await createServer({
    root: projectRoot,
    configFile: false,
    plugins: [react()],
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true },
    ssr: { noExternal: ["@capgo/camera-preview"] },
    logLevel: "silent",
  });
  t.after(() => vite.close());
  const { annotationRenderers } = await vite.ssrLoadModule("/src/App.jsx");

  const mark = { id: "faded", tool: "pen", color: "#FFFFFF", width: 4, opacity: 0.4, pts: [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.8 }] };

  // Canvas: globalAlpha is set once and covers the halo pass too.
  const ctx = recordingContext();
  ctx.globalAlpha = 1;
  annotationRenderers.drawAnnotationMark(ctx, mark, 300, 400, { lineScale: 1, fontScale: 1 });
  assert.ok(ctx.strokes.length >= 2, "a halo and a core were painted");
  assert.ok(ctx.strokes.every((entry) => entry.alpha === 0.4), "every pass, halo included, uses the mark's own alpha");

  // SVG: the opacity sits on the group wrapping both passes.
  const markup = renderToStaticMarkup(
    annotationRenderers.AnnotationSvgMark({ mark, canvasWidth: 300, canvasHeight: 400, hideLabel: false }),
  );
  assert.match(markup, /opacity="0\.4"/);
  assert.equal(svgStrokes(markup).length, 2, "one halo and one core");
});

test("the halo is painted before the colour, so it lands underneath", async (t) => {
  const vite = await createServer({
    root: projectRoot,
    configFile: false,
    plugins: [react()],
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true },
    ssr: { noExternal: ["@capgo/camera-preview"] },
    logLevel: "silent",
  });
  t.after(() => vite.close());
  const { annotationRenderers } = await vite.ssrLoadModule("/src/App.jsx");
  const mark = { id: "order", tool: "pen", color: "#FFFFFF", width: 4, opacity: 1, pts: [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.8 }] };

  const ctx = recordingContext();
  annotationRenderers.drawAnnotationMark(ctx, mark, 300, 400, { lineScale: 1, fontScale: 1 });
  assert.equal(ctx.strokes[0].color, ANNOTATION_OUTLINE_DARK.toUpperCase(), "canvas paints the halo first");
  assert.equal(ctx.strokes[1].color, "#FFFFFF");
  assert.ok(ctx.strokes[0].width > ctx.strokes[1].width, "and wider");

  const emitted = svgStrokes(renderToStaticMarkup(
    annotationRenderers.AnnotationSvgMark({ mark, canvasWidth: 300, canvasHeight: 400, hideLabel: false }),
  ));
  assert.equal(emitted[0].color, ANNOTATION_OUTLINE_DARK.toUpperCase(), "svg emits the halo first, so it renders below");
  assert.equal(emitted[1].color, "#FFFFFF");
  assert.ok(emitted[0].width > emitted[1].width);
});

test("text is outlined rather than shadowed, in both renderers", async (t) => {
  const vite = await createServer({
    root: projectRoot,
    configFile: false,
    plugins: [react()],
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true },
    ssr: { noExternal: ["@capgo/camera-preview"] },
    logLevel: "silent",
  });
  t.after(() => vite.close());
  const { annotationRenderers } = await vite.ssrLoadModule("/src/App.jsx");
  const mark = { id: "memo", tool: "text", color: "#FFFFFF", width: 4, opacity: 1, pts: [{ x: 0.3, y: 0.3 }], label: "메모" };

  const ctx = recordingContext();
  annotationRenderers.drawAnnotationMark(ctx, mark, 300, 400, { lineScale: 1, fontScale: 1 });
  const outlined = ctx.strokes.filter((entry) => entry.text);
  assert.ok(outlined.length > 0, "canvas strokes the glyphs");
  assert.equal(outlined[0].color, ANNOTATION_OUTLINE_DARK.toUpperCase());
  // A drop shadow only worked on light ground, so it must be gone.
  assert.equal(ctx.state.shadowColor, undefined);

  const markup = renderToStaticMarkup(
    annotationRenderers.AnnotationSvgMark({ mark, canvasWidth: 300, canvasHeight: 400, hideLabel: false }),
  );
  assert.match(markup, /paint-order="stroke"/);
  assert.match(markup, new RegExp(`stroke="${ANNOTATION_OUTLINE_DARK}"`, "i"));
  assert.doesNotMatch(markup, /stroke="rgba\(0,0,0,\.42\)"/, "the fixed dark outline is replaced by the contrast rule");
});
