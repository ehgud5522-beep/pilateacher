"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { applyCors, parseAllowedOrigins } = require("../src/cors");
const { createRequest, createResponse } = require("./helpers");

test("CORS allows exact localhost and configured hosting origins", () => {
  const allowed = parseAllowedOrigins("https://pilateacher.web.app");
  for (const origin of ["http://localhost:5174", "https://pilateacher.web.app"]) {
    const req = createRequest({ headers: { origin } });
    const res = createResponse();
    assert.equal(applyCors(req, res, allowed), false);
    assert.equal(res.headers["Access-Control-Allow-Origin"], origin);
  }
});

test("CORS rejects unlisted origins and handles an allowed preflight", () => {
  const allowed = parseAllowedOrigins("");
  assert.throws(
    () => applyCors(createRequest({ headers: { origin: "https://evil.example" } }), createResponse(), allowed),
    (error) => error.code === "invalid_request" && error.status === 403,
  );

  const req = createRequest({ method: "OPTIONS", headers: { origin: "http://localhost:5173" } });
  const res = createResponse();
  assert.equal(applyCors(req, res, allowed), true);
  assert.equal(res.statusCode, 204);
  assert.equal(res.headers["Access-Control-Allow-Methods"], "POST, OPTIONS");
});
