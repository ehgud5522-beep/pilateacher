/**
 * 센터 회원 명단 실시간 듣기 (2026-11-04, 2단계). 무엇을 들을지는
 * features/roster/roster-realtime.js 가 정하고, 여기는 Firestore 와 잇기만 한다.
 *
 * scope.kind 는 roster-realtime.js 의 REALTIME_SCOPE 값이다 (none · instructor · locations).
 * 여기서 그 모듈을 불러오지 않는다 -- 데이터 계층이 화면 판정에 기대지 않게.
 *
 * 질의는 단일 조건뿐이다 -- 강사는 instructorIds array-contains, 지점은
 * locationId == 또는 in. 자동 색인으로 풀린다 (새 색인 · 규칙 변경 없음).
 */

import { paths } from "../schema/paths.js";

const collectionOf = (organizationId, documentPath) => documentPath.slice(0, documentPath.lastIndexOf("/"));
const clientsPath = (organizationId) => collectionOf(organizationId, paths.client(organizationId, "placeholder"));
const passesPath = (organizationId) => collectionOf(organizationId, paths.pass(organizationId, "placeholder"));

/**
 * 듣기 시작. 끊는 함수를 돌려준다.
 *
 * onChange 는 { first, fromCache, size, changes: [{ type, doc }] } 를 받는다 --
 * readsOfSnapshot 이 그 모양으로 읽기를 센다.
 *
 * @param {string} organizationId
 * @param {{ kind: string, instructorId?: string, locationIds?: Array<string> }} scope
 * @param {{ onChange: (snapshot: any) => void, onError: (error: any) => void }} handlers
 * @param {{ firestore?: any, sdk?: any }} [options]  테스트가 sdk 를 넘긴다
 */
export async function subscribeClients(organizationId, scope, handlers, options = {}) {
  if (!organizationId || !scope || scope.kind === "none") return () => {};
  const sdk = options.sdk || await import("firebase/firestore");
  const { collection, getFirestore, onSnapshot, query, where } = sdk;
  const base = collection(options.firestore || getFirestore(), clientsPath(organizationId));
  const scoped = scope.kind === "instructor"
    ? query(base, where("instructorIds", "array-contains", scope.instructorId))
    : scope.locationIds.length === 1
      ? query(base, where("locationId", "==", scope.locationIds[0]))
      : query(base, where("locationId", "in", scope.locationIds));
  let first = true;
  return onSnapshot(scoped, (snapshot) => {
    const changes = snapshot.docChanges().map((change) => ({
      type: change.type, doc: { id: change.doc.id, ...change.doc.data() },
    }));
    handlers.onChange({ first, fromCache: Boolean(snapshot.metadata?.fromCache), size: snapshot.size, changes });
    first = false;
  }, (error) => handlers.onError(error));
}

/**
 * 이 회원들의 회원권만. 실시간으로 새로 나타난 회원의 잔여를 보이려고 쓴다.
 *
 * 듀엣은 짝의 칸(clientIds)에도 있어 두 번 묻는다. in · array-contains-any 는
 * 30개까지라 나눠 묻는다.
 *
 * @param {string} organizationId @param {Array<string>} clientIds
 * @param {{ firestore?: any, sdk?: any }} [options]
 */
export async function readPassesForClients(organizationId, clientIds, options = {}) {
  const ids = [...new Set((Array.isArray(clientIds) ? clientIds : []).map((id) => String(id || "").trim()).filter(Boolean))];
  if (!organizationId || ids.length === 0) return [];
  const sdk = options.sdk || await import("firebase/firestore");
  const { collection, getDocs, getFirestore, query, where } = sdk;
  const base = collection(options.firestore || getFirestore(), passesPath(organizationId));
  const byId = new Map();
  for (let index = 0; index < ids.length; index += 30) {
    const chunk = ids.slice(index, index + 30);
    const [solo, shared] = await Promise.all([
      getDocs(query(base, where("clientId", "in", chunk))),
      getDocs(query(base, where("clientIds", "array-contains-any", chunk))),
    ]);
    for (const document of [...solo.docs, ...shared.docs]) byId.set(document.id, { id: document.id, ...document.data() });
  }
  return [...byId.values()];
}
