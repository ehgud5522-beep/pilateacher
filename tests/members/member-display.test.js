import test from "node:test";
import assert from "node:assert/strict";
import { maskedBirth, maskedPhone, membershipDisplay } from "../../src/features/members/member-display.js";

test("member contact fields are masked on the first screen", () => {
  assert.equal(maskedPhone("010-1234-5678"), "010-****-5678");
  assert.equal(maskedPhone(""), "미등록");
  assert.equal(maskedBirth("1990-04-12", 36), "1990.**.** · 36세");
});

test("membership display treats the product name as a label and total as cumulative registration", () => {
  const display = membershipDisplay({ passName: "개인 100회", regular: 110, service: 0, total: 110 });
  assert.equal(display.remaining, 110);
  assert.equal(display.registeredTotal, 110);
  assert.equal(display.needsLegacyReview, false);
});

test("membership display flags impossible legacy counters without mutating them", () => {
  const source = { regular: 8, service: 3, total: 10 };
  const display = membershipDisplay(source);
  assert.equal(display.needsLegacyReview, true);
  assert.deepEqual(source, { regular: 8, service: 3, total: 10 });
});
