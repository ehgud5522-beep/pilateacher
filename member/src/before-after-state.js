/* 보니따 비포애프터 탭의 기억 (2026-11-15 대표: "이미 동의했는데 확인하려 하면 동의 화면이 순간적으로 떴다가 넘어감").
   전에는 서버 답을 받기 전까지 동의 상태를 "없음" 으로 두어, 동의한 회원도 매번 동의 화면을 먼저 봤다.
   이제 마지막으로 받은 동의 상태를 이 기기에 기억해 두고 그것부터 그린다. 상태 한 단어만 둔다 -- 사진 · 목록 · 이름은 기기에 쓰지 않는다. */
export const CONSENT_CACHE_KEY = 'pilateacher.member.beforeAfterConsent.v1';
/* 잠깐 끊긴 실패(네트워크 · 서버 일시 장애)를 다시 확인하는 간격. 이 세 번이 지나도 안 되면 그때 말한다. */
export const RETRY_DELAYS = Object.freeze([2000, 5000, 10000]);
const KNOWN = new Set(['granted', 'revoked', 'missing']);

export const scopeKey = (scope) => `${scope?.organizationId || ''}:${scope?.clientId || ''}`;

function readMap(storage) {
  try {
    const value = JSON.parse(storage?.getItem?.(CONSENT_CACHE_KEY) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

/** 기억한 동의 상태. 없거나 못 읽으면 빈 문자열 -- 그때 화면은 "확인하고 있어요" 다. */
export function readConsent(storage, key) {
  const status = readMap(storage)[key];
  return KNOWN.has(status) ? status : '';
}

/** 서버가 준 동의 상태를 기억한다. 저장소가 막혀 있어도 화면은 그대로 돈다. */
export function rememberConsent(storage, key, status) {
  if (!KNOWN.has(status)) return;
  try { storage?.setItem?.(CONSENT_CACHE_KEY, JSON.stringify({ ...readMap(storage), [key]: status })); } catch { /* 기억 못 해도 된다 */ }
}
