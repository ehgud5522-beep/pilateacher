import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appSource = () => readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
const editor = async () => {
  const source = await appSource();
  const start = source.indexOf("function PostureCanvas(");
  return source.slice(start, source.indexOf("\nfunction ", start + 50));
};

/* The ruler's geometry and its handle rule, lifted from App.jsx. Local x runs
   along the ruler, local y away from it; the two handles sit at local y 26 --
   the move handle at x 0, the rotate handle 150px along.

   2026-11-15: the ruler is screen-sized. k is the photo zoom; local coordinates
   and L are screen pixels, C is in photo pixels. At zoom 1 nothing changes. */
const RULER_HANDLE_HIT = 26;

const rulerGeom = (ruler, w, h, zoom = 1) => {
  const C = { x: ruler.cx * w, y: ruler.cy * h };
  const rad = (ruler.deg * Math.PI) / 180;
  return { C, rad, u: { x: Math.cos(rad), y: Math.sin(rad) }, n: { x: -Math.sin(rad), y: Math.cos(rad) }, k: zoom, L: Math.hypot(w, h) * 1.3 * zoom };
};
const toLocal = (g, P) => { const dx = (P.x - g.C.x) * g.k, dy = (P.y - g.C.y) * g.k; return { x: dx * g.u.x + dy * g.u.y, y: dx * g.n.x + dy * g.n.y }; };
const rulerHandleAt = (g, P) => {
  if (!g) return null;
  const lp = toLocal(g, P);
  const rx = Math.min(150, g.L / 2 - 30);
  if (Math.hypot(lp.x - rx, lp.y - 26) < RULER_HANDLE_HIT) return "rot";
  if (Math.hypot(lp.x, lp.y - 26) < RULER_HANDLE_HIT) return "move";
  return null;
};

/* A level ruler across the middle of a 400x600 frame. */
const W = 400, H = 600;
const flat = { cx: 0.5, cy: 0.5, deg: 0 };
const geom = () => rulerGeom(flat, W, H);
/* Local (x, y) -> frame point, for a level ruler centred at (200, 300). */
const at = (x, y) => ({ x: 200 + x, y: 300 + y });

/* --------------------- 19-2. the handles are the ruler ------------------ */

test("the move handle is grabbable", () => {
  assert.equal(rulerHandleAt(geom(), at(0, 26)), "move");
  assert.equal(rulerHandleAt(geom(), at(0, 10)), "move", "and has a finger-sized target");
});

test("the rotate handle is grabbable", () => {
  assert.equal(rulerHandleAt(geom(), at(150, 26)), "rot");
});

test("the ruler body is not a handle", () => {
  /* This is the change: the whole body and everything below it used to grab
     the ruler, which is why the pen never reached the photo. */
  for (const x of [-300, -80, 60, 300]) {
    assert.equal(rulerHandleAt(geom(), at(x, 26)), null, `x=${x} on the body must be free`);
  }
});

test("the area far below the ruler is not a handle", () => {
  for (const y of [80, 200, 400]) {
    assert.equal(rulerHandleAt(geom(), at(0, y)), null, `y=${y} must be free`);
  }
});

test("the area above the ruler is not a handle", () => {
  for (const y of [-10, -60, -200]) {
    assert.equal(rulerHandleAt(geom(), at(0, y)), null);
  }
});

test("the handles follow the ruler when it is turned", () => {
  // The handles are defined in the ruler's own frame, so rotating carries them.
  const turned = rulerGeom({ cx: 0.5, cy: 0.5, deg: 90 }, W, H);
  // Local (0, 26) with the ruler at 90deg lands 26px to the left in the frame.
  assert.equal(rulerHandleAt(turned, { x: 200 - 26, y: 300 }), "move");
  assert.equal(rulerHandleAt(turned, { x: 200, y: 300 + 150 }), "rot");
});

test("the two handles do not overlap", () => {
  // 150px apart with a 26px radius each.
  assert.equal(rulerHandleAt(geom(), at(150, 26)), "rot");
  assert.equal(rulerHandleAt(geom(), at(0, 26)), "move");
  assert.equal(rulerHandleAt(geom(), at(75, 26)), null, "the gap between them is free");
});

/* ---------------- the ruler does not grow with the photo ---------------- */

test("zooming the photo leaves the ruler the same size on screen", () => {
  /* 대표: "자 기능이 확대하면 자도 같이 확대가 됨". At 3x the move handle is still
     26 screen px below the edge -- which is 26/3 photo px. */
  const zoomed = rulerGeom(flat, W, H, 3);
  assert.equal(rulerHandleAt(zoomed, at(0, 26 / 3)), "move");
  assert.equal(rulerHandleAt(zoomed, at(150 / 3, 26 / 3)), "rot");
  // Where the handle sat before the zoom is now far outside its finger target.
  assert.equal(rulerHandleAt(zoomed, at(150, 26)), null);
  assert.equal(rulerHandleAt(zoomed, at(0, 26 + 20)), null);
});

test("the editor draws and snaps with the same zoom factor", async () => {
  const source = await editor();
  assert.match(source, /k: zoom, L: Math\.hypot\(w, h\) \* 1\.3 \* zoom \};/);
  assert.match(source, /const dx = \(P\.x - g\.C\.x\) \* g\.k, dy = \(P\.y - g\.C\.y\) \* g\.k;/);
  assert.match(source, /ctx\.translate\(g\.C\.x, g\.C\.y\); ctx\.rotate\(g\.rad\);\s*\r?\n\s*ctx\.scale\(1 \/ g\.k, 1 \/ g\.k\);/);
  // The snapped point goes back to photo pixels, or the pen would land off the edge when zoomed.
  assert.match(source, /x: \(g\.C\.x \+ \(lp\.x \/ g\.k\) \* g\.u\.x\) \/ w/);
  /* The ruler and the handles live on their own layer above the photo. The photo
     canvas is stretched by CSS when zoomed and goes soft; the tool layer is not
     stretched -- it applies the same zoom and pan to coordinates only. */
  assert.match(source, /ctx\.translate\(w \/ 2 \+ pan\.x, h \/ 2 \+ pan\.y\); ctx\.scale\(zoom, zoom\); ctx\.translate\(-w \/ 2, -h \/ 2\);/);
  assert.match(source, /if \(ruler\) drawRuler\(ctx, w, h\);\s*\r?\n\s*\}, \[marks, ruler, color, size, selectedMarkId, zoom, pan\]\);/);
  assert.match(source, /<canvas ref=\{toolLayerRef\} className="pointer-events-none absolute inset-0" aria-hidden="true" \/>/);
  // The exported image comes from the photo canvas alone, so the tools can never be saved into it.
  const photoDraw = source.slice(source.indexOf("const draw = useCallback("), source.indexOf("const drawTools = useCallback("));
  assert.doesNotMatch(photoDraw, /drawRuler\(|drawSelection\(/);
  // Turned on while zoomed in, the ruler appears in the middle of what is visible.
  assert.match(source, /const toggleRuler = \(\) => \{[\s\S]*?screenPointToImagePoint\(\{ clientX: frame\.left \+ frame\.width \/ 2/);
});

/* ------------------------------ the wiring ------------------------------ */

test("two fingers always mean zoom now, ruler or not", async () => {
  const source = await editor();
  /* The ruler used to claim the two-finger gesture outright, so turning it on
     turned zooming off. */
  assert.match(source, /\/\* 손가락이 둘이면 자가 켜져 있든 아니든 사진 확대·이동이다 \*\/\s*\r?\n\s*if \(ptrs\.current\.size === 2\) \{/);
  assert.doesNotMatch(source, /ptrs\.current\.size === 2 && !ruler/);
  assert.doesNotMatch(source, /ptrs\.current\.size === 2 && ruler/);
  // And the move handler pinches without asking about the ruler too.
  assert.match(source, /if \(pinch\.current && ptrs\.current\.size >= 2\) \{/);
  assert.doesNotMatch(source, /ptrs\.current\.size >= 2 && !ruler/);
});

test("starting a pinch drops any ruler drag in progress", async () => {
  const source = await editor();
  /* A second finger arriving mid-drag must hand the gesture to the zoom, not
     leave the ruler following one of the two fingers. */
  assert.match(source, /rulerDrag\.current = null;\s*\r?\n\s*pinch\.current = \{/);
});

test("a one-finger press grabs the ruler only on a handle", async () => {
  const source = await editor();
  assert.match(source, /const handle = rulerHandleAt\(g, P\);/);
  assert.match(source, /if \(handle === "rot"\) \{ rulerDrag\.current = \{ mode: "rot"/);
  assert.match(source, /if \(handle === "move"\) \{ rulerDrag\.current = \{ mode: "move"/);
  // The old catch-all is gone.
  assert.doesNotMatch(source, /if \(lp\.y >= -1\) \{ rulerDrag\.current = \{ mode: "move"/);
});

test("the ruler still refuses to be drawn through", async () => {
  const source = await editor();
  /* The ruler behaves like a real one: nothing is drawn on its body or below
     it. That rule always existed in rulerZone; the move-grab simply hid it. */
  assert.match(source, /if \(!rulerZone\(raw\)\.ok\) return;/);
  assert.match(source, /if \(lp\.y >= -1\) return \{ ok: false, pt: p, lp \};/);
});

test("the handle rule lives in one place", async () => {
  const source = await appSource();
  // down and any future caller read the same function, so the touch target
  // cannot drift from the drawn handle.
  assert.equal((source.match(/const rulerHandleAt = \(g, P\) =>/g) || []).length, 1);
  assert.match(source, /const RULER_HANDLE_HIT = 26;/);
  assert.equal((source.match(/rulerHandleAt\(g, P\)/g) || []).length, 1, "one call site, reading the one definition");
});

test("the ruler two-finger gesture state is gone entirely", async () => {
  const source = await appSource();
  // A ref left behind would keep an unreachable branch alive in up().
  assert.doesNotMatch(source, /const gest = useRef\(null\);/);
  assert.doesNotMatch(source, /gest\.current/);
  assert.match(source, /if \(ptrs\.current\.size >= 1 && !draft\) return;/);
});

test("the snap behaviour is untouched by this step", async () => {
  const source = await editor();
  /* 19-1 moves the ruler out of the photo transform and has to keep snapPt in
     step with it. Nothing here may change that shared coordinate path yet. */
  assert.match(source, /const snapPt = \(p\) => rulerZone\(p\)\.pt;/);
  assert.match(source, /const p = ruler \? snapPt\(raw\) : raw;/);
  assert.match(source, /if \(ruler\) \{ const z = rulerZone\(raw\); if \(!z\.ok\) return; \}/);
});
