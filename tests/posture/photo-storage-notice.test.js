import assert from "node:assert/strict";
import test from "node:test";

import { claimLocalPhotoNotice } from "../../src/features/posture/photo-storage-notice.js";

test("a storage failure never fabricates a claimed local-photo notice", () => {
  const storage = {
    getItem() { return null; },
    setItem() { throw new Error("quota"); },
  };
  assert.equal(claimLocalPhotoNotice(storage), false);
});
