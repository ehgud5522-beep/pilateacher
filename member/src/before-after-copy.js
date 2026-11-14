/* 보니따 앱 비포애프터 문구 (2026-11-14 대표).
   대표 요청 문구는 "어느 서버에도 저장되지 않는다" 였지만 사실이 아니다 -- 공유 카드는 Firebase
   Storage(beforeAfterShares/{id}/card.jpg)에 비공개로 보관되고, 그래야 회원이 앱에서 열 수 있다.
   회원에게 사실과 다른 개인정보 안내를 하지 않는다. 대신 실제로 지켜지는 것만 쓴다:
   담당 선생님과 회원 본인만 볼 수 있고(서버가 열 때마다 권한 확인), 공개 링크가 없다. */
export const BEFORE_AFTER_PRIVACY = '이 사진은 비공개로 보관되며, 담당 선생님과 회원님 본인만 볼 수 있어요. 다른 회원이나 외부에는 공개되지 않아요.';

/** 'YYYY-MM-DD' 두 개 사이 날 수. 읽지 못하면 null. */
export function daysBetweenDates(a, b) {
  const start = Date.parse(`${String(a || '').slice(0, 10)}T00:00:00Z`);
  const end = Date.parse(`${String(b || '').slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.round(Math.abs(end - start) / 86400000);
}

export const dotDate = (value) => String(value || '').slice(0, 10).replaceAll('-', '.');

/** 홈 카드 요약. 공유 목록에서 수와 새 기록 수만. */
export function beforeAfterSummary(shares = []) {
  const list = Array.isArray(shares) ? shares : [];
  return { count: list.length, unread: list.filter((s) => s?.unread).length, latest: list[0] || null };
}
