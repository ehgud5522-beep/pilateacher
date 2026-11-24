/**
 * 플로우 PT 발급 대기 저장소 (2026-11-24). 서버(syncFlowPtQueue)가 만들고, 대표 · 총괄 · FC 가 읽고 처리 칸만 고친다.
 * 판정 · 칸은 functions/shared/flow-pt-queue.mjs, 규칙은 firestore.foundation.rules 의 flowPtQueue.
 */
import { readCollection } from "./repository-read.js";

/* functions/shared/flow-pt-queue.mjs 와 같은 값 -- 그 모듈을 src/data 타입 검사 범위로 끌어오지 않으려고 둔다.
   테스트가 두 값이 같은지 본다. */
export const FLOW_PT_COLLECTION = "flowPtQueue";
export const FLOW_PT_STATE = Object.freeze({ WAITING: "waiting", ISSUED: "issued", NOT_APPLICABLE: "not_applicable", BASELINE: "baseline" });
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
      const snapshot = await getDocs(scoped.length
        ? query(base, where("locationId", "in", scoped), where("registeredAt", ">=", since))
        : query(base, where("registeredAt", ">=", since)));
      /* 기준선(2026-11-24 "오늘부터" 전에 이미 성공이던 업무)은 보이지 않는다. */
      return snapshot.docs
        .map((item) => /** @type {{ id: string, state?: string }} */ ({ id: item.id, ...item.data() }))
        .filter((row) => row.state !== FLOW_PT_STATE.BASELINE);
    },
  });
}

/** 처리 표시: 발급함 · 해당 없음 · 되돌리기(waiting). 처리 칸 셋만 쓴다 (규칙도 그것만 연다). */
export async function markFlowPtQueue(organizationId, postId, state, uid) {
  if (![FLOW_PT_STATE.WAITING, FLOW_PT_STATE.ISSUED, FLOW_PT_STATE.NOT_APPLICABLE].includes(state)) throw Object.assign(new Error("flow_pt_state_invalid"), { code: "flow_pt_state_invalid" });
  const { doc, getFirestore, serverTimestamp, updateDoc } = await load();
  await updateDoc(doc(getFirestore(), "organizations", String(organizationId), FLOW_PT_COLLECTION, String(postId)), {
    state, handledBy: String(uid || ""), handledAt: serverTimestamp(),
  });
}
