/** Half-open interval: use resumes exactly at holdUntil. No balance is consumed. */
export function holdTime(value) {
  if (!value) return NaN;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  if (typeof value === "object" && Number.isFinite(value.seconds)) return value.seconds * 1000;
  return new Date(value).getTime();
}

export function isPassHeld(pass, at = new Date()) {
  const time = holdTime(at);
  return holdTime(pass?.holdFrom) <= time && time < holdTime(pass?.holdUntil);
}

const fail = (code) => { throw Object.assign(new Error(code), { code }); };

export function planPassHold(pass, input, now = new Date()) {
  const at = holdTime(now);
  const expiry = holdTime(pass?.expiresAt);
  if (pass?.status !== "active" || !(pass.remainingCount > 0)) fail("hold_pass_unusable");
  if (!Number.isFinite(expiry)) fail("no_previous_expiry");
  if (input.action === "hold" && expiry < at) fail("hold_pass_unusable");
  const reason = String(input?.reason || "").trim();
  if (!reason || reason.length > 200) fail("hold_reason_required");
  if (input.action === "release") {
    if (!isPassHeld(pass, now)) fail("hold_not_active");
    // Undo only the unused part of the extension; already held time stays credited.
    return {
      holdFrom: new Date(holdTime(pass.holdFrom)), holdUntil: new Date(at),
      expiresAt: new Date(expiry - (holdTime(pass.holdUntil) - at)),
      reason: `홀딩 해제 · ${reason}`.slice(0, 200),
    };
  }
  if (input.action !== "hold") fail("hold_action_invalid");
  if (isPassHeld(pass, now)) fail("hold_already_active");
  const days = Number(input.days);
  if (!Number.isInteger(days) || days < 1 || days > 365) fail("hold_days_invalid");
  return {
    holdFrom: new Date(at), holdUntil: new Date(at + days * 86400000),
    expiresAt: new Date(expiry + days * 86400000), reason: `홀딩 ${days}일 · ${reason}`.slice(0, 200),
  };
}
