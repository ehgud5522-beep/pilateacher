"use strict";

const { GatewayError } = require("./errors");

const DEFAULT_ALLOWED_ORIGINS = Object.freeze([
  "http://localhost:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5174",
  "capacitor://localhost",
  "http://localhost",
  "https://localhost",
  "https://pilateacher.web.app",
  "https://pilateacher.firebaseapp.com",
]);

function parseAllowedOrigins(rawOrigins = "") {
  const configured = String(rawOrigins || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return new Set([...DEFAULT_ALLOWED_ORIGINS, ...configured]);
}

function applyCors(req, res, allowedOrigins) {
  const origin = String(req.headers?.origin || "").trim();
  if (origin) {
    if (!allowedOrigins.has(origin)) throw new GatewayError("invalid_request", { status: 403 });
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Vary", "Origin");
  }

  if (String(req.method || "").toUpperCase() === "OPTIONS") {
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Idempotency-Key");
    res.set("Access-Control-Max-Age", "3600");
    res.status(204).send("");
    return true;
  }
  return false;
}

module.exports = {
  DEFAULT_ALLOWED_ORIGINS,
  applyCors,
  parseAllowedOrigins,
};
