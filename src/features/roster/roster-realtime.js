/**
 * 센터 회원 명단 실시간 (2026-11-04, 2단계). **판정만 순수 함수로 둔다.**
 *
 * ── 누가 무엇을 듣는가 (대표 결정 2026-11-04) ──
 *   강사                       본인 담당 회원만 (instructorIds 에 내 uid) --
 *                              clientScopeFor 와 같은 범위. 넓히지 않는다
 *   FC매니저 · 매니저(직원)    고른 지점. "전체" 칩이면 맡은 지점 전부(in 질의, 최대 30)
 *   대표 · 총괄매니저          고른 지점. **"전체" 칩이면 듣지 않는다** -- 9개 지점
 *                              1천 명을 열 때마다 받게 되고, 그 자리는 1단계(가벼운
 *                              갱신 · 시트 열기 · 복귀)가 맡는다
 *
 * ── 무엇이 바뀌는가 ──
 * 회원 문서만 듣는다. 회원권은 듣지 않는다 -- 새로 나타난 회원 중 회원권을 모르는
 * 사람만 그 회원의 회원권을 한 번 골라 읽는다 (missingPassClientIds).
 *
 * ── 읽기 횟수 ──
 * 첫 스냅샷은 문서 수만큼, 그 뒤로는 바뀐 문서 수만큼 읽힌다. 캐시에서 온
 * 스냅샷은 읽기가 아니다. 진단에 그 합계를 남긴다 (readsOfSnapshot).
 *
 * 스위치는 일정 동기화와 같은 모양이다 (sync-switch.js): off · listed · all.
 * scheduleSync 문서의 rosterRealtime 칸에 산다 -- runtime-config-admin.js 참고.
 * **못 읽으면 꺼진 것이다.**
 */

import { ALL_LOCATIONS, NO_LOCATION, scopedLocationIds } from "../../data/repositories/location-repository.js";
import { passBelongsTo } from "../../data/schema/pass-clients.js";
import { SCOPED_ROLES } from "../members/client-scope.js";
import { scheduleSyncEnabledFor } from "../schedule/sync-switch.js";

export const REALTIME_SCOPE = Object.freeze({ NONE: "none", INSTRUCTOR: "instructor", LOCATIONS: "locations" });

/** Firestore 의 in 질의 한도. 이보다 많은 지점은 듣지 않는다. */
export const MAX_LISTENED_LOCATIONS = 30;

/** 진단을 남기는 읽기 간격. 첫 스냅샷과 이 수를 넘길 때마다 한 줄. */
export const REALTIME_LOG_EVERY = 50;

const text = (value) => String(value ?? "").trim();

/** 이 계정에 실시간을 켤 것인가. 설정은 scheduleSync 문서 전체를 받는다. */
export function rosterRealtimeEnabledFor(scheduleSyncDocument, userId) {
  return scheduleSyncEnabledFor(scheduleSyncDocument?.rosterRealtime ?? null, userId);
}

/**
 * 무엇을 들을 것인가.
 *
 * @param {{
 *   role?: string, userId?: string, locationFilter?: string,
 *   viewer?: { locationId?: string, locationIds?: Array<string> },
 *   locations?: Array<{ id: string }>,
 * }} input
 *   locationFilter 회원 목록에서 고른 지점 칩 (ALL_LOCATIONS · 지점 id · NO_LOCATION)
 *   locations      이 사람이 고를 수 있는 지점 (이미 범위로 좁힌 것)
 */
export function rosterRealtimeScope(input = {}) {
  const role = text(input.role);
  if (SCOPED_ROLES.includes(role)) {
    const userId = text(input.userId);
    /* uid 를 모르면 듣지 않는다. 조건 없는 질의를 보내면 명부 전체가 열린다. */
    return userId
      ? { kind: REALTIME_SCOPE.INSTRUCTOR, instructorId: userId, key: `instructor:${userId}` }
      : { kind: REALTIME_SCOPE.NONE, reason: "no_user", key: "none:no_user" };
  }
  if (!["owner", "area_manager", "manager", "staff"].includes(role)) {
    return { kind: REALTIME_SCOPE.NONE, reason: "role", key: "none:role" };
  }
  const known = new Set((Array.isArray(input.locations) ? input.locations : []).map((item) => text(item?.id)).filter(Boolean));
  const filter = text(input.locationFilter) || ALL_LOCATIONS;
  if (filter === NO_LOCATION) return { kind: REALTIME_SCOPE.NONE, reason: "no_location_chip", key: "none:no_location_chip" };
  if (filter !== ALL_LOCATIONS) {
    return known.has(filter)
      ? { kind: REALTIME_SCOPE.LOCATIONS, locationIds: [filter], key: `locations:${filter}` }
      : { kind: REALTIME_SCOPE.NONE, reason: "unknown_location", key: "none:unknown_location" };
  }
  /* "전체" 칩. 지점으로 좁혀지는 사람은 맡은 지점 전부, 대표 · 총괄은 듣지 않는다. */
  if (role === "owner" || role === "area_manager") {
    return { kind: REALTIME_SCOPE.NONE, reason: "all_locations", key: "none:all_locations" };
  }
  const mine = scopedLocationIds(input.viewer).filter((id) => known.size === 0 || known.has(id)).sort();
  if (mine.length === 0) return { kind: REALTIME_SCOPE.NONE, reason: "no_scope", key: "none:no_scope" };
  if (mine.length > MAX_LISTENED_LOCATIONS) return { kind: REALTIME_SCOPE.NONE, reason: "too_many_locations", key: "none:too_many_locations" };
  return { kind: REALTIME_SCOPE.LOCATIONS, locationIds: mine, key: `locations:${mine.join(",")}` };
}

/**
 * 스냅샷의 바뀐 것을 들고 있던 명단에 합친다.
 *
 * 질의 밖으로 나간 회원(removed)은 범위마다 뜻이 다르다:
 *   강사   담당이 넘어갔다 → **명단에서 뺀다** (본인 담당만 보는 자리다)
 *   지점   다른 지점으로 옮겼거나 지워졌다 → 남긴다. 다음 전체 읽기 · 가벼운 갱신이
 *          맞춘다 -- 여기서 빼면 "전체" 칩에서 그 회원이 사라진다
 *
 * @param {Array<any>} current
 * @param {Array<{ type: "added" | "modified" | "removed", doc: any }>} changes
 * @param {{ removeOnLeave?: boolean }} [options]
 */
export function applyClientChanges(current, changes, options = {}) {
  const byId = new Map((Array.isArray(current) ? current : []).map((client) => [text(client?.id), client]));
  for (const change of Array.isArray(changes) ? changes : []) {
    const id = text(change?.doc?.id);
    if (!id) continue;
    if (change.type === "removed") {
      if (options.removeOnLeave) byId.delete(id);
      continue;
    }
    byId.set(id, change.doc);
  }
  return [...byId.values()];
}

/** 질의 밖으로 나가면 뺄 것인가. 강사 범위만이다. */
export const removesOnLeave = (scope) => scope?.kind === REALTIME_SCOPE.INSTRUCTOR;

/**
 * 회원권을 아직 모르는 회원. 이미 한 번 물어본 회원은 다시 묻지 않는다 -- 회원권이
 * 정말 없는 회원을 스냅샷마다 다시 읽게 된다.
 *
 * @param {Array<any>} clients @param {Array<any>} passes @param {Set<string>} asked
 */
export function missingPassClientIds(clients, passes, asked = new Set()) {
  const list = Array.isArray(passes) ? passes : [];
  return (Array.isArray(clients) ? clients : [])
    .map((client) => text(client?.id))
    .filter((id) => id && !asked.has(id) && !list.some((pass) => passBelongsTo(pass, id)));
}

/**
 * 이 스냅샷이 읽기 몇 건인가. 캐시에서 온 것은 0, 첫 스냅샷은 문서 수, 그 뒤로는
 * 바뀐 문서 수. 질의 밖으로 나간 문서(removed)는 읽기가 아니다.
 *
 * @param {{ fromCache?: boolean, first?: boolean, size?: number, changes?: Array<{ type: string }> }} snapshot
 */
export function readsOfSnapshot(snapshot = {}) {
  if (snapshot.fromCache) return 0;
  if (snapshot.first) return Math.max(0, Number(snapshot.size) || 0);
  return (Array.isArray(snapshot.changes) ? snapshot.changes : []).filter((change) => change?.type !== "removed").length;
}

/** 진단을 남길 때인가: 첫 스냅샷, 그리고 REALTIME_LOG_EVERY 를 넘을 때마다. */
export function shouldLogReads(previousTotal, nextTotal, first = false) {
  if (first) return true;
  return Math.floor(nextTotal / REALTIME_LOG_EVERY) > Math.floor(previousTotal / REALTIME_LOG_EVERY);
}
