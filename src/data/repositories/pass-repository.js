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
  ATTENDANCE_STATUS, LEDGER_ENTRY_TYPE, LESSON_STATUS, PASS_STATUS, PAYMENT_METHOD,
} from "../schema/constants.js";
import { paths } from "../schema/paths.js";
import { toDate } from "./payroll-repository.js";
import { resolveUnitPrice } from "../schema/pay-rates.js";
import { RepositoryReadError, readCollection } from "./repository-read.js";

/**
 * @typedef {object} PassStore
 * @property {(collectionPath: string) => Promise<Array<any>>} list
 * @property {(writes: Array<{ path: string, data: object, operation?: "set" | "update" | "decrement" | "bump" }>) => Promise<void>} commit
 * @property {(documentPath: string) => Promise<any | null>} read
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
        if (write.operation === "bump") {
          /* 없으면 만들고, 있으면 더한다. 첫 수업에 update 를 쓰면 문서가 없어
             배치 전체가 실패한다 -- 차감까지 함께 죽는다. */
          const { increment } = await load();
          const { delta, ...fields } = write.data;
          const deltas = Object.fromEntries(
            Object.entries(delta || {}).map(([field, by]) => [field, increment(Number(by))]),
          );
          batch.set(reference, { ...fields, ...deltas }, { merge: true });
        } else if (write.operation === "decrement") {
          /* 읽어서 빼지 않는다. 두 강사가 같은 순간에 눌러도 하나가 다른 하나를
             덮어쓰지 않도록 서버가 더한다. */
          const { increment } = await load();
          const deltas = Object.fromEntries(
            Object.entries(write.data).map(([field, by]) => [field, increment(Number(by))]),
          );
          batch.update(reference, deltas);
        } else if (write.operation === "update") batch.update(reference, write.data);
        else batch.set(reference, write.data);
      }
      await batch.commit();
    },
    read: async (documentPath) => {
      const { doc, getDoc, getFirestore } = await load();
      const snapshot = await getDoc(doc(getFirestore(), documentPath));
      return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
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
 *   unitPrice?: number, fullRoomRate?: number, expiresAt?: Date | string,
 *   passId?: string, entryId?: string,
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
  /* 계약서에 적힌 만료일. 회원이 가장 자주 묻는 값이라 지어내지 않고 받는다. */
  const expiresAt = input?.expiresAt instanceof Date ? input.expiresAt : new Date(String(input?.expiresAt ?? ""));
  if (!Number.isFinite(expiresAt.getTime())) throw new Error("Invalid expiresAt");
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
    expiresAt,
    /* 발급 시점에는 아직 아무도 넘겨받지 않았다. 담당이 교체되면 true 가 되고,
       그 뒤로 이 회원권의 차감은 판정 2 (인수인계 25,000)를 탄다. */
    handedOver: false,
    /* 이 회원권이 회당 얼마를 주는가. 차감할 때 여기서 읽는다 -- 상품이 나중에
       바뀌어도, 담당 강사의 풀방금액이 나중에 올라도, 이 회원권의 단가는 발급
       시점에 확정된 값이다. */
    unitPrice,
    instructorId,
    status: PASS_STATUS.ACTIVE,
    createdAt: stampedAt,
    createdBy,
  };

  const entry = {
    organizationId: organization,
    passId,
    clientId,
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
 * @param {{ clientId: string, fromInstructorId: string, toInstructorId: string, locationId: string, createdBy: string, entryId?: string }} input
 * @param {{ store?: PassStore, newId?: () => string }} [options]
 */
export async function transferPassInstructor(organizationId, passId, input, options = {}) {
  const {
    store = createFirestorePassStore(),
    newId = () => globalThis.crypto?.randomUUID?.() || `transfer-${Date.now()}`,
  } = options;
  const organization = requiredText(organizationId, "organizationId");
  const id = requiredText(passId, "passId");
  const clientId = requiredText(input?.clientId, "clientId");
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
    clientId,
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
    /* set 이 아니라 update 다. set 이면 계약 금액도 잔여 횟수도 통째로 날아간다.
       handedOver 를 함께 올린다 -- 담당만 바뀌고 이 플래그가 안 서면 새 강사가
       인수인계 단가가 아니라 기준 단가를 받는다. */
    {
      path: paths.pass(organization, id),
      data: { instructorId: toInstructorId, handedOver: true },
      operation: "update",
    },
  ]);
  return { passId: id, entryId, entry };
}

/* ── 출석 체크(차감) ───────────────────────────────────────────────────────
   차감 한 번이 세 문서를 건드린다.

     lessons/{lessonId}                        이 차감이 가리키는 수업
     lessons/{lessonId}/participants/{client}  누가 그 수업에 왔는가
     passes/{passId}/ledger/{entryId}          급여의 근거
     passes/{passId}.remainingCount            잔여 횟수

   규칙이 deduct 에 lessonId 를 필수로 요구한다. 아직 일정 기능과 이어지지
   않았지만, 그 요구를 규칙에서 푸는 대신 수업 문서를 함께 만든다.

     - 원장은 append-only 다. lessonId 없이 쌓인 항목은 나중에 채울 수 없고,
       "이 급여가 어느 수업에서 나왔나"를 영영 답할 수 없게 된다.
     - 없는 수업을 가리키는 id 를 지어 넣는 것은 더 나쁘다. 참조가 깨진 채로
       남고, 그 사실을 아무도 모른다.
     - 수업 문서를 만드는 데 드는 비용은 같은 배치에 쓰기 두 번뿐이고, 나중에
       일정과 이을 때 그 데이터가 이미 자리에 있다.

   단가는 회원권에 박힌 값을 그대로 쓴다. 표도 강사의 풀방금액도 다시 보지
   않는다 -- 발급 뒤에 그것들이 바뀌어도 이 회원권의 급여는 움직이지 않는다.
   ────────────────────────────────────────────────────────────────────────── */

/** 규칙이 occurredAt 을 이 창 안으로 제한한다. 화면도 같은 범위만 고르게 한다. */
export const DEDUCT_BACKDATE_LIMIT_DAYS = 7;

/**
 * 잔여 횟수. 정수가 아니면 0 으로 본다 -- 규칙이 remainingCount 를 int 로만
 * 받으므로, 문자열로 저장된 값을 화면이 숫자처럼 보여 주면 누를 수는 있는데
 * 서버가 거부하는 회원권이 된다.
 *
 * @param {any} pass
 */
export function remainingCountOf(pass) {
  const count = pass?.remainingCount;
  return typeof count === "number" && Number.isInteger(count) && count >= 0 ? count : 0;
}

/**
 * 만료일이 지났는가.
 *
 * status 는 사람이나 배치가 바꿔 주기 전까지 active 로 남는다. 만료일만 지나고
 * status 가 그대로인 회원권이 반드시 생기므로, 날짜도 함께 본다 -- 그러지 않으면
 * 화면이 쓸 수 없는 회차를 "남았다"고 말한다. 분쟁 때 여는 화면이라 그 숫자가
 * 곧 근거가 된다.
 *
 * 만료일이 없는 회원권은 만료되지 않은 것으로 본다. 이 필드가 생기기 전에
 * 발급된 건을 하루아침에 못 쓰게 만들 수는 없다.
 *
 * @param {any} pass @param {Date} [now]
 */
export function isExpiredPass(pass, now = new Date()) {
  const at = pass?.expiresAt;
  if (at === undefined || at === null || at === "") return false;
  const expiry = toDate(at);
  if (!Number.isFinite(expiry.getTime())) return false;
  return expiry.getTime() < now.getTime();
}

/** 차감할 수 있는 회원권인가. 화면이 목록에서 거르는 데 쓴다. @param {any} pass @param {Date} [now] */
export function isDeductablePass(pass, now = new Date()) {
  return pass?.status === PASS_STATUS.ACTIVE
    && remainingCountOf(pass) > 0
    && !isExpiredPass(pass, now);
}

/**
 * 한 회차를 차감한다. 위 네 가지를 한 배치로 쓴다.
 *
 * @param {string} organizationId
 * @param {any} pass 회원권 문서 (id, clientId, locationId, category, unitPrice, remainingCount)
 * @param {{ instructorId: string, createdBy: string, occurredAt: Date, lessonId?: string, entryId?: string }} input
 * @param {{ store?: PassStore, newId?: () => string, now?: () => Date }} [options]
 */
export async function deductPass(organizationId, pass, input, options = {}) {
  const {
    store = createFirestorePassStore(),
    newId = () => globalThis.crypto?.randomUUID?.() || `lesson-${Date.now()}`,
    now = () => new Date(),
  } = options;
  const organization = requiredText(organizationId, "organizationId");
  const passId = requiredText(pass?.id || pass?.passId, "passId");
  const clientId = requiredText(pass?.clientId, "clientId");
  const locationId = requiredText(pass?.locationId, "locationId");
  const instructorId = requiredText(input?.instructorId, "instructorId");
  const createdBy = requiredText(input?.createdBy, "createdBy");

  // 잔여가 없는 회원권은 여기서 막는다. 원장은 고칠 수 없으므로 음수 잔여가
  // 한 번 생기면 그 회원권의 기록은 영영 앞뒤가 안 맞는다.
  if (!isDeductablePass(pass)) throw new Error("Missing remainingCount");

  const category = requiredText(pass?.category, "category");
  const unitPrice = pass?.unitPrice;
  /* 발급 시점에 박힌 값이 없으면 지어내지 않는다. 표에서 다시 읽으면 그 사이
     바뀐 단가가 지난 회원권에 소급되고, 0 을 넣으면 그 수업이 무보수가 된다. */
  if (!Number.isInteger(unitPrice) || unitPrice < 0) throw new Error("Missing unitPrice");

  const occurredAt = input?.occurredAt instanceof Date ? input.occurredAt : new Date(String(input?.occurredAt ?? ""));
  if (!Number.isFinite(occurredAt.getTime())) throw new Error("Invalid occurredAt");
  const today = now();
  if (occurredAt.getTime() > today.getTime()) throw new Error("Invalid occurredAt");
  const oldest = today.getTime() - DEDUCT_BACKDATE_LIMIT_DAYS * 24 * 60 * 60 * 1000;
  // 규칙이 같은 창으로 막는다. 여기서 먼저 막는 것은 무엇이 문제인지 말해 주기 위해서다.
  if (occurredAt.getTime() <= oldest) throw new Error("Invalid occurredAt");

  const lessonId = String(input?.lessonId || newId());
  const entryId = String(input?.entryId || `${lessonId}_deduct`);
  const stampedAt = await store.serverTimestamp();

  const lesson = {
    organizationId: organization,
    lessonId,
    clientId,
    locationId,
    instructorId,
    startsAt: occurredAt,
    status: LESSON_STATUS.COMPLETED,
    createdAt: stampedAt,
    createdBy,
  };
  const participant = {
    organizationId: organization,
    lessonId,
    clientId,
    attendanceStatus: ATTENDANCE_STATUS.ATTENDED,
  };
  const entry = {
    organizationId: organization,
    passId,
    clientId,
    locationId,
    type: LEDGER_ENTRY_TYPE.DEDUCT,
    delta: -1,
    category,
    unitPrice,
    lessonId,
    instructorId,
    occurredAt,
    createdAt: stampedAt,
    createdBy,
  };

  await store.commit([
    { path: paths.lesson(organization, lessonId), data: lesson },
    { path: paths.lessonParticipant(organization, lessonId, clientId), data: participant },
    { path: paths.passLedgerEntry(organization, passId, entryId), data: entry },
    /* 잔여는 읽어서 빼지 않고 서버가 하나 줄인다. 두 강사가 같은 순간에 눌러도
       하나가 다른 하나를 덮어쓰지 않는다. 규칙은 계산된 값을 보고 -1 인지 따진다. */
    { path: paths.pass(organization, passId), data: { remainingCount: -1 }, operation: "decrement" },
    /* 이 강사가 이 회원에게 몇 회를 했는가. 급여 판정이 이 숫자를 보고 신규
       단가인지 기준 단가인지 가른다 (deduction-pricing.js 판정 3).
       원장으로는 셀 수 없다 -- 항목이 회원권마다 흩어져 있고, 세려면 센터
       전체를 훑어야 한다. 차감과 같은 배치라 둘이 어긋날 수 없다. */
    {
      path: paths.instructorClientTotal(organization, instructorId, clientId),
      data: {
        organizationId: organization,
        instructorId,
        clientId,
        delta: { sessions: 1 },
      },
      operation: "bump",
    },
  ]);
  return { passId, lessonId, entryId, entry, lesson };
}

/* ── 회원 한 명의 회원권과 이력 ────────────────────────────────────────────
   분쟁이 생겼을 때 여는 자리다. "몇 회 남았나"와 "언제 무엇이 일어났나"가
   같은 화면에서 답해져야 한다.

   ── 왜 collectionGroup 을 쓰지 않는가 ──
   원장 항목은 clientId 를 들고 있지 않다. 가진 것은 passId 뿐이라, 회원 기준
   그룹 쿼리는 인덱스를 추가해서 되는 일이 아니라 append-only 기록에 필드를
   더해야 하는 일이다. 그리고 이미 쌓인 항목에는 그 필드가 영영 없다.

   회원권 쪽으로 도는 편이 맞기도 하다. 한 회원의 회원권은 차수만큼이라 보통
   한두 개, 많아야 다섯이다. 급여 집계가 그룹 쿼리를 쓰는 이유(강사 한 사람의
   한 달이 센터 전체에 흩어져 있다)가 여기서는 성립하지 않는다.

   그래서 인덱스도 규칙도 그대로다.
   ────────────────────────────────────────────────────────────────────────── */

const ledgerCollection = (organizationId, passId) => {
  const documentPath = paths.passLedgerEntry(organizationId, passId, "placeholder");
  return documentPath.slice(0, documentPath.lastIndexOf("/"));
};

/**
 * 회원권 하나의 원장. 발급·차감·담당 교체가 모두 들어 있다.
 *
 * @param {string} organizationId
 * @param {string} passId
 * @param {{ store?: PassStore }} [options]
 */
export async function listPassLedger(organizationId, passId, options = {}) {
  const { store = createFirestorePassStore() } = options;
  const organization = requiredText(organizationId, "organizationId");
  const id = requiredText(passId, "passId");
  // 조회 실패는 빈 목록이 아니라 RepositoryReadError 로 나간다 -- repository-read.js 참고.
  return readCollection({
    feature: "pass_ledger",
    path: ledgerCollection(organization, id),
    read: (path) => store.list(path),
  });
}

/**
 * 지금 쓸 수 있는 회차의 합.
 *
 * 종료·취소된 회원권도, 만료일이 지난 회원권도 빼고 센다. 남은 숫자가 들어
 * 있더라도 그 회원권으로 수업할 수 없으므로, 더하면 화면이 실제보다 많이
 * 남았다고 말하게 된다 -- 분쟁 때 여는 화면이라 그 숫자가 곧 근거가 된다.
 *
 * @param {Array<any>} passes @param {Date} [now]
 */
export function activeRemainingTotal(passes, now = new Date()) {
  return (Array.isArray(passes) ? passes : [])
    .filter((pass) => pass?.status === PASS_STATUS.ACTIVE && !isExpiredPass(pass, now))
    .reduce((sum, pass) => sum + remainingCountOf(pass), 0);
}

/** 최신이 위. 같은 시각이면 발급이 차감보다 먼저 일어난 것으로 본다. */
const byOccurredAtDesc = (left, right) => {
  const gap = toDate(right.occurredAt).getTime() - toDate(left.occurredAt).getTime();
  if (gap !== 0 && Number.isFinite(gap)) return gap;
  const rank = (entry) => (entry.type === LEDGER_ENTRY_TYPE.ISSUE ? 1 : 0);
  return rank(left) - rank(right);
};

/**
 * 회원 한 명의 회원권과 그 원장 전체.
 *
 * 회원권마다 원장을 읽는다. 한 회원의 회원권은 보통 한두 개라 이 편이 그룹
 * 쿼리보다 단순하고, 무엇보다 원장이 clientId 를 들고 있지 않아 그룹 쿼리로는
 * 애초에 회원을 지목할 수 없다.
 *
 * 원장 하나를 못 읽어도 나머지는 보여준다. 분쟁 중에 화면이 통째로 비는 것보다
 * "이 회원권의 이력을 못 읽었다"가 낫다 -- 못 읽은 회원권은 failedPassIds 로
 * 나가고 화면이 그 사실을 말한다.
 *
 * @param {string} organizationId
 * @param {string} clientId
 * @param {{ store?: PassStore, now?: () => Date }} [options]
 */
export async function loadClientPassHistory(organizationId, clientId, options = {}) {
  const { store = createFirestorePassStore(), now = () => new Date() } = options;
  const organization = requiredText(organizationId, "organizationId");
  const client = requiredText(clientId, "clientId");
  const passes = await listPasses(organization, { clientId: client, store });

  const failedPassIds = [];
  const ledgers = await Promise.all(passes.map((pass) => (
    listPassLedger(organization, pass.id, { store })
      .then((entries) => entries.map((entry) => ({ ...entry, passId: entry.passId || pass.id })))
      .catch(() => { failedPassIds.push(pass.id); return []; })
  )));

  return {
    passes,
    remainingTotal: activeRemainingTotal(passes, now()),
    entries: ledgers.flat().sort(byOccurredAtDesc),
    failedPassIds,
  };
}

/* ── 강사-회원 누적 진행 횟수 ──────────────────────────────────────────────
   급여 판정이 "이 강사에게 이 회원 누적 20회 미만이면 신규 단가"를 묻는다
   (deduction-pricing.js 판정 3). 원장으로는 셀 수 없다 -- 항목이 회원권마다
   흩어져 있고, 세려면 센터 전체를 훑어야 한다.

   그래서 차감할 때마다 한 칸 올리는 문서를 따로 둔다. 차감과 같은 배치에
   들어가므로 둘이 어긋날 수 없다.

   기준은 강사-회원 쌍이다. 같은 회원이라도 강사가 다르면 각자 0부터 세고,
   같은 강사에게 재등록해도 그 강사 기준으로 이어 센다.
   ────────────────────────────────────────────────────────────────────────── */

/**
 * 이 강사가 이 회원에게 이미 진행한 횟수.
 *
 * 문서가 없으면 0 이다 -- 아직 한 번도 안 했다는 뜻이고, 판정 3 이 그것을
 * 신규로 읽는다. 읽지 못한 것과는 다르다: 그때는 던진다. 조용히 0 으로 떨어지면
 * 20회를 넘긴 강사가 신규 단가를 받고, 그 값이 원장에 박혀 고칠 수 없게 된다.
 *
 * @param {string} organizationId
 * @param {string} instructorId
 * @param {string} clientId
 * @param {{ store?: PassStore }} [options]
 * @returns {Promise<number>}
 */
export async function readInstructorClientSessions(organizationId, instructorId, clientId, options = {}) {
  const { store = createFirestorePassStore() } = options;
  const organization = requiredText(organizationId, "organizationId");
  const instructor = requiredText(instructorId, "instructorId");
  const client = requiredText(clientId, "clientId");
  const path = paths.instructorClientTotal(organization, instructor, client);
  let found = null;
  try {
    found = await store.read(path);
  } catch (error) {
    const code = error?.code || "unknown";
    throw new RepositoryReadError({
      feature: "instructor_client_totals", stage: "get", path, code, cause: error,
    });
  }
  const sessions = found?.sessions;
  return typeof sessions === "number" && Number.isInteger(sessions) && sessions >= 0 ? sessions : 0;
}
