import test from "node:test";
import assert from "node:assert/strict";
import {
  sheetDragOffset,
  shouldDismissSheet,
  shouldStartContentDismiss,
} from "../../src/features/ui/bottom-sheet-gesture.js";

test("sheet content keeps native scroll unless a downward gesture starts at scrollTop zero", () => {
  assert.equal(shouldStartContentDismiss({ scrollTop: 40, deltaX: 0, deltaY: 50 }), false);
  assert.equal(shouldStartContentDismiss({ scrollTop: 0, deltaX: 0, deltaY: -50 }), false);
  assert.equal(shouldStartContentDismiss({ scrollTop: 0, deltaX: 50, deltaY: 20 }), false);
  assert.equal(shouldStartContentDismiss({ scrollTop: 0, deltaX: 4, deltaY: 20 }), true);
});

test("Android and iOS style downward drags dismiss by distance or velocity", () => {
  assert.equal(sheetDragOffset(200, 170), 0);
  assert.equal(sheetDragOffset(200, 278), 78);
  assert.equal(shouldDismissSheet({ distance: 78, elapsedMs: 600 }), true);
  assert.equal(shouldDismissSheet({ distance: 32, elapsedMs: 40 }), true);
  assert.equal(shouldDismissSheet({ distance: 30, elapsedMs: 400 }), false);
});
