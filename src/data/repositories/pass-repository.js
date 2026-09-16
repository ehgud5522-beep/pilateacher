/**
 * 회원권 발급·조회, 그리고 담당 강사 교체.
 *
 * ── 두 문서는 반드시 함께 쓰인다 ──
 * 발급은 passes/{passId} 와 passes/{passId}/ledger/{entryId} 두 문서를 만든다.
 * 회원권만 생기고 원장 항목이 없으면 잔여 횟수의 근거가 없고, 원장만 생기면
 * 가리킬 회원권이 없다. 규칙이 원장을 append-only 로 막으므로 어느 쪽도 나중에
 * 고칠 수 없다 -- 그래서 한 배치로 묶는다. 실패하면 둘 다 안 쓰인다.
 *
 * ── 단가는 이 시점에 박힌다 ──
 * 원장 항목의 unitPrice 가 급여의 유일한 근거다. pay-rates.js 의 표는 발급하는
 * 순간 한 번만 읽고, 그 뒤로 표가 바뀌어도 이미 발급된 건의 급여는 흔들리지
 * 않는다. 급여를 합산하는 코드는 표가 아니라 원장을 읽어야 한다.
 *
 * ── 담당 강사가 바뀌어도 과거는 그대로다 ──
 * 이미 차감된 회차는 그 항목의 instructorId 가 들고 있으므로 자동으로 그 시점
 * 강사의 급여로 남는다. 남은 회차는 새 강사가 차감하면서 새 강사의 급여가
 * 된다. 그래서 바꿀 것은 passes 문서의 instructorId 하나뿐이고, 과거 항목은
 * 건드리지 않는다. 다만 덮어쓰기만 하면 "언제 누구에게서 누구로"가 사라지므로
 * type "transfer" 항목을 함께 남긴다.
 */

import {
  LEDGER_ENTRY_TYPE, PASS_STATUS, PAYMENT_METHOD,
} from "../schema/constants.js";
import { paths } from "../schema/paths.js";
import { resolveUnitPrice } from "../schema/pay-rates.js";
import { readCollection } from "./repository-read.js";

/**
 * @typedef {object} PassStore
 * @property {(collectionPath: string) => Promise<Array<any>>} list
 * @property {(writes: Array<{ path: string, data: object, operation?: "set" | "update" }>) => Promise<void>} commit
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
 * product-repository.js 의 createFirestoreProductStore 와 같은 방식이다.
 */
export function createFirestorePassStore() {
  const load = () => import("firebase/firestore");
  return {
    list: async (collectionPath) => {
      const { collection, getDocs, getFirestore } = await load();
      const snapshot = await getDocs(collection(getFirestore(), collectionPath));
      return snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
    },
    /* writeBatch 는 전부 쓰이거나 전부 안 쓰인다. 회원권과 원장 항목이 갈라져
       저장되면 잔여 횟수의 근거가 사라지고, 원장은 고칠 수 없다.

       operation 을 나누는 이유: 담당 강사 교체는 회원권의 한 필드만 바꾼다.
       이것을 set 으로 쓰면 계약 금액도 잔여 횟수도 통째로 날아간다. */
    commit: async (writes) => {
      const { doc, getFirestore, writeBatch } = await load();
      const firestore = getFirestore();
      const batch = writeBatch(firestore);
      for (const write of writes) {
        const reference = doc(firestore, write.path);
        if (write.operation === "update") batch.update(reference, write.data);
        else batch.set(reference, write.data);
      }
      await batch.commit();
    },
    serverTimestamp: async () => {
      const { serverTimestamp } = await load();
      return serverTimestamp();
    },
  };
}

const passesCollection = (organizationId) => {
  // paths.pass 로 문서 경로를 만든 뒤 마지막 한 칸을 떼어 컬렉션 경로를 얻는다.
  // 컬렉션 이름 리터럴을 여기에 다시 적지 않기 위해서다.
  const documentPath = paths.pass(organizationId, "placeholder");
  return documentPath.slice(0, documentPath.lastIndexOf("/"));
};

const byIssuedAtDesc = (left, right) => {
  const round = (pass) => Number(pass.purchaseRound) || 0;
  if (round(left) !== round(right)) return round(right) - round(left);
  return String(right.id || "").localeCompare(String(left.id || ""));
};

/**
 * 회원권 목록. 최근 차수가 앞이다.
 *
 * 거르는 일은 클라이언트에서 한다 -- client-repository 와 같은 이유이고, 같은
 * 규모에서 같은 선택이다. 회원별·상태별 조합마다 복합 인덱스를 만들지 않는다.
 *
 * @param {string} organizationId
 * @param {{ clientId?: string, includeExpired?: boolean, store?: PassStore }} [options]
 */
export async function listPasses(organizationId, options = {}) {
  const { clientId = "", includeExpired = true, store = createFirestorePassStore() } = options;
  const organization = requiredText(organizationId, "organizationId");
  // 조회 실패는 빈 목록이 아니라 RepositoryReadError 로 나간다 -- repository-read.js 참고.
  const found = await readCollection({
    feature: "pass_directory",
    path: passesCollection(organization),
    read: (path) => store.list(path),
  });
  return found
    .filter((pass) => (clientId ? pass.clientId === clientId : true))
    .filter((pass) => (includeExpired ? true : pass.status === PASS_STATUS.ACTIVE))
    .sort(byIssuedAtDesc);
}

/**
 * 발급. 회원권과 원장의 발급 항목을 한 배치로 쓴다.
 *
 * delta 는 총 회차(기준 + 서비스)다. 서비스 회차도 차감되는 수업이므로 잔여
 * 횟수에 들어가야 하고, 들어가지 않으면 마지막 두 번의 수업이 근거 없이
 * 사라진다.
 *
 * occurredAt 은 createdAt 과 같다. 차감은 밤에 몰아 입력하는 일이 있어 규칙이
 * 7일 창을 열어 두지만, 발급은 그 자리에서 일어난다.
 *
 * @param {string} organizationId
 * @param {{
 *   clientId: string, locationId: string, productId: string, payCategory: string,
 *   totalSessions: number, contractPrice: number, instructorId: string, createdBy: string,
 *   serviceSessions?: number, purchaseRound?: number, paymentMethod?: string,
 *   unitPrice?: number, fullRoomRate?: number, passId?: string, entryId?: string,
 * }} input
 * @param {{ store?: PassStore, newId?: () => string }} [options]
 */
export async function issuePass(organizationId, input, options = {}) {
  const {
    store = createFirestorePassStore(),
    newId = () => globalThis.crypto?.randomUUID?.() || `pass-${Date.now()}`,
  } = options;
  const organization = requiredText(organizationId, "organizationId");
  const payCategory = requiredText(input?.payCategory, "payCategory");
  const paymentMethod = String(input?.paymentMethod ?? PAYMENT_METHOD.CARD).trim() || PAYMENT_METHOD.CARD;
  if (!values(PAYMENT_METHOD).has(paymentMethod)) throw new Error("Invalid paymentMethod");

  const totalSessions = requiredInt(input?.totalSessions, "totalSessions", { min: 1 });
  const serviceSessions = requiredInt(input?.serviceSessions ?? 0, "serviceSessions", { min: 0 });
  const contractPrice = requiredInt(input?.contractPrice, "contractPrice", { min: 0 });
  const purchaseRound = requiredInt(input?.purchaseRound ?? 1, "purchaseRound", { min: 1 });
  /* 단가가 어디서 오든 -- 표, 담당 강사의 풀방금액, 직접 입력 -- 정해지지
     않으면 여기서 거부된다. 물어보지 않고 0원으로 발급되면 그 수업들이 통째로
     무보수로 기록되고, 원장은 고칠 수 없다. */
  const unitPrice = resolveUnitPrice(payCategory, {
    unitPrice: input?.unitPrice,
    fullRoomRate: input?.fullRoomRate,
  });

  const clientId = requiredText(input?.clientId, "clientId");
  const locationId = requiredText(input?.locationId, "locationId");
  const productId = requiredText(input?.productId, "productId");
  const instructorId = requiredText(input?.instructorId, "instructorId");
  const createdBy = requiredText(input?.createdBy, "createdBy");

  const passId = String(input?.passId || newId());
  const entryId = String(input?.entryId || `${passId}_issue`);
  const stampedAt = await store.serverTimestamp();
  const totalCount = totalSessions + serviceSessions;

  const pass = {
    organizationId: organization,
    clientId,
    locationId,
    productId,
    category: payCategory,
    totalSessions,
    serviceSessions,
    contractPrice,
    paymentMethod,
    purchaseRound,
    remainingCount: totalCount,
    instructorId,
    status: PASS_STATUS.ACTIVE,
    createdAt: stampedAt,
    createdBy,
  };

  const entry = {
    organizationId: organization,
    passId,
    locationId,
    type: LEDGER_ENTRY_TYPE.ISSUE,
    delta: totalCount,
    category: payCategory,
    unitPrice,
    instructorId,
    occurredAt: stampedAt,
    createdAt: stampedAt,
    createdBy,
  };

  await store.commit([
    { path: paths.pass(organization, passId), data: pass },
    { path: paths.passLedgerEntry(organization, passId, entryId), data: entry },
  ]);
  return { passId, entryId, pass, entry };
}

/**
 * 담당 강사 교체.
 *
 * 과거 항목은 손대지 않는다. 이미 차감된 회차는 그 항목의 instructorId 가 들고
 * 있어 그 시점 강사의 급여로 확정돼 있고, 남은 회차는 새 강사가 차감하면서
 * 새 강사의 급여가 된다. 그래서 바뀌는 것은 passes 문서의 instructorId 하나다.
 *
 * transfer 항목에는 category 와 unitPrice 를 넣지 않는다. 교체는 돈이 오가는
 * 일이 아니라 이 두 필드에 넣을 참값이 없고, 자리를 채우려고 아무 값이나 넣으면
 * 급여를 카테고리별로 묶는 계산에 그 거짓이 섞여 든다. 없는 것은 없다고 둔다.
 *
 * @param {string} organizationId
 * @param {string} passId
 * @param {{ fromInstructorId: string, toInstructorId: string, locationId: string, createdBy: string, entryId?: string }} input
 * @param {{ store?: PassStore, newId?: () => string }} [options]
 */
export async function transferPassInstructor(organizationId, passId, input, options = {}) {
  const {
    store = createFirestorePassStore(),
    newId = () => globalThis.crypto?.randomUUID?.() || `transfer-${Date.now()}`,
  } = options;
  const organization = requiredText(organizationId, "organizationId");
  const id = requiredText(passId, "passId");
  const fromInstructorId = requiredText(input?.fromInstructorId, "fromInstructorId");
  const toInstructorId = requiredText(input?.toInstructorId, "toInstructorId");
  // 같은 사람으로의 교체는 이력만 어지럽힌다. 화면이 실수로 보내는 것을 여기서 막는다.
  if (fromInstructorId === toInstructorId) throw new Error("Invalid toInstructorId");
  const locationId = requiredText(input?.locationId, "locationId");
  const createdBy = requiredText(input?.createdBy, "createdBy");

  const entryId = String(input?.entryId || `${id}_transfer_${newId()}`);
  const stampedAt = await store.serverTimestamp();

  const entry = {
    organizationId: organization,
    passId: id,
    locationId,
    type: LEDGER_ENTRY_TYPE.TRANSFER,
    delta: 0,
    fromInstructorId,
    toInstructorId,
    occurredAt: stampedAt,
    createdAt: stampedAt,
    createdBy,
  };

  /* 회원권의 주인이 바뀌었는데 이력이 없거나, 이력만 있고 주인이 그대로이면
     둘 다 틀린 상태다. 발급과 같은 이유로 한 배치에 묶는다. */
  await store.commit([
    { path: paths.passLedgerEntry(organization, id, entryId), data: entry },
    // set 이 아니라 update 다. set 이면 계약 금액도 잔여 횟수도 통째로 날아간다.
    { path: paths.pass(organization, id), data: { instructorId: toInstructorId }, operation: "update" },
  ]);
  return { passId: id, entryId, entry };
}
