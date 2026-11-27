/**
 * 플로우 PT 발급 대기 저장소 (2026-11-24). 서버(syncFlowPtQueue)가 만들고, 대표 · 총괄 · FC 가 읽고 처리 칸만 고친다.
 * 판정 · 칸은 functions/shared/flow-pt-queue.mjs, 규칙은 firestore.foundation.rules 의 flowPtQueue.
 */
import { readCollection } from "./repository-read.js";

/* functions/shared/flow-pt-queue.mjs 와 같은 값 -- 그 모듈을 src/data 타입 검사 범위로 끌어오지 않으려고 둔다.
   테스트가 두 값이 같은지 본다. */
export const FLOW_PT_COLLECTION = "flowPtQueue";
export const FLOW_PT_STATE = Object.freeze({ WAITING: "waiting", ISSUED: "issued", NOT_APPLICABLE: "not_applicable", BASELINE: "baseline" });
export const FLOW_PT_FLOW_STATUS = Object.freeze({ SUCCESS: "success", LEFT: "left" });
export const FLOW_PT_READ_DAYS = 45;

const load = () => import("firebase/firestore");

/**
 * 최근 45일에 플로우에 올라온 PT 업무. 대표 · 총괄은 전부, FC 는 맡은 지점만(locationIds 가 있을 때).
 * @param {string} organizationId
 * @param {{ locationIds?: string[], now?: Date }} [options]
 */
export function listFlowPtQueue(organizationId, { locationIds = [], now = new Date() } = {}) {
  const scoped = (locationIds || []).map((id) => String(id ?? "").trim()).filter(Boolean).slice(0, 30);
  return readCollection({
    feature: "flow_pt_queue",
    path: `organizations/${organizationId}/${FLOW_PT_COLLECTION}${scoped.length ? "?locationId=in" : ""}`,
    read: async () => {
      const { collection, getDocs, getFirestore, query, where } = await load();
      const since = new Date(now.getTime() - FLOW_PT_READ_DAYS * 86400000);
      const base = collection(getFirestore(), "organizations", String(organizationId), FLOW_PT_COLLECTION);
      const scope = scoped.length ? [where("locationId", "in", scoped)] : [];
      /* 두 번 읽어 합친다 (2026-11-28):
           1. 최근 45일에 등록된 것 -- 처리한 것까지 (카드 아래 "처리한 것")
           2. **아직 대기인 것은 날짜와 상관없이** -- registeredAt 은 플로우의 실제 등록 시각이라, 두 달 전에 상담으로
              올렸다가 오늘 성공으로 옮긴 글은 1 에 걸리지 않는다. 대기는 몇십 건이라 읽는 양이 늘지 않는다. */
      const [recent, waiting] = await Promise.all([
        getDocs(query(base, ...scope, where("registeredAt", ">=", since))),
        getDocs(query(base, ...scope, where("state", "==", FLOW_PT_STATE.WAITING))),
      ]);
      const rows = new Map();
      for (const item of [...recent.docs, ...waiting.docs]) rows.set(item.id, /** @type {{ id: string, state?: string }} */ ({ id: item.id, ...item.data() }));
      /* 기준선(2026-11-24 "오늘부터" 전에 이미 성공이던 업무)은 보이지 않는다. */
      return [...rows.values()].filter((row) => row.state !== FLOW_PT_STATE.BASELINE);
    },
  });
}

/**
 * 발급 대기 하나를 지금 값으로 다시 읽는다 (2026-11-28). 발급 직전에 그 등록이 아직 대기인지 본다 --
 * 화면을 연 뒤 누가 처리했으면 규칙이 이유 없이 거절한다 (src/features/membership/pass-issue-preflight.js).
 * 없으면 null.
 * @param {string} organizationId @param {string} postId
 */
export async function readFlowPtQueueItem(organizationId, postId) {
  const { doc, getDoc, getFirestore } = await load();
  const snapshot = await getDoc(doc(getFirestore(), "organizations", String(organizationId), FLOW_PT_COLLECTION, String(postId)));
  return snapshot.exists() ? /** @type {{ id: string, state?: string }} */ ({ id: snapshot.id, ...snapshot.data() }) : null;
}

/** 처리 표시: 발급함 · 해당 없음 · 되돌리기(waiting). 처리 칸 셋만 쓴다 (규칙도 그것만 연다). */
export async function markFlowPtQueue(organizationId, postId, state, uid) {
  if (![FLOW_PT_STATE.WAITING, FLOW_PT_STATE.ISSUED, FLOW_PT_STATE.NOT_APPLICABLE].includes(state)) throw Object.assign(new Error("flow_pt_state_invalid"), { code: "flow_pt_state_invalid" });
  const { doc, getFirestore, serverTimestamp, updateDoc } = await load();
  await updateDoc(doc(getFirestore(), "organizations", String(organizationId), FLOW_PT_COLLECTION, String(postId)), {
    state, handledBy: String(uid || ""), handledAt: serverTimestamp(),
  });
}

/**
 * 발급 뒤 플로우 내용이 바뀐 것을 봤다 (2026-11-28, 3단계). 서버가 남긴 changedAfterIssueAt 옆에 확인 칸 둘만 쓴다 (규칙도 그것만).
 * @param {string} organizationId @param {string} postId @param {string} uid
 */
export async function ackFlowPtChange(organizationId, postId, uid) {
  const { doc, getFirestore, serverTimestamp, updateDoc } = await load();
  await updateDoc(doc(getFirestore(), "organizations", String(organizationId), FLOW_PT_COLLECTION, String(postId)), {
    changeAckedAt: serverTimestamp(), changeAckedBy: String(uid || ""),
  });
}

/**
 * 잔금 받음 (2026-11-28, 3단계 · 대표 결정: 계약금 때 발급, 잔금은 회원권 잔금 칸). 잔금 글 하나로 회원권 하나의 잔금을 받은
 * 만큼 줄이고, 같은 트랜잭션에서 그 글을 처리됨으로 -- 규칙이 둘이 서로를 가리키는지, 줄어든 금액이 받은 금액과 같은지 본다.
 * 회원권의 지금 잔금을 트랜잭션 안에서 읽는다 (화면이 연 뒤 다른 사람이 줄였으면 그 값에서 뺀다).
 *
 * @param {string} organizationId
 * @param {{ postId: string, passId: string, receivedWon: number, uid: string }} input
 * @returns {Promise<{ before: number, after: number }>}
 */
export async function recordFlowPtBalanceReceipt(organizationId, { postId, passId, receivedWon, uid }) {
  const received = Number(receivedWon);
  if (!Number.isInteger(received) || received <= 0) throw Object.assign(new Error("Invalid receivedWon"), { code: "balance_received_invalid" });
  const { doc, getFirestore, runTransaction, serverTimestamp } = await load();
  const firestore = getFirestore();
  const passRef = doc(firestore, "organizations", String(organizationId), "passes", String(passId));
  const postRef = doc(firestore, "organizations", String(organizationId), FLOW_PT_COLLECTION, String(postId));
  return runTransaction(firestore, async (transaction) => {
    const pass = await transaction.get(passRef);
    if (!pass.exists()) throw Object.assign(new Error("Pass not found"), { code: "balance_pass_missing" });
    const before = Number(pass.data()?.balance) || 0;
    if (received > before) throw Object.assign(new Error("Received more than balance"), { code: "balance_received_over" });
    const after = before - received;
    transaction.update(passRef, { balance: after, balanceFlowPostId: String(postId), balanceUpdatedAt: serverTimestamp(), balanceUpdatedBy: String(uid || "") });
    transaction.update(postRef, { state: FLOW_PT_STATE.ISSUED, handledBy: String(uid || ""), handledAt: serverTimestamp(), balancePassId: String(passId), balanceReceivedWon: received });
    return { before, after };
  });
}
