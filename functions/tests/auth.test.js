"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { extractBearerToken, verifyFirebaseRequest } = require("../src/auth");
const { createRequest } = require("./helpers");

test("extractBearerToken accepts only a Bearer token", () => {
  assert.equal(extractBearerToken(createRequest()), "valid-token");
  assert.throws(() => extractBearerToken(createRequest({ headers: {} })), (error) => error.code === "unauthenticated");
  assert.throws(() => extractBearerToken(createRequest({ headers: { authorization: "Basic value" } })), (error) => error.code === "unauthenticated");
});

test("verifyFirebaseRequest uses the verified token uid and ignores request identity fields", async () => {
  let receivedToken;
  const request = createRequest({ body: { uid: "attacker", organizationId: "other-org", role: "owner" } });
  const identity = await verifyFirebaseRequest(request, async (token) => {
    receivedToken = token;
    return { uid: "verified-user", organizationId: "trusted-token-org" };
  });
  assert.equal(receivedToken, "valid-token");
  assert.equal(identity.uid, "verified-user");
});

test("verifyFirebaseRequest maps verification failures to unauthenticated", async () => {
  await assert.rejects(
    verifyFirebaseRequest(createRequest(), async () => { throw new Error("expired token details"); }),
    (error) => error.code === "unauthenticated" && !error.publicMessage.includes("expired"),
  );
});
