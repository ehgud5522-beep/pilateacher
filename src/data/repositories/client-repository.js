/**
 * 회원 읽기·쓰기.
 *
 * 생년월일과 주소는 받지 않는다. 종이 계약서에 있고, 서버에 둘수록 관리 부담만
 * 는다. 연락처는 숫자만 저장한다 — 같은 번호를 010-1234-5678 과 01012345678 로
 * 나눠 저장하면 동명이인 확인도 검색도 조용히 빗나간다.
 *
 * 같은 제약을 firestore.foundation.rules 의 clients 블록이 강제한다. 여기서
 * 먼저 막는 것은 규칙에 도달하기 전에 무엇이 잘못됐는지 알려주기 위해서다 —
 * 규칙 거부는 permission-denied 한 줄로만 돌아온다.
 */

import { CLIENT_STATUS } from "../schema/constants.js";
import { paths } from "../schema/paths.js";
import { readCollection } from "./repository-read.js";

/**
 * @typedef {object} ClientStore
 * @property {(collectionPath: string) => Promise<Array<any>>} list
 * @property {(documentPath: string, data: object) => Promise<void>} create
 * @property {() => Promise<any>} serverTimestamp
 */

/**
 * 새로 만드는 회원이 가질 수 있는 상태. CLIENT_STATUS 에는 deleted 와 inactive
 * 도 있지만 그 둘은 기존 데이터를 옮길 때 쓰는 값이고, 등록 화면이 만들어 낼
 * 수 있는 값이 아니다.
 */
export const CLIENT_STATUS_FOR_CREATE = Object.freeze([
  String(CLIENT_STATUS.ACTIVE), String(CLIENT_STATUS.HOLD), String(CLIENT_STATUS.ENDED),
]);

const requiredText = (value, label) => {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`Missing ${label}`);
  return text;
};

/* 하이픈·공백·괄호를 떼고 숫자만 남긴다. **원본은 functions/shared/phone.mjs**
   에 있다 -- 회원 앱의 연결 함수가 인증된 전화번호로 같은 회원을 찾아야 하고,
   Functions 는 functions/ 만 배포되기 때문이다. 두 벌이 되면 같은 사람이 서로
   다른 회원이 된다. 부르는 쪽은 바뀔 것이 없다. */
import { normalizePhone } from "../../../functions/shared/phone.mjs";

export { normalizePhone };

/**
 * Firestore 를 읽고 쓰는 기본 구현. firebase 모듈은 호출 시점에만 불러온다 —
 * product-repository.js 의 createFirestoreProductStore 와 같은 방식이다.
 */
export function createFirestoreClientStore() {
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

const clientsCollection = (organizationId) => {
  // paths.client 로 문서 경로를 만든 뒤 마지막 한 칸을 떼어 컬렉션 경로를 얻는다.
  // 컬렉션 이름 리터럴을 여기에 다시 적지 않기 위해서다.
  const documentPath = paths.client(organizationId, "placeholder");
  return documentPath.slice(0, documentPath.lastIndexOf("/"));
};

/**
 * 이 번호를 이미 쓰는 회원.
 *
 * ── 동명이인과 다르다: 이쪽은 막는다 ──
 * 이름이 같은 사람은 실제로 있다. 번호가 같은 사람은 없다 -- 같은 번호가 둘이면
 * 회원 앱이 둘을 찾아 **누구의 잔여인지 정하지 못하고**(link-result 의
 * ambiguous), 연락처 변경도 그 번호를 영영 거부한다.
 *
 * 서버의 중복 검사와 같은 판정이다 (functions/src/client-phone-store.js).
 * 저쪽은 쿼리이고 이쪽은 이미 읽어 둔 목록이라 방법이 다르지만, 답은 같아야
 * 한다 -- 철자를 양쪽 다 normalizePhone 으로 맞추는 이유다.
 *
 * @param {Array<any>} clients @param {string} phone
 */
export function findSamePhoneClients(clients, phone) {
  const digits = normalizePhone(phone);
  if (!digits) return [];
  return (Array.isArray(clients) ? clients : [])
    .filter(Boolean)
    .filter((client) => normalizePhone(client.phone) === digits);
}

const byStatusThenName = (left, right) => {
  const rank = (client) => (client.status === CLIENT_STATUS.ACTIVE ? 0 : 1);
  if (rank(left) !== rank(right)) return rank(left) - rank(right);
  return String(left.name || "").localeCompare(String(right.name || ""), "ko");
};

/**
 * 이름 또는 연락처 부분 일치. 검색어의 하이픈도 떼고 비교하므로 010-1234 로
 * 쳐도 01012345678 을 찾는다.
 *
 * 화면도 이 함수를 쓴다. 목록을 한 번 받아 두고 타이핑마다 다시 읽지는 않는데,
 * 거르는 규칙을 화면이 따로 구현하면 "검색으로는 안 나오는데 목록에는 있는"
 * 회원이 생긴다.
 *
 * @param {any} client @param {string} search
 */
export const clientMatchesSearch = (client, search) => {
  const text = String(search ?? "").trim();
  if (!text) return true;
  if (String(client.name || "").includes(text)) return true;
  const digits = normalizePhone(text);
  return digits.length > 0 && normalizePhone(client.phone).includes(digits);
};

/**
 * 지점과 검색어로 거른 목록을 운영중 먼저, 이름순으로 돌려준다.
 *
 * 거르는 일은 클라이언트에서 한다. 반송점 120명 규모에서는 전체를 받아 거르는
 * 편이 단순하고, 지점·검색어 조합마다 복합 인덱스를 만들지 않아도 된다. 규모가
 * 커지면 여기부터 서버 쿼리로 옮긴다.
 *
 * @param {string} organizationId
 * @param {{ locationId?: string, search?: string, includeEnded?: boolean, store?: ClientStore }} [options]
 */
export async function listClients(organizationId, options = {}) {
  const { locationId = "", search = "", includeEnded = true, store = createFirestoreClientStore() } = options;
  const organization = requiredText(organizationId, "organizationId");
  // 조회 실패는 빈 목록이 아니라 RepositoryReadError 로 나간다 -- repository-read.js 참고.
  const found = await readCollection({
    feature: "client_directory",
    path: clientsCollection(organization),
    read: (path) => store.list(path),
  });
  return found
    .filter((client) => (locationId ? client.locationId === locationId : true))
    .filter((client) => (includeEnded ? true : client.status !== CLIENT_STATUS.ENDED))
    .filter((client) => clientMatchesSearch(client, search))
    .sort(byStatusThenName);
}

/**
 * 같은 이름이 이미 있는지 본다. 막지는 않는다 — 동명이인은 실제로 있고, 등록을
 * 거부하면 사람이 이름 뒤에 1, 2 를 붙이기 시작해서 데이터가 더 나빠진다.
 * 화면이 "이미 있습니다"라고 알려 주고 계속할지 묻는 데 쓴다.
 *
 * @param {Array<any>} clients
 * @param {string} name
 */
export function findSameNameClients(clients, name) {
  const text = String(name ?? "").trim();
  if (!text) return [];
  return (Array.isArray(clients) ? clients : [])
    .filter(Boolean)
    .filter((client) => String(client.name || "").trim() === text);
}

/**
 * 규칙이 createdAt == request.time 을 요구하므로 서버 시각을 넣는다. 클라이언트가
 * 만든 시각은 그것이 정확하더라도 거부된다.
 *
 * @param {string} organizationId
 * @param {{
 *   name: string, phone: string, locationId: string, createdBy: string,
 *   status?: string, clientId?: string, existingClients?: Array<any>,
 * }} input
 * @param {{ store?: ClientStore, newId?: () => string }} [options]
 */
export async function createClient(organizationId, input, options = {}) {
  const {
    store = createFirestoreClientStore(),
    newId = () => globalThis.crypto?.randomUUID?.() || `client-${Date.now()}`,
  } = options;
  const organization = requiredText(organizationId, "organizationId");
  const status = String(input?.status ?? CLIENT_STATUS.ACTIVE).trim() || CLIENT_STATUS.ACTIVE;
  if (!CLIENT_STATUS_FOR_CREATE.includes(status)) throw new Error("Invalid status");

  // 연락처는 숫자만 남긴 뒤에 검사한다. 하이픈만 친 값이 통과해서 빈 번호가
  // 저장되면, 동명이인 화면이 구분할 것을 잃는다.
  const phone = normalizePhone(input?.phone);
  if (!phone) throw new Error("Missing phone");
  /* 부르는 쪽이 이미 읽어 둔 명부를 넘겨 주면 여기서도 한 번 본다. 화면이
     먼저 막지만, 화면만 막으면 다른 호출부가 생기는 날 조용히 뚫린다.
     넘겨주지 않으면 검사하지 않는다 -- 여기서 명부 전체를 읽으면 등록 한
     번에 회원 수만큼 읽기가 붙는다. */
  const taken = findSamePhoneClients(input?.existingClients, phone);
  if (taken.length > 0) {
    throw Object.assign(new Error("duplicate_phone"), {
      code: "duplicate_phone", clientName: String(taken[0]?.name || ""),
    });
  }

  const document = {
    organizationId: organization,
    name: requiredText(input?.name, "name"),
    phone,
    locationId: requiredText(input?.locationId, "locationId"),
    status,
    createdAt: await store.serverTimestamp(),
    createdBy: requiredText(input?.createdBy, "createdBy"),
  };

  const clientId = String(input?.clientId || newId());
  await store.create(paths.client(organization, clientId), document);
  return { clientId, ...document };
}
