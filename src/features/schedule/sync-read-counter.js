/**
 * 실시간 반영으로 받은 문서 수를 하루 단위로 센다 (2026-10-31, 동기화 2단계).
 *
 * 대표 조건: 첫 주에 읽기 횟수가 문제 되는지 볼 수 있어야 한다. Firestore 콘솔의
 * 사용량 탭은 센터 전체의 합계라 이 기능 몫을 가를 수 없다. 그래서 앱이 받은
 * 문서 수(처음 한 번은 범위 안 전부, 그 뒤로는 바뀐 것만)를 기기에 날마다 적고,
 * 더보기 → 진단에서 보여 준다.
 *
 * 계정별 자리에 둔다 -- 같은 PC 를 다른 강사가 쓰면 그 사람 몫과 섞이지 않게.
 * 14일만 남긴다.
 */

export const SYNC_READS_KEEP_DAYS = 14;
export const syncReadsKey = (accountId) => `pilateacher_sync_reads_v1_${String(accountId || "").trim()}`;

const pad = (number) => String(number).padStart(2, "0");
const dayOf = (at) => `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;

function readAll(storage, accountId) {
  try {
    const value = JSON.parse(storage?.getItem(syncReadsKey(accountId)) || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

/** 받은 문서 수를 오늘 칸에 더한다. 저장소를 못 쓰면 조용히 넘어간다. */
export function recordSyncReads(storage, accountId, count, now = new Date()) {
  const amount = Math.max(0, Math.floor(Number(count) || 0));
  if (!accountId || !amount) return;
  const all = readAll(storage, accountId);
  const today = dayOf(now);
  const day = all[today] || { reads: 0, snapshots: 0 };
  all[today] = { reads: day.reads + amount, snapshots: day.snapshots + 1 };
  const keep = Object.keys(all).sort().slice(-SYNC_READS_KEEP_DAYS);
  try { storage?.setItem(syncReadsKey(accountId), JSON.stringify(Object.fromEntries(keep.map((key) => [key, all[key]])))); } catch { /* 진단일 뿐이다 */ }
}

/** 최근 날짜부터. [{ day, reads, snapshots }] */
export function syncReadsByDay(storage, accountId) {
  return Object.entries(readAll(storage, accountId))
    .map(([day, value]) => ({ day, reads: Number(value?.reads) || 0, snapshots: Number(value?.snapshots) || 0 }))
    .sort((left, right) => right.day.localeCompare(left.day));
}
