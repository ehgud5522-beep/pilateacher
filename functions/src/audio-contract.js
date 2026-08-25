"use strict";

const { GatewayError } = require("./errors");

const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
const MAX_AUDIO_SECONDS = 90;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const AAC_SAMPLE_RATES = Object.freeze([
  96000, 88200, 64000, 48000, 44100, 32000, 24000,
  22050, 16000, 12000, 11025, 8000, 7350,
]);

function invalidAudio(message) {
  return new GatewayError("invalid_request", { internalMessage: message });
}

function readM4aDuration(buffer) {
  if (buffer.length < 24 || buffer.toString("ascii", 4, 8) !== "ftyp") return null;
  const marker = buffer.indexOf(Buffer.from("mvhd", "ascii"));
  if (marker < 4 || marker + 32 > buffer.length) return null;
  const version = buffer[marker + 4];
  if (version === 0) {
    const timescale = buffer.readUInt32BE(marker + 16);
    const duration = buffer.readUInt32BE(marker + 20);
    return timescale > 0 ? duration / timescale : null;
  }
  if (version === 1 && marker + 40 <= buffer.length) {
    const timescale = buffer.readUInt32BE(marker + 24);
    const duration = Number(buffer.readBigUInt64BE(marker + 28));
    return timescale > 0 ? duration / timescale : null;
  }
  return null;
}

function readAacDuration(buffer) {
  let offset = 0;
  let frames = 0;
  let sampleRate = 0;
  while (offset + 7 <= buffer.length) {
    if (buffer[offset] !== 0xff || (buffer[offset + 1] & 0xf6) !== 0xf0) return null;
    const sampleRateIndex = (buffer[offset + 2] & 0x3c) >> 2;
    const frameSampleRate = AAC_SAMPLE_RATES[sampleRateIndex] || 0;
    const frameLength = ((buffer[offset + 3] & 0x03) << 11)
      | (buffer[offset + 4] << 3)
      | ((buffer[offset + 5] & 0xe0) >> 5);
    if (!frameSampleRate || frameLength < 7 || offset + frameLength > buffer.length) return null;
    if (!sampleRate) sampleRate = frameSampleRate;
    if (sampleRate !== frameSampleRate) return null;
    frames += 1;
    offset += frameLength;
  }
  if (!frames || offset !== buffer.length) return null;
  return (frames * 1024) / sampleRate;
}

function inspectAudioBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 16 || buffer.length > MAX_AUDIO_BYTES) {
    throw invalidAudio("audio size is invalid");
  }
  const m4aDuration = readM4aDuration(buffer);
  const aacDuration = m4aDuration == null ? readAacDuration(buffer) : null;
  const durationSeconds = m4aDuration ?? aacDuration;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > MAX_AUDIO_SECONDS) {
    throw invalidAudio("audio duration is invalid");
  }
  const format = m4aDuration == null ? "aac" : "m4a";
  return Object.freeze({
    bytes: buffer.length,
    durationSeconds,
    format,
    filename: `lesson-recording.${format}`,
    mimeType: format === "m4a" ? "audio/mp4" : "audio/aac",
  });
}

function decodeAudioBase64(value) {
  if (typeof value !== "string" || !value || value.length > Math.ceil(MAX_AUDIO_BYTES / 3) * 4 + 4 || !BASE64_PATTERN.test(value)) {
    throw invalidAudio("audio base64 is invalid");
  }
  const buffer = Buffer.from(value, "base64");
  const metadata = inspectAudioBuffer(buffer);
  return { buffer, metadata };
}

module.exports = {
  MAX_AUDIO_BYTES,
  MAX_AUDIO_SECONDS,
  decodeAudioBase64,
  inspectAudioBuffer,
  readAacDuration,
  readM4aDuration,
};
