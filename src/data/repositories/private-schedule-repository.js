/**
 * 본인 전용 일정(개인 일정 · 그룹 수업)을 `users/{uid}/scheduleItems/{itemId}` 에 쓰고 읽는다
 * (2026-10-31, 동기화 3단계). 문서 모양은 private-items.js 가 만든다.
 *
 * 1 · 2단계(lesson-schedule-repository.js)와 같은 판정이다:
 * - 서버와 같으면 쓰지 않는다
 * - 지운 표시(deletedAt)가 된 것은 이 기기가 지웠거나 사람이 되살리기를 눌렀을 때만 되살린다
 * - 서버 번호가 기기가 본 번호와 다르면 쓰지 않는다 (서버가 이긴다) -- 서버의 마지막 쓰기가
 *   이 기기면 아니다
 * 규칙이 그 계정 본인만 열고, 번호 +1 을 다시 본다 (firestore.foundation.rules).
 *
 * 스위치(runtimeConfig/privateSync)가 꺼진 계정은 **여기를 부르지 않는다** -- 웹 · 폰 모두
 * 서버에 아무것도 쓰지 않는다. 그 판단은 부르는 쪽(sync-gate.js)이 한다.
 */

import { PUBLISH_OUTCOME, revisionOf } from "./lesson-schedule-repository.js";

const text = (value) => String(value ?? "").trim();
const itemsPath = (uid) => `users/${text(uid)}/scheduleItems`;

/**
 * @param {{ firestore?: any }} [options]
 */
export function createFirestorePrivateItemStore(options = {}) {
  const load = () => import("firebase/firestore");
  return {
    async transact(documentPath, decide) {
      const { doc, getFirestore, runTransaction, serverTimestamp } = await load();
      const firestore = options.firestore || getFirestore();
      const reference = doc(firestore, documentPath);
      return runTransaction(firestore, async (transaction) => {
        const snapshot = await transaction.get(reference);
        const current = snapshot.exists() ? snapshot.data() : null;
        const { write, outcome } = decide(current);
        if (write) {
          transaction.set(reference, {
            ...write,
            updatedAt: serverTimestamp(),
            ...(current ? {} : { createdAt: serverTimestamp() }),
          }, { merge: true });
        }
        return { outcome, revision: write ? write.revision : revisionOf(current) };
      });
    },
  };
}

/** 번호 · 시각 · 기기 칸을 뺀 내용. 같은지 견줄 때 쓴다. */
const META_FIELDS = new Set(["revision", "updatedAt", "createdAt", "updatedDevice", "deletedAt", "id"]);
const contentOf = (value) => JSON.stringify(Object.keys(value || {})
  .filter((key) => !META_FIELDS.has(key)).sort().map((key) => [key, value[key]]));

/**
 * @param {any} current
 * @param {{ data: any, baseRevision?: number, deleted?: boolean, allowRevive?: boolean }} document
 * @param {{ deviceId?: string }} [options]
 * @returns {{ write: any | null, outcome: string }}
 */
export function decidePrivateWrite(current, document, options = {}) {
  const deleted = Boolean(document.deleted);
  const currentDeleted = Boolean(current?.deletedAt);
  if (current && currentDeleted === deleted && contentOf(current) === contentOf(document.data)) {
    return { write: null, outcome: PUBLISH_OUTCOME.UNCHANGED };
  }
  if (!current && deleted) return { write: null, outcome: PUBLISH_OUTCOME.UNCHANGED };
  const mine = Boolean(text(options.deviceId)) && text(current?.updatedDevice) === text(options.deviceId);
  if (currentDeleted && !deleted && !mine && document.allowRevive !== true) {
    return { write: null, outcome: PUBLISH_OUTCOME.CANCELLED_ELSEWHERE };
  }
  const serverRevision = revisionOf(current);
  if (current && !mine && serverRevision !== Math.max(0, Number(document.baseRevision) || 0)) {
    return { write: null, outcome: PUBLISH_OUTCOME.CONFLICT };
  }
  return { write: { ...document.data, revision: serverRevision + 1 }, outcome: PUBLISH_OUTCOME.WRITTEN };
}

/**
 * @param {string} uid
 * @param {Array<{ itemId: string, data: object, baseRevision?: number, deleted?: boolean, allowRevive?: boolean }>} documents
 * @param {{ store?: any, deviceId?: string }} [options]
 * @returns {Promise<Array<{ itemId: string, outcome: string, errorCode: string, revision: number }>>}
 */
export async function publishPrivateItems(uid, documents, options = {}) {
  const owner = text(uid);
  const store = options.store || createFirestorePrivateItemStore();
  const results = [];
  for (const document of Array.isArray(documents) ? documents : []) {
    const itemId = text(document?.itemId);
    if (!owner || !itemId) continue;
    try {
      const { outcome, revision } = await store.transact(`${itemsPath(owner)}/${itemId}`, (current) => {
        const decided = decidePrivateWrite(current, document, { deviceId: options.deviceId });
        if (!decided.write) return decided;
        return {
          outcome: decided.outcome,
          write: {
            ...decided.write,
            ...(text(options.deviceId) ? { updatedDevice: text(options.deviceId) } : {}),
            deletedAt: document.deleted ? new Date() : null,
          },
        };
      });
      results.push({ itemId, outcome, errorCode: "", revision: Number(revision) || 0 });
    } catch (error) {
      results.push({ itemId, outcome: PUBLISH_OUTCOME.FAILED, errorCode: text(error?.code) || "unknown", revision: 0 });
    }
  }
  return results;
}

/* 받는 질의: 30일 전 ~ 60일 뒤. 단일 필드라 새 색인이 필요 없다. */
const queryFor = (api, firestore, input) => api.query(
  api.collection(firestore, itemsPath(input.uid)),
  api.where("date", ">=", input.from), api.where("date", "<=", input.to),
);

/** 한 번 읽는다 (규칙 테스트 · 다시 시도). */
export async function readPrivateItems(input) {
  const api = await import("firebase/firestore");
  const firestore = input.firestore || api.getFirestore();
  const page = await api.getDocs(queryFor(api, firestore, input));
  return page.docs.map((document) => ({ id: document.id, ...document.data() }));
}

/**
 * 실시간으로 받는다.
 * @returns {Promise<() => void>}
 */
export async function subscribePrivateItems(input) {
  const api = await import("firebase/firestore");
  const firestore = input.firestore || api.getFirestore();
  if (!text(input.uid)) return () => {};
  return api.onSnapshot(queryFor(api, firestore, input), (snapshot) => {
    input.onDocs(snapshot.docs.map((document) => ({ id: document.id, ...document.data() })), {
      changes: snapshot.docChanges().length, fromCache: snapshot.metadata.fromCache,
    });
  }, (error) => input.onError?.(error));
}
