"use strict";

/**
 * 재등록 상담 소재 초안 통로 (설계 문서 5단계). 규칙 · 검사는 shared/consult-points.mjs.
 *
 * 누가: 대표 · 총괄, 또는 그 회원의 담당(clients.instructorIds) FC · 강사. 스위치(scheduleSync.consultPoints)가
 * 켜진 계정, 회원 단위 AI 동의(clients.aiConsent)가 있는 회원만. 결과는 저장하지 않는다 -- 강사가 고쳐 상담 메모로
 * 기기에 남긴다.
 */

const { redactText } = require("./privacy");

const text = (value) => String(value ?? "").trim();
const loadShared = () => import("../shared/consult-points.mjs");
const loadSummary = () => import("../shared/member-summary.mjs");

class ConsultPointsError extends Error {
  constructor(httpsCode, reason) {
    super(reason);
    this.httpsCode = httpsCode;
    this.reason = reason;
  }
}

/**
 * @param {{ firestore: any, getProvider: () => any, membershipId: (org: string, uid: string) => string, isOwnerLevel: (membership: any) => boolean }} deps
 */
function createConsultPointsService({ firestore, getProvider, membershipId, isOwnerLevel }) {
  async function generate({ callerUid, organizationId, clientId, goal = "", hasBeforeAfter = false }) {
    const shared = await loadShared();
    const summaryModule = await loadSummary();
    const org = text(organizationId);
    const client = text(clientId);
    if (!callerUid) throw new ConsultPointsError("unauthenticated", "unauthenticated");
    if (!org || !client || org.includes("/") || client.includes("/")) throw new ConsultPointsError("invalid-argument", "target_required");

    const [membershipSnapshot, switchSnapshot, clientSnapshot] = await Promise.all([
      firestore.collection("memberships").doc(membershipId(org, callerUid)).get(),
      firestore.doc("runtimeConfig/scheduleSync").get(),
      firestore.doc(`organizations/${org}/clients/${client}`).get(),
    ]);
    const membership = membershipSnapshot.exists ? membershipSnapshot.data() : null;
    if (!membership || membership.status !== "active") throw new ConsultPointsError("permission-denied", "not_member");
    if (!shared.consultPointsEnabledFor(switchSnapshot.exists ? switchSnapshot.data() : {}, callerUid)) throw new ConsultPointsError("failed-precondition", "feature_off");
    if (!clientSnapshot.exists) throw new ConsultPointsError("not-found", "client_missing");
    const clientData = clientSnapshot.data() || {};
    const assigned = Array.isArray(clientData.instructorIds) && clientData.instructorIds.includes(callerUid);
    if (!isOwnerLevel(membership) && !(["manager", "instructor"].includes(membership.role) && assigned)) throw new ConsultPointsError("permission-denied", "not_assigned");
    if (!summaryModule.memberAiConsentGranted(clientData)) throw new ConsultPointsError("failed-precondition", "consent_missing");

    const [recordsSnapshot, summarySnapshot] = await Promise.all([
      firestore.collection(`organizations/${org}/lessonRecords`).where("clientId", "==", client).get(),
      firestore.doc(`organizations/${org}/memberSummaries/${client}`).get(),
    ]);
    const rows = recordsSnapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
    const memberName = text(clientData.name);
    const { recent, input } = shared.buildConsultInput({
      goal: text(goal) || text(clientData.careNotes?.goal), hasBeforeAfter, records: rows,
      summary: summarySnapshot.exists ? summarySnapshot.data() : null,
      redact: (value) => redactText(value, memberName),
    });
    if (!recent.length) return { talkingPoints: [], dropped: {}, reason: "no_records", promptVersion: shared.CONSULT_POINTS_PROMPT_VERSION };

    const result = await getProvider().executeInternal({
      prompt: { instructions: shared.CONSULT_POINTS_INSTRUCTIONS, maxOutputTokens: 1200, promptVersion: shared.CONSULT_POINTS_PROMPT_VERSION },
      schema: shared.CONSULT_POINTS_SCHEMA,
      outputName: "consult_points",
      validate: shared.validateConsultShape,
      input,
    });
    const checked = shared.checkConsultPoints(result.output, recent);
    return {
      ...checked,
      promptVersion: shared.CONSULT_POINTS_PROMPT_VERSION,
      usage: { inputTokens: result.usage?.inputTokens || 0, outputTokens: result.usage?.outputTokens || 0 },
    };
  }
  return { generate };
}

module.exports = { createConsultPointsService, ConsultPointsError };
