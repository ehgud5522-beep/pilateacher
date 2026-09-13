import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { TYPE, TYPE_MIN_PX, TYPE_STEPS, TYPE_STEP_NAMES, nearestTypeStep } from "../../src/features/ui/type-scale.js";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

/* Two thirds of the app's text was 12px or smaller, spread over fifteen
   different sizes. Fifteen sizes do not make a hierarchy -- 11px beside 12px
   says nothing about which matters. Six do, and the difference between them
   is carried by weight and colour rather than by another pixel. */

test("there are six sizes and the smallest is 13px", () => {
  assert.deepEqual(TYPE_STEP_NAMES, ["caption", "body", "title", "heading", "display", "hero"]);
  assert.deepEqual(Object.values(TYPE_STEPS), [13, 15, 17, 20, 24, 32]);
  assert.equal(TYPE_MIN_PX, 13);
});

test("the sizes only ever go up", () => {
  const values = TYPE_STEP_NAMES.map((name) => TYPE_STEPS[name]);
  for (let at = 1; at < values.length; at += 1) assert.ok(values[at] > values[at - 1], `${values[at]} follows ${values[at - 1]}`);
});

test("one place holds the value, and everything else points at it", async () => {
  /* An inline style and a class have to agree. They agree because neither
     carries a number -- both name the same custom property. */
  const css = await read("src/index.css");
  const tailwind = await read("tailwind.config.js");
  for (const [name, px] of Object.entries(TYPE_STEPS)) {
    assert.ok(css.includes(`--t-${name}: ${px}px;`), `--t-${name} is not defined as ${px}px`);
    assert.ok(tailwind.includes(`${name}: "var(--t-${name})"`), `text-${name} is not wired to the variable`);
    assert.equal(TYPE[name], `var(--t-${name})`);
  }
});

/* ------------------------- choosing a step ------------------------------- */

test("a size lands on the nearest step", () => {
  assert.equal(nearestTypeStep(8), "caption");
  assert.equal(nearestTypeStep(12), "caption");
  assert.equal(nearestTypeStep(15), "body");
  assert.equal(nearestTypeStep(18), "title");
  assert.equal(nearestTypeStep(21), "heading");
  assert.equal(nearestTypeStep(27), "display");
  assert.equal(nearestTypeStep(31), "hero");
});

test("exactly halfway goes up, never down", () => {
  /* 14 sits between 13 and 15. Rounding it down would make text smaller in a
     change whose whole purpose is that the text is too small. */
  assert.equal(nearestTypeStep(14), "body");
  assert.equal(nearestTypeStep(16), "title");
  assert.equal(nearestTypeStep(28), "hero");
});

test("a number that is not a size has no step", () => {
  for (const bad of [null, undefined, NaN, "abc", {}]) assert.equal(nearestTypeStep(bad), null);
});

test("anything above 40px is a graphic, not type", () => {
  /* The countdown numeral over the camera is 104px. Forcing it onto the scale
     would shrink a piece of the picture to the size of a heading. */
  assert.equal(nearestTypeStep(104), null);
  assert.equal(nearestTypeStep(41), null);
  assert.equal(nearestTypeStep(40), "hero");
});

/* ------------------- nothing arbitrary is left behind -------------------- */

/* Files nothing imports, and one screen that is switched off. */
const LIVE = [
  "src/App.jsx",
  "src/features/onboarding/Onboarding.jsx",
  "src/features/lesson-record/LessonHistorySessionRow.jsx",
  "src/features/lesson-record/NextLessonReflection.jsx",
];

test("no shipped screen sets a size in pixels any more", async () => {
  for (const path of LIVE) {
    const source = await read(path);
    const inline = [...source.matchAll(/fontSize:\s*(\d+(?:\.\d+)?)\s*[,}]/g)].map((match) => match[1]);
    assert.deepEqual(inline, [], `${path} still sets fontSize in pixels: ${inline.join(", ")}`);
    const classes = [...source.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)].map((match) => Number(match[1]));
    const typographic = classes.filter((px) => px <= 40);
    assert.deepEqual(typographic, [], `${path} still uses an arbitrary size: ${typographic.join(", ")}`);
  }
});

test("the one size left in pixels is the countdown, and it is a picture", async () => {
  const source = await read("src/App.jsx");
  const remaining = [...source.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)].map((match) => Number(match[1]));
  assert.deepEqual(remaining, [104]);
});

test("the week grid still shrinks its own text, and is meant to be next", async () => {
  /* Shrinking a name so it fits is the thing being removed, but that screen is
     the last commit of this change rather than this one. When it is done this
     test is what says so. */
  const source = await read("src/App.jsx");
  assert.match(source, /fontSize: labelLen >= 6 \? 8 :/, "the week card is still on its own sizing");
});

/* ------------------------------ the floor -------------------------------- */

test("the linter holds the floor rather than a reviewer", async () => {
  const config = await read("eslint.config.js");
  assert.match(config, /Property\[key\.name='fontSize'\]\[value\.value<13\]/, "an inline size below 13 is an error");
  assert.match(config, /text-\\\\\[\(\[0-9\]\|1\[0-2\]\)/, "an arbitrary class up to 12px is an error");
  assert.match(config, /src\/features\/posture\/BodyViewSheet\.jsx/, "the disabled screen is excused, on the record");
});
