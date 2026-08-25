"use strict";

function createM4aFixture(durationSeconds = 10, byteLength = 96) {
  const buffer = Buffer.alloc(Math.max(64, byteLength));
  buffer.writeUInt32BE(24, 0);
  buffer.write("ftyp", 4, "ascii");
  buffer.write("M4A ", 8, "ascii");
  buffer.writeUInt32BE(32, 24);
  buffer.write("mvhd", 28, "ascii");
  buffer[32] = 0;
  buffer.writeUInt32BE(1000, 44);
  buffer.writeUInt32BE(Math.round(durationSeconds * 1000), 48);
  return buffer;
}

module.exports = { createM4aFixture };
