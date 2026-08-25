"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { MAX_AUDIO_BYTES, decodeAudioBase64 } = require("../src/audio-contract");
const { createM4aFixture } = require("./audio-fixtures");

test("audio contract accepts an m4a up to 90 seconds and reports safe metadata", () => {
  const decoded = decodeAudioBase64(createM4aFixture(90).toString("base64"));
  assert.equal(decoded.metadata.format, "m4a");
  assert.equal(decoded.metadata.durationSeconds, 90);
  assert.equal(decoded.metadata.mimeType, "audio/mp4");
});

test("audio contract rejects oversized, overlong, malformed, or unsupported payloads", () => {
  const oversized = createM4aFixture(10, MAX_AUDIO_BYTES + 1).toString("base64");
  const overlong = createM4aFixture(90.001).toString("base64");
  for (const value of [oversized, overlong, "not-base64", Buffer.alloc(64).toString("base64")]) {
    assert.throws(() => decodeAudioBase64(value), (error) => error.code === "invalid_request");
  }
});
