const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

export function maskedPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length < 8) return digits ? "연락처 등록됨" : "미등록";
  return `${digits.slice(0, 3)}-****-${digits.slice(-4)}`;
}

export function maskedBirth(value, age) {
  const year = String(value || "").match(/^\d{4}/)?.[0];
  if (year) return `${year}.**.**${age ? ` · ${age}세` : ""}`;
  return age ? `${age}세` : "미등록";
}

export function membershipDisplay(member) {
  const regular = Math.max(0, number(member?.regular));
  const service = Math.max(0, number(member?.service));
  const registeredTotal = Math.max(0, number(member?.total));
  const remaining = regular + service;
  return {
    regular,
    service,
    remaining,
    registeredTotal,
    needsLegacyReview: registeredTotal > 0 && remaining > registeredTotal,
  };
}
