/**
 * 이 기기의 id (2026-10-31, 백업 안전망).
 *
 * 처음 실행 때 만들어 기기 저장소에 둔다. 로그인 계정과 상관없다 -- 같은 계정의
 * PC 와 폰을 가르는 값이다. 기기 저장소를 지우면 새 id 가 생기고, 그 기기는
 * 백업 목록에 새 기기로 보인다 (옛 자리는 그대로 남는다).
 *
 * 저장소를 못 쓰면 빈 문자열 -- 그때는 기기별 자리 없이 latest 만 쓴다.
 * 지어낸 id 를 매번 새로 쓰면 실행할 때마다 백업 자리가 하나씩 늘어난다.
 */

export const DEVICE_ID_KEY = "pilateacher:deviceId";

const fresh = () => {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ? uuid.replace(/-/g, "") : "";
};

export function deviceIdentity(storage = globalThis.localStorage) {
  try {
    const stored = String(storage?.getItem(DEVICE_ID_KEY) || "").trim();
    if (/^[A-Za-z0-9_-]{8,64}$/.test(stored)) return stored;
    const created = fresh();
    if (!created) return "";
    storage.setItem(DEVICE_ID_KEY, created);
    return storage.getItem(DEVICE_ID_KEY) === created ? created : "";
  } catch {
    return "";
  }
}
