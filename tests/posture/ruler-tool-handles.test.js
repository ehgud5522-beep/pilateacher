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
   the move handle at x 0, the rotate handle 150px along. */
const RULER_HANDLE_HIT = 26;

const rulerGeom = (ruler, w, h) => {
  const C = { x: ruler.cx * w, y: ruler.cy * h };
  const rad = (ruler.deg * Math.PI) / 180;
  return { C, rad, u: { x: Math.cos(rad), y: Math.sin(rad) }, n: { x: -Math.sin(rad), y: Math.cos(rad) }, L: Math.hypot(w, h) * 1.3 };
};
const toLocal = (g, P) => { const dx = P.x - g.C.x, dy = P.y - g.C.y; return { x: dx * g.u.x + dy * g.u.y, y: dx * g.n.x + dy * g.n.y }; };
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
