"use strict";

const { getAuth } = require("firebase-admin/auth");
const { GatewayError } = require("./errors");

function readHeader(req, name) {
  if (typeof req.get === "function") return req.get(name) || "";
  const headers = req.headers || {};
  return headers[name.toLowerCase()] || headers[name] || "";
}

function extractBearerToken(req) {
  const authorization = String(readHeader(req, "authorization") || "").trim();
  const match = authorization.match(/^Bearer\s+([^\s]+)$/i);
  if (!match) throw new GatewayError("unauthenticated");
  return match[1];
}

async function verifyFirebaseRequest(req, verifyIdToken = (token) => getAuth().verifyIdToken(token, true)) {
  const token = extractBearerToken(req);
  try {
    const decoded = await verifyIdToken(token);
    const uid = String(decoded?.uid || decoded?.sub || "").trim();
    if (!uid) throw new Error("Firebase token did not contain a uid");
    return { uid, tokenClaims: decoded };
  } catch (error) {
    if (error instanceof GatewayError) throw error;
    throw new GatewayError("unauthenticated", { cause: error });
  }
}

module.exports = {
  extractBearerToken,
  readHeader,
  verifyFirebaseRequest,
};
