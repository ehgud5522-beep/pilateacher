"use strict";
const reasons = new Set(("card-too-large card-not-jpeg card-hash-mismatch card-comment-too-long card-dimensions card-dates card-conflict card-changed card-not-ready consent-required member-required member-not-linked teacher-access-revoked disabled update-required unsupported-type invalid-selection request-conflict not-found revoked confirmation-required invalid-action sign-in-required temporarily-unavailable photo-not-ready photo-changed image-format").split(" ").map((s) => "share/" + s));
function shareDiagnostic(error, input = {}) {
  const code = String(error?.code || "unknown");
  return { feature: "before_after_share",
    stage: ["prepare", "activate", "revoke", "read", "detail", "media", "consent", "consentStatus", "teacherList", "memberList", "capability"].includes(input.action) ? input.action : "unknown",
    errorDomain: error?.httpsCode ? "sharing" : "firebase_admin",
    errorCode: /^(?:share\/[a-z-]+|[a-z-]+|\d{1,3})$/.test(code) && code.length < 80 ? code : "unknown",
    reasonCode: reasons.has(error?.code) ? error.code : "share/temporarily-unavailable",
    shareIdPrefix: /^[a-f0-9]{64}$/.test(input.shareId || "") ? input.shareId.slice(0, 8) : "",
    bytes: typeof input.cardBase64 === "string" ? Math.floor(input.cardBase64.length * 3 / 4) : 0,
    appBuild: /^[\d.a-zA-Z ()_-]{1,40}$/.test(input.appBuild || "") ? input.appBuild : "unknown",
    platform: ["ios", "android", "web"].includes(input.platform) ? input.platform : "unknown" };
}
module.exports = { shareDiagnostic };
