"use strict";

/**
 * AI 회원 요약을 만들고 저장한다 (설계 문서 2단계). 규칙 · 검사는 shared/member-summary.mjs.
 *
 * organizations/{센터}/memberSummaries/{회원}: 화면이 읽는 단 하나의 문서. 쓰기는 서버만(규칙이 막는다).
 * 앞 판은 memberSummaries/{회원}/versions/{시각} 에 그대로 남는다.
 *
 * 흐름: 새 기록 → refresh. 같은 회원에 기록이 연달아 오면 한 번만 돈다 -- 도는 중이면 dirty 만 세우고 나가고,
 * 끝난 쪽이 dirty 를 보고 한 번 더 돈다. 실패하면 **앞 요약을 지우지 않는다**. 상태만 failed(코드).
 * 일시 오류(연결 · 시간 초과 · 서버 장애)만 15분 정리가 다시 부른다, 최대 3번 (CLAUDE.md §6).
 */

const { redactText } = require("./privacy");

const LOCK_MS = 3 * 60e3;
const MAX_RETRIES = 3;
const TRANSIENT = new Set(["timeout", "provider_unavailable", "provider_incomplete", "unavailable", "deadline-exceeded", "resource-exhausted", "aborted", "internal"]);

const text = (value) => String(value ?? "").trim();
const loadShared = () => import("../shared/member-summary.mjs");
const summaryPath = (organizationId, clientId) => `organizations/${organizationId}/memberSummaries/${clientId}`;

/**
 * @param {{ firestore: any, getProvider: () => any, now?: () => Date, log?: (level: string, event: string, fields: any) => void }} deps
 */
function createMemberSummaryService({ firestore, getProvider, now = () => new Date(), log = () => {} }) {
  async function readSwitch() {
    const snapshot = await firestore.doc("runtimeConfig/scheduleSync").get();
    return snapshot.exists ? snapshot.data() || {} : {};
  }

  /* 자리를 잡는다. 이미 누가 돌고 있으면 dirty 만 세우고 false. */
  async function claim(path) {
    const ref = firestore.doc(path);
    return firestore.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      const data = snapshot.exists ? snapshot.data() || {} : {};
      const at = now().getTime();
      if (Number(data.lockUntil || 0) > at) {
        tx.set(ref, { dirty: true }, { merge: true });
        return { claimed: false, data };
      }
      tx.set(ref, { lockUntil: at + LOCK_MS, dirty: false }, { merge: true });
      return { claimed: true, data };
    });
  }

  async function listRecords(organizationId, clientId) {
    const snapshot = await firestore.collection(`organizations/${organizationId}/lessonRecords`).where("clientId", "==", clientId).get();
    return snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
  }

  /**
   * 한 회원의 요약을 고쳐 쓴다.
   * @param {{ organizationId: string, clientId: string, triggerUid?: string, reason: "record"|"retry"|"rebuild", fromScratch?: boolean }} input
   * @returns {Promise<{ outcome: string, code?: string }>}
   */
  async function refresh({ organizationId, clientId, triggerUid = "", reason, fromScratch = false }, round = 0) {
    const shared = await loadShared();
    const org = text(organizationId);
    const client = text(clientId);
    if (!org || !client || org.includes("/") || client.includes("/")) return { outcome: "skipped", code: "invalid_target" };
    const fields = { feature: "member_summary", organizationId: org, correlationId: client.slice(-8), reason };

    /* 스위치는 기록을 쓴 강사 단위. 다시 만들기(대표)와 재시도는 이미 켜진 회원에서만 생기므로 스위치를 보지 않는다. */
    if (reason === "record" && !shared.memberSummaryEnabledFor(await readSwitch(), triggerUid)) return { outcome: "skipped", code: "feature_off" };

    const clientSnapshot = await firestore.doc(`organizations/${org}/clients/${client}`).get();
    if (!clientSnapshot.exists) return { outcome: "skipped", code: "client_missing" };
    const clientData = clientSnapshot.data() || {};
    if (!shared.memberAiConsentGranted(clientData)) {
      log("info", "member_summary_skipped", { ...fields, stage: "consent", errorCode: "consent_missing" });
      return { outcome: "skipped", code: "consent_missing" };
    }

    const path = summaryPath(org, client);
    const { claimed, data: current } = await claim(path);
    if (!claimed) return { outcome: "queued", code: "busy" };

    const startedAt = now();
    let stage = "read_records";
    try {
      const records = shared.recentRecords(await listRecords(org, client));
      if (!records.length) {
        await firestore.doc(path).set({ lockUntil: 0, status: "empty", statusCode: "no_records", updatedAt: startedAt }, { merge: true });
        return { outcome: "empty" };
      }
      const latestId = text(records[0].id);
      if (reason === "record" && !fromScratch && text(current.lastRecordId) === latestId && current.status === "ready") {
        await firestore.doc(path).set({ lockUntil: 0 }, { merge: true });
        return { outcome: "unchanged" };
      }
      const memberName = text(clientData.name);
      const redact = (value) => redactText(value, memberName);
      const input = shared.buildSummaryInput({ previousSummary: fromScratch ? null : current.summary, records, redact });
      stage = "provider";
      const result = await getProvider().executeInternal({
        prompt: { instructions: shared.MEMBER_SUMMARY_INSTRUCTIONS, maxOutputTokens: 2000, promptVersion: shared.MEMBER_SUMMARY_PROMPT_VERSION },
        schema: shared.MEMBER_SUMMARY_SCHEMA,
        outputName: "member_summary",
        validate: shared.validateSummaryShape,
        input,
      });
      stage = "check";
      const { summary, dropped } = shared.checkSummary(result.output, records);
      const droppedByReason = shared.droppedCounts(dropped);
      stage = "write";
      if (current.summary) {
        await firestore.doc(`${path}/versions/${startedAt.getTime()}`).set({
          summary: current.summary, promptVersion: text(current.promptVersion), generatedAt: current.generatedAt || null, lastRecordId: text(current.lastRecordId),
        });
      }
      await firestore.doc(path).set({
        organizationId: org, clientId: client,
        status: "ready", statusCode: "", summary,
        sourceRecordIds: records.map((record) => text(record.id)), lastRecordId: latestId,
        promptVersion: shared.MEMBER_SUMMARY_PROMPT_VERSION, model: text(result.model).slice(0, 60),
        dropped: droppedByReason, generatedAt: startedAt, updatedAt: startedAt,
        attempts: 0, retry: false, lockUntil: 0,
      }, { merge: true });
      log("info", "member_summary_done", {
        ...fields, stage: "done", records: records.length, dropped: dropped.length, droppedByReason,
        inputTokens: result.usage?.inputTokens || 0, outputTokens: result.usage?.outputTokens || 0, latencyMs: result.latencyMs || 0,
      });
    } catch (error) {
      const code = text(error?.code || error?.name || "unknown").slice(0, 60);
      const transient = TRANSIENT.has(code);
      const attempts = Number(current.attempts || 0) + 1;
      /* 앞 요약(summary)은 건드리지 않는다. 상태만. */
      await firestore.doc(path).set({
        organizationId: org, clientId: client,
        status: "failed", statusCode: code, lastError: { code, stage, transient, at: startedAt },
        attempts, retry: transient && attempts < MAX_RETRIES, updatedAt: startedAt, lockUntil: 0,
      }, { merge: true });
      log("warn", "member_summary_failed", {
        ...fields, stage, errorDomain: stage === "provider" ? "openai" : "firestore", errorCode: code, transient, attempts,
        providerRequestId: text(error?.diagnostic?.providerRequestId).slice(0, 160),
      });
      return { outcome: "failed", code };
    }

    /* 도는 동안 새 기록이 왔으면 한 번 더. */
    if (round < 1) {
      const after = await firestore.doc(path).get();
      if (after.exists && after.data()?.dirty === true) return refresh({ organizationId: org, clientId: client, triggerUid, reason: "retry" }, round + 1);
    }
    return { outcome: "ready" };
  }

  /** 15분 정리: 일시 오류로 실패한 것 · 도는 중 밀린 것. 센터마다 단일 조건 질의 (자동 색인). */
  async function sweep() {
    const organizations = await firestore.collection("organizations").get();
    const results = [];
    for (const organization of organizations.docs) {
      for (const field of ["retry", "dirty"]) {
        const snapshot = await firestore.collection(`organizations/${organization.id}/memberSummaries`).where(field, "==", true).limit(50).get();
        for (const document of snapshot.docs) {
          if (Number(document.data()?.lockUntil || 0) > now().getTime()) continue;
          results.push(await refresh({ organizationId: organization.id, clientId: document.id, reason: "retry" }));
        }
      }
    }
    return results;
  }

  return { refresh, sweep };
}

module.exports = { createMemberSummaryService, summaryPath, TRANSIENT_SUMMARY_CODES: TRANSIENT };
