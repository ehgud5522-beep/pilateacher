/**
 * 지점 읽기.
 *
 * 회원 등록에서 소속 지점을 고르려면 먼저 지점 목록이 있어야 한다. 지금 필요한
 * 것은 읽기뿐이라 읽기만 둔다 — 지점을 만드는 화면은 아직 없고, 없는 쓰기를
 * 미리 열어 두면 규칙과 어긋나도 한동안 아무도 모른다.
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
