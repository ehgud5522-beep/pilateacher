/**
 * 회원권 상품 읽기·쓰기.
 *
 * 상품은 고치지 않고 종료한 뒤 새로 추가한다. 이미 발급된 회원권이 상품이 팔린
 * 조건을 가리키고 있어, 기준 세션 수나 금액이 사후에 바뀌면 지난 발급의 근거가
 * 흔들린다. 그래서 여기에 update 는 status 하나뿐이고 delete 는 없다.
 *
 * 같은 제약을 firestore.foundation.rules 의 products 블록이 강제한다. 여기서
 * 먼저 막는 것은 규칙에 도달하기 전에 무엇이 잘못됐는지 알려주기 위해서다 —
 * 규칙 거부는 permission-denied 한 줄로만 돌아온다.
 */

import { PAY_CATEGORY, PRODUCT_STATUS, SESSION_TYPE } from "../schema/constants.js";
import { payCategoriesFor } from "../schema/display-names.js";
import { paths } from "../schema/paths.js";
import { readCollection } from "./repository-read.js";

/**
 * @typedef {object} ProductStore
 * @property {(collectionPath: string) => Promise<Array<any>>} list
 * @property {(documentPath: string, data: object) => Promise<void>} create
 * @property {(documentPath: string, data: object) => Promise<void>} update
 * @property {() => Promise<any>} serverTimestamp
 */

const values = (constant) => new Set(Object.values(constant));

const requiredText = (value, label) => {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`Missing ${label}`);
  return text;
};

const requiredInt = (value, label, { min }) => {
  const number = typeof value === "number" ? value : Number(String(value ?? "").trim());
  if (!Number.isInteger(number)) throw new Error(`Invalid ${label}`);
  if (number < min) throw new Error(`Invalid ${label}`);
  return number;
};

/**
 * Firestore 를 읽고 쓰는 기본 구현. firebase 모듈은 호출 시점에만 불러온다 —
 * app-runtime.js 의 getWriter 와 같은 방식이다.
 */
export function createFirestoreProductStore() {
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
    update: async (documentPath, data) => {
      const { doc, getFirestore, updateDoc } = await load();
      await updateDoc(doc(getFirestore(), documentPath), data);
    },
    serverTimestamp: async () => {
      const { serverTimestamp } = await load();
      return serverTimestamp();
    },
  };
}

const productsCollection = (organizationId) => {
  // paths.product 로 문서 경로를 만든 뒤 마지막 한 칸을 떼어 컬렉션 경로를 얻는다.
  // 컬렉션 이름 리터럴을 여기에 다시 적지 않기 위해서다.
  const documentPath = paths.product(organizationId, "placeholder");
  return documentPath.slice(0, documentPath.lastIndexOf("/"));
};

const byStatusThenName = (left, right) => {
  if (left.status !== right.status) return left.status === PRODUCT_STATUS.ACTIVE ? -1 : 1;
  return String(left.name || "").localeCompare(String(right.name || ""), "ko");
};

/**
 * 운영중이 앞, 종료가 뒤로 정렬해서 돌려준다.
 * @param {string} organizationId
 * @param {{ includeArchived?: boolean, store?: ProductStore }} [options]
 */
export async function listProducts(organizationId, options = {}) {
  const { includeArchived = false, store = createFirestoreProductStore() } = options;
  requiredText(organizationId, "organizationId");
  // 조회 실패는 빈 목록이 아니라 RepositoryReadError 로 나간다 -- repository-read.js 참고.
  const products = await readCollection({
    feature: "product_catalog",
    path: productsCollection(organizationId),
    read: (path) => store.list(path),
  });
  const visible = includeArchived
    ? products
    : products.filter((product) => product.status === PRODUCT_STATUS.ACTIVE);
  return visible.sort(byStatusThenName);
}

/**
 * 규칙이 createdAt == request.time 을 요구하므로 서버 시각을 넣는다. 클라이언트가
 * 만든 시각은 그것이 정확하더라도 거부된다.
 *
 * @param {string} organizationId
 * @param {{ name: string, sessionType: string, payCategory: string, defaultSessions: number, defaultPrice: number, createdBy: string, productId?: string }} input
 * @param {{ store?: ProductStore, newId?: () => string }} [options]
 */
export async function createProduct(organizationId, input, options = {}) {
  const {
    store = createFirestoreProductStore(),
    newId = () => globalThis.crypto?.randomUUID?.() || `product-${Date.now()}`,
  } = options;
  const organization = requiredText(organizationId, "organizationId");
  const sessionType = requiredText(input?.sessionType, "sessionType");
  if (!values(SESSION_TYPE).has(sessionType)) throw new Error("Invalid sessionType");
  const payCategory = requiredText(input?.payCategory, "payCategory");
  if (!values(PAY_CATEGORY).has(payCategory)) throw new Error("Invalid payCategory");
  // 2:1 수업을 1:1 단가로 계산하면 회당 차이가 그대로 급여에 남고, 그 상품으로
  // 발급된 모든 회원권에 번진다. 규칙과 같은 조합표를 쓴다.
  if (!payCategoriesFor(sessionType).includes(payCategory)) {
    throw new Error("Invalid payCategory for sessionType");
  }

  const document = {
    organizationId: organization,
    name: requiredText(input?.name, "name"),
    sessionType,
    payCategory,
    defaultSessions: requiredInt(input?.defaultSessions, "defaultSessions", { min: 1 }),
    defaultPrice: requiredInt(input?.defaultPrice, "defaultPrice", { min: 0 }),
    status: PRODUCT_STATUS.ACTIVE,
    createdAt: await store.serverTimestamp(),
    createdBy: requiredText(input?.createdBy, "createdBy"),
  };

  const productId = String(input?.productId || newId());
  await store.create(paths.product(organization, productId), document);
  return { productId, ...document };
}

/**
 * 바꿀 수 있는 것은 status 뿐이다. 나머지 필드를 넘기려는 호출은 여기서 막는다.
 * @param {string} organizationId
 * @param {string} productId
 * @param {string} status
 * @param {{ store?: ProductStore }} [options]
 */
export async function setProductStatus(organizationId, productId, status, options = {}) {
  const { store = createFirestoreProductStore() } = options;
  const organization = requiredText(organizationId, "organizationId");
  const id = requiredText(productId, "productId");
  const next = requiredText(status, "status");
  if (!values(PRODUCT_STATUS).has(next)) throw new Error("Invalid status");
  await store.update(paths.product(organization, id), { status: next });
  return { productId: id, status: next };
}
