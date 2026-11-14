"use strict";
const { createHash } = require("node:crypto");
const MAX_BYTES = 4 * 1024 * 1024;
const fail = (code) => { throw Object.assign(new Error(code), { code, httpsCode: "failed-precondition" }); };
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
function validateCard(input) {
  if (typeof input.cardBase64 !== "string") fail("share/card-not-jpeg");
  if (input.cardBase64.length > Math.ceil(MAX_BYTES / 3) * 4) fail("share/card-too-large");
  const bytes = Buffer.from(input.cardBase64, "base64");
  if (bytes.length > MAX_BYTES) fail("share/card-too-large");
  if (bytes.toString("base64") !== input.cardBase64 || bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255) fail("share/card-not-jpeg");
  if (digest(bytes) !== input.sha256) fail("share/card-hash-mismatch");
  if (typeof input.comment !== "string" || input.comment.length > 120) fail("share/card-comment-too-long");
  if (input.width !== 1200 || !Number.isInteger(input.height) || input.height < 600 || input.height > 3000) fail("share/card-dimensions");
  // Check the JPEG's own dimensions, not only untrusted request fields.
  let offset = 2, dimensions;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 255) fail("share/card-not-jpeg");
    const marker = bytes[offset + 1], length = bytes.readUInt16BE(offset + 2);
    if (marker === 218 || marker === 217) break;
    if (length < 2 || offset + 2 + length > bytes.length) fail("share/card-not-jpeg");
    if ([192, 193, 194].includes(marker)) {
      if (length < 8) fail("share/card-not-jpeg");
      dimensions = { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    }
    offset += length + 2;
  }
  if (!dimensions || dimensions.width !== input.width || dimensions.height !== input.height) fail("share/card-dimensions");
  if (!Array.isArray(input.dates) || input.dates.length !== 2 || !input.dates.every((d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d)) fail("share/card-dates");
  return bytes;
}
async function deleteShareCard(bucket, share) {
  if (share.shareType !== "card") return;
  // The canonical path is independent of client-supplied or legacy metadata.
  await bucket.file(`beforeAfterShares/${share.id}/card.jpg`).delete({ ignoreNotFound: true });
}
module.exports = { validateCard, deleteShareCard, digest, MAX_BYTES };
