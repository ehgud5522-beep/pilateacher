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
 * 이 사람에게 보여 줄 지점 목록.
 *
 * ── 강사에게는 자기 지점뿐이다 ──
 * 강사는 자기 지점의 회원만 가르친다. 아홉 개 칩을 주면 그중 여덟은 눌러도
 * 빈 목록이고, 그 빈 화면은 "회원이 없다" 로 읽힌다 -- 실제로는 볼 자격이
 * 없는 지점이다.
 *
 * **소속 문서의 locationId 가 비어 있으면 거르지 않는다.** 아직 지점을 안
 * 넣은 강사가 있고(이 필드가 생기기 전에 만들어진 소속), 그 사람에게 빈
 * 목록을 보여 주면 자기 회원까지 사라진다 -- 모를 때는 다 보여주는 쪽이
 * 틀려도 덜 틀린다.
 *
 * 대표·총괄매니저·FC매니저는 그대로 전부 본다. 센터 전체를 보는 자리다.
 *
 * 목록 자리에 무엇이 와도 받는다 -- 못 읽었을 때 빈 목록이 아니라 null 이
 * 오는 경로가 있고, 거기서 던지면 더보기 탭이 통째로 열리지 않는다.
 *
 * @param {unknown} locations
 * @param {{ role?: string, locationId?: string, locationIds?: Array<string> }} viewer
 * @returns {Array<{ id: string }>}
 */
export function locationsVisibleTo(locations, viewer = {}) {
  const all = Array.isArray(locations) ? locations.filter(Boolean) : [];
  const role = String(viewer?.role || "").trim();
  if (!SCOPED_ROLES.includes(role)) return all;
  const mine = scopedLocationIds(viewer);
  if (mine.length === 0) return all;
  const found = all.filter((location) => mine.includes(String(location?.id || "")));
  // 그 지점이 목록에서 사라졌으면(지워졌거나 못 읽었으면) 거르지 않는다.
  return found.length ? found : all;
}

/**
 * 이 사람이 **여러 지점**을 가질 수 있는 역할인가.
 *
 * FC매니저만이다 (2026-10-26 대표 결정). 한 사람이 두 지점 이상을 맡는 일이
 * 실제로 있고, 그때 한 칸짜리 필드는 둘 중 하나를 버리게 만든다.
 *
 * 강사·팀장·점장은 그대로 한 지점이다 -- 그 사람들의 동작은 바뀌지 않는다.
 * 대표·총괄매니저는 애초에 지점으로 좁히지 않는다.
 *
 * @param {unknown} role
 */
export const holdsManyLocations = (role) => String(role || "").trim() === "manager";

/**
 * 지점으로 범위가 좁혀지는 역할들. **대표·총괄매니저는 없다** -- 센터 전체를
 * 보는 자리이고, 그 둘을 좁히면 이관도 급여도 반쪽만 보인다.
 */
export const SCOPED_ROLES = Object.freeze(
  /** @type {ReadonlyArray<string>} */ (["manager", "instructor", "staff"]),
);

/**
 * 이 소속 문서가 가리키는 지점들. **읽을 때는 둘 다 본다.**
 *
 * `locationIds` 가 새 필드이고 `locationId` 가 옛 필드다. 옛 앱이 깔린 폰은
 * 아직 옛 필드만 쓰므로, 읽는 쪽이 둘을 모두 받아야 한다 -- 새 필드만 보면
 * 업데이트하지 않은 사람의 지점이 통째로 사라지고, 그것은 화면에서 "회원이
 * 없다" 로 도착한다.
 *
 * 둘 다 비어 있으면 빈 배열이다. 부르는 쪽이 그것을 "좁히지 않는다" 로 읽을지
 * "아무 데도 없다" 로 읽을지 정한다 -- locationsVisibleTo 는 앞쪽이다
 * (모를 때는 다 보여주는 쪽이 틀려도 덜 틀린다).
 *
 * @param {unknown} membership
 * @returns {Array<string>}
 */
export function scopedLocationIds(membership) {
  const source = /** @type {any} */ (membership) || {};
  const many = Array.isArray(source.locationIds) ? source.locationIds : [];
  const list = many.map((item) => String(item ?? "").trim()).filter(Boolean);
  if (list.length > 0) return [...new Set(list)];
  const one = String(source.locationId ?? "").trim();
  return one ? [one] : [];
}

/**
 * 이 사람이 그 지점을 볼 수 있는가. **대표·총괄매니저는 늘 참이다.**
 *
 * @param {{ role?: string, locationId?: string, locationIds?: Array<string> }} viewer
 * @param {unknown} locationId
 */
export function canSeeLocation(viewer, locationId) {
  const role = String(viewer?.role || "").trim();
  if (!SCOPED_ROLES.includes(role)) return true;
  const mine = scopedLocationIds(viewer);
  // 지점을 아직 안 넣은 사람은 거르지 않는다 -- locationsVisibleTo 와 같은 판단.
  if (mine.length === 0) return true;
  return mine.includes(String(locationId ?? "").trim());
}

/**
 * **명단**이 좁혀지는 역할. 칩(SCOPED_ROLES)보다 좁다 -- FC매니저뿐이다.
 *
 * 둘이 다른 이유가 있다. 강사·팀장·점장은 전부터 **칩만** 자기 지점으로
 * 좁혀져 있었고 명단은 센터 전체였다 -- 그 사람들은 "내 회원" 토글로 자기
 * 회원을 찾고, 대타로 남의 회원을 차감하는 길이 거기 걸려 있다
 * (roster-visibility.js). 명단까지 좁히면 그 길이 끊긴다.
 *
 * 2026-10-26 대표 결정도 같은 선이다: 범위를 좁히는 것은 FC매니저뿐이고,
 * 강사·팀장·점장의 동작은 바뀌지 않는다.
 */
export const LIST_SCOPED_ROLES = Object.freeze(
  /** @type {ReadonlyArray<string>} */ (["manager"]),
);

/**
 * 그 사람에게 보여 줄 **회원·강사 목록**. 지점이 없는 항목은 남긴다.
 *
 * 지점이 비어 있는 회원이 실제로 있다 (이관 전에 만들어진 것). 그것을 빼면
 * 그 회원은 어느 화면에서도 안 보이고, 아무도 그 사실을 모른다.
 *
 * @template {{ locationId?: string }} T
 * @param {Array<T>} items
 * @param {{ role?: string, locationId?: string, locationIds?: Array<string> }} viewer
 * @returns {Array<T>}
 */
export function itemsVisibleTo(items, viewer = {}) {
  const all = Array.isArray(items) ? items.filter(Boolean) : [];
  const role = String(viewer?.role || "").trim();
  if (!LIST_SCOPED_ROLES.includes(role)) return all;
  const mine = scopedLocationIds(viewer);
  if (mine.length === 0) return all;
  return all.filter((item) => {
    const at = String(item?.locationId ?? "").trim();
    return at === "" || mine.includes(at);
  });
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
