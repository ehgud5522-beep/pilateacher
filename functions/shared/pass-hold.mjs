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

/**
 * 그 수업이 홀딩 기간 안에 있었는가. 차감을 막는 기준은 **수업 시각**이다.
 *
 * 지금 홀딩 중이어도 홀딩을 걸기 전에 한 수업은 차감한다 (2026-11-14 대표).
 * 지금 시각으로 막으면 그 수업은 홀딩 동안 확정할 수 없고, 홀딩이 풀리면
 * 7일 차감 기한이 지나 화면에서는 영영 확정할 수 없다.
 * 규칙(firestore.foundation.rules 의 ledger deduct)도 occurredAt 으로 같은 선을 긋는다.
 * 수업 시각을 읽지 못하면 지금으로 본다.
 */
export function holdBlocksLesson(pass, lessonAt, now = new Date()) {
  return isPassHeld(pass, Number.isFinite(holdTime(lessonAt)) ? lessonAt : now);
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
