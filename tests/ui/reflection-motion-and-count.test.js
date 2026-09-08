import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  NEXT_LESSON_REFLECTION_COUNT_KEY, markNextLessonReflectionShown, shouldShowNextLessonReflection,
} from "../../src/features/lesson-record/lesson-record-presentation.js";

const appSource = () => readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
const component = () => readFile(new URL("../../src/features/lesson-record/NextLessonReflection.jsx", import.meta.url), "utf8");

function memoryStorage(initial = {}) {
  const cells = new Map(Object.entries(initial));
  return { getItem: (k) => (cells.has(k) ? cells.get(k) : null), setItem: (k, v) => cells.set(k, String(v)) };
}

/* --------------------------- 5. showing it less ------------------------- */

test("the first three saves show the screen, the fourth does not", () => {
  const storage = memoryStorage();
  for (let time = 1; time <= 3; time += 1) {
    assert.equal(shouldShowNextLessonReflection(storage), true, `save ${time} should still show it`);
    markNextLessonReflectionShown(storage);
  }
  assert.equal(shouldShowNextLessonReflection(storage), false, "by the fourth it is in the way, not informative");
});

test("the counter stops climbing once it is spent", () => {
  const storage = memoryStorage();
  for (let time = 0; time < 10; time += 1) markNextLessonReflectionShown(storage);
  assert.equal(storage.getItem(NEXT_LESSON_REFLECTION_COUNT_KEY), "3");
});

test("clearing the key starts the count over", () => {
  // Documented in the module so it can be reset while testing on a device.
  const storage = memoryStorage({ [NEXT_LESSON_REFLECTION_COUNT_KEY]: "3" });
  assert.equal(shouldShowNextLessonReflection(storage), false);
  storage.setItem(NEXT_LESSON_REFLECTION_COUNT_KEY, "0");
  assert.equal(shouldShowNextLessonReflection(storage), true);
});

test("the key is named in the module and documented", async () => {
  const source = await readFile(new URL("../../src/features/lesson-record/lesson-record-presentation.js", import.meta.url), "utf8");
  assert.equal(NEXT_LESSON_REFLECTION_COUNT_KEY, "pilateacher_next_lesson_reflection_count_v1");
  assert.match(source, /localStorage\.removeItem\("pilateacher_next_lesson_reflection_count_v1"\)/, "how to reset it is written down");
});

test("a broken or missing counter shows the screen rather than hiding it", () => {
  /* Failing closed here would silently remove the screen for good; failing
     open costs one extra appearance. */
  assert.equal(shouldShowNextLessonReflection(memoryStorage({ [NEXT_LESSON_REFLECTION_COUNT_KEY]: "nonsense" })), true);
  assert.equal(shouldShowNextLessonReflection(memoryStorage()), true);
  assert.equal(shouldShowNextLessonReflection(null), true);
  assert.equal(shouldShowNextLessonReflection({ getItem: () => { throw new Error("blocked"); } }), true);
});

test("it follows the pattern the guide counter already set", async () => {
  const source = await readFile(new URL("../../src/features/lesson-record/lesson-record-presentation.js", import.meta.url), "utf8");
  assert.match(source, /export function shouldShowNextLessonReflection\(storage, limit = 3\)/);
  assert.match(source, /export function markNextLessonReflectionShown\(storage, limit = 3\)/);
  assert.match(source, /export function shouldShowLessonRecordGuide\(storage, limit = 3\)/, "the original is untouched");
});

test("the count is only spent when the screen actually appears", async () => {
  const source = await appSource();
  /* Counting a save that produced no screen -- an unstructured record, or a
     re-confirmation -- would use the three up on nothing. */
  assert.match(source, /if \(nextReflection && shouldShowNextLessonReflection\(globalThis\.localStorage\)\) \{\s*\r?\n\s*markNextLessonReflectionShown\(globalThis\.localStorage\);\s*\r?\n\s*setReflection\(nextReflection\);/);
});

test("past the third save the toast still happens", async () => {
  const source = await appSource();
  const start = source.indexOf("const saveNote = async (id, note) => {");
  const body = source.slice(start, source.indexOf("const deleteNote", start));
  // The screen was an addition to the save, never a replacement for its reply.
  assert.match(body, /setToast\(\{ ok: true, msg: "코멘트를 저장했습니다\." \}\)/);
  assert.match(body, /setTab\("schedule"\);/);
});

/* ----------------------------- 4. the motion ---------------------------- */

test("the card arrives before the words on it", async () => {
  const source = await component();
  /* The point is the order: a record moving onto next lesson's card. Both at
     once shows nothing. */
  assert.match(source, /opacity: stage === "hidden" \? 0 : 1,/);
  assert.match(source, /opacity: stage === "settled" \? 1 : 0,/);
  assert.match(source, /setStage\("card"\);/);
  assert.match(source, /setTimeout\?\.\(\(\) => setStage\("settled"\), CARD_ENTER_MS \+ HOLD_MS\)/);
});

test("the whole thing stays under 1.2 seconds", async () => {
  const source = await component();
  const value = (name) => Number(source.match(new RegExp(`const ${name} = (\\d+);`))[1]);
  const total = value("CARD_ENTER_MS") + value("HOLD_MS") + value("TEXT_ENTER_MS");
  assert.equal(value("CARD_ENTER_MS"), 300);
  assert.equal(value("HOLD_MS"), 400);
  assert.equal(value("TEXT_ENTER_MS"), 400);
  assert.ok(total <= 1200, `${total}ms is longer than the save should take`);
});

test("reduced motion gets the finished state with no transition", async () => {
  const source = await component();
  assert.match(source, /matchMedia\?\.\("\(prefers-reduced-motion: reduce\)"\)/);
  assert.match(source, /if \(reduced\) \{ setStage\("settled"\); return undefined; \}/);
  // Not merely faster -- no transition at all.
  assert.equal((source.match(/transition: reduced \? "none" :/g) || []).length, 2);
});

test("a change of that setting is picked up", async () => {
  const source = await component();
  assert.match(source, /media\.addEventListener\?\.\("change", onChange\)/);
  assert.match(source, /return \(\) => media\.removeEventListener\?\.\("change", onChange\)/);
});

test("a browser without matchMedia still shows the screen", async () => {
  const source = await component();
  // Guarded both at first read and on subscribe.
  assert.equal((source.match(/catch \(_error\) \{ return false; \}|catch \(_error\) \{ media = null; \}/g) || []).length, 2);
  assert.match(source, /if \(!media\) return undefined;/);
});

test("the hooks run before the component decides not to draw", async () => {
  const source = await component();
  /* An early return above a hook changes the hook order between renders and
     React throws. */
  const reducedAt = source.indexOf("const reduced = usePrefersReducedMotion();");
  const effectAt = source.indexOf("useEffect(() => {\n    if (!reflection)");
  const returnAt = source.indexOf("if (!reflection) return null;");
  assert.ok(reducedAt >= 0 && reducedAt < returnAt);
  assert.ok(effectAt >= 0 && effectAt < returnAt, "the stage effect too");
});

test("the timer is cleared when the screen goes", async () => {
  const source = await component();
  assert.match(source, /return \(\) => globalThis\.clearTimeout\?\.\(timer\);/);
});
