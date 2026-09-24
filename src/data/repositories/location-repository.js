/**
 * 지점 읽기.
 *
 * 회원 등록에서 소속 지점을 고르려면 먼저 지점 목록이 있어야 한다.
 *
 * 쓰기는 "추가"만 둔다 (2026-09-23, 율하점 개설). 이름 변경·삭제는 없다 —
 * 회원·강사·회원권·원장이 모두 locationId 로 지점을 가리키고 있어, 지점을
 * 지우거나 다른 지점으로 바꿔 쓰면 지난 기록이 엉뚱한 지점에 붙는다. 규칙도
 * delete 를 막는다.
 *
 * 규칙(firestore.foundation.rules 의 locations 블록)은 조직의 활성 구성원에게만
 * 읽기를 허용한다. 여기서 organizationId 를 먼저 요구하는 것은 규칙에 닿기 전에
 * 무엇이 빠졌는지 알려주기 위해서다 — 규칙 거부는 permission-denied 한 줄로만
 * 돌아온다.
 */

import { paths } from "../schema/paths.js";
import { readCollection } from "./repository-read.js";

/**
 * @typedef {object} LocationStore
 * @property {(collectionPath: string) => Promise<Array<any>>} list
 * @property {(documentPath: string, data: object) => Promise<void>} [create]
 * @property {() => Promise<any>} [serverTimestamp]
 */

const requiredText = (value, label) => {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`Missing ${label}`);
  return text;
};

/**
 * Firestore 를 읽는 기본 구현. firebase 모듈은 호출 시점에만 불러온다 —
 * product-repository.js 의 createFirestoreProductStore 와 같은 방식이다.
 */
export function createFirestoreLocationStore() {
  const load = () => import("firebase/firestore");
  return {
    list: async (collectionPath) => {
      const { collection, getDocs, getFirestore } = await load();
      const snapshot = await getDocs(collection(getFirestore(), collectionPath));
      return snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
    },
    create: async (documentPath, data) => {
      const { doc, getFirestore, setDoc } = await load();
      await setDoc(doc(getFirestore(), documentPath), data);
    },
    serverTimestamp: async () => {
      const { serverTimestamp } = await load();
      return serverTimestamp();
    },
  };
}

const locationsCollection = (organizationId) => {
  // paths.location 으로 문서 경로를 만든 뒤 마지막 한 칸을 떼어 컬렉션 경로를
  // 얻는다. 컬렉션 이름 리터럴을 여기에 다시 적지 않기 위해서다.
  const documentPath = paths.location(organizationId, "placeholder");
  return documentPath.slice(0, documentPath.lastIndexOf("/"));
};

const byName = (left, right) =>
  String(left.name || "").localeCompare(String(right.name || ""), "ko");

/**
 * 이름순으로 정렬해서 돌려준다.
 *
 * 이름이 없는 지점도 버리지 않는다. 목록에서 빠지면 그 지점 회원을 등록할 길이
 * 사라지는데, 화면에서는 지점이 없는 것처럼만 보여 원인을 찾을 수 없다.
 *
 * @param {string} organizationId
 * @param {{ store?: LocationStore }} [options]
 */
export async function listLocations(organizationId, options = {}) {
  const { store = createFirestoreLocationStore() } = options;
  const organization = requiredText(organizationId, "organizationId");
  // 조회 실패는 빈 목록이 아니라 RepositoryReadError 로 나간다 -- repository-read.js 참고.
  const found = await readCollection({
    feature: "location_directory",
    path: locationsCollection(organization),
    read: (path) => store.list(path),
  });
  return found
    .map((location) => ({ ...location, id: String(location.id || location.locationId || "") }))
    .filter((location) => location.id)
    .sort(byName);
}

/** 이름 비교용. "율하점"과 "율하 점", "율하점 " 을 같은 지점으로 본다. */
export const locationNameKey = (value) => String(value ?? "").replace(/\s+/g, "").toLowerCase();

/**
 * 지점을 하나 만든다. 대표·매니저만 (규칙의 locations create).
 *
 * 같은 이름의 지점이 이미 있으면 만들지 않는다. 지점이 둘로 갈리면 회원과
 * 강사가 두 곳에 나뉘어 붙고, 화면에서는 이름이 같아 어느 쪽인지 알 수 없다.
 * 호출하는 쪽이 방금 읽은 목록을 existing 으로 넘긴다.
 *
 * @param {string} organizationId
 * @param {{ name: string, createdBy: string }} input
 * @param {{ store?: LocationStore, existing?: Array<any>, newId?: () => string }} [options]
 */
export async function createLocation(organizationId, input, options = {}) {
  const {
    store = createFirestoreLocationStore(),
    existing = [],
    newId = () => globalThis.crypto?.randomUUID?.() || `location-${Date.now()}`,
  } = options;
  const organization = requiredText(organizationId, "organizationId");
  const name = requiredText(input?.name, "name").replace(/\s+/g, " ");
  const key = locationNameKey(name);
  const duplicate = existing.find((location) => locationNameKey(location?.name) === key);
  if (duplicate) {
    throw Object.assign(new Error(`Location already exists: ${duplicate.id}`), {
      code: "already-exists",
      locationId: duplicate.id,
    });
  }
  const document = {
    organizationId: organization,
    name,
    createdAt: await store.serverTimestamp(),
    createdBy: requiredText(input?.createdBy, "createdBy"),
  };
  const locationId = String(newId());
  await store.create(paths.location(organization, locationId), document);
  return { id: locationId, ...document };
}

/**
 * 지점별 목록 필터. "all" 은 전체, NO_LOCATION 은 지점이 비어 있거나 목록에
 * 없는 지점을 가리키는 항목이다 — 지워진 지점을 가리키는 사람이 어느 칸에도
 * 안 보이면 그 사람을 찾을 길이 없다.
 */
export const ALL_LOCATIONS = "all";
export const NO_LOCATION = "__none__";

/**
 * @template {{ locationId?: string }} T
 * @param {Array<T>} items
 * @param {string} filter
 * @param {Array<{ id: string }>} locations
 * @returns {Array<T>}
 */
export function filterByLocation(items, filter, locations = []) {
  if (!filter || filter === ALL_LOCATIONS) return items;
  if (filter === NO_LOCATION) {
    const known = new Set(locations.map((location) => location.id));
    return items.filter((item) => !item?.locationId || !known.has(item.locationId));
  }
  return items.filter((item) => item?.locationId === filter);
}

/**
 * 필터 칩에 붙일 인원 수. 칩 순서는 locations 순서(이름순)를 따른다.
 *
 * @param {Array<{ locationId?: string }>} items
 * @param {Array<{ id: string }>} locations
 * @returns {Record<string, number>}
 */
export function countByLocation(items, locations = []) {
  const known = new Set(locations.map((location) => location.id));
  const counts = { [ALL_LOCATIONS]: items.length, [NO_LOCATION]: 0 };
  for (const location of locations) counts[location.id] = 0;
  for (const item of items) {
    if (item?.locationId && known.has(item.locationId)) counts[item.locationId] += 1;
    else counts[NO_LOCATION] += 1;
  }
  return counts;
}
