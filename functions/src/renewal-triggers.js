"use strict";

/**
 * 재등록 후보 기록 (설계 문서 4단계). organizations/{센터}/renewalCandidates/{회원권} -- 서버만 쓴다(규칙).
 *
 * 지금 "만료 회원" 화면은 열 때마다 계산만 하고 아무것도 남기지 않는다. 그래서 "알림을 받은 회원 중 몇 명이
 * 재등록했나" 를 강사 · 지점 · 달로 낼 수 없다. 여기서 한 줄씩 남긴다:
 *  - 매일 밤: 쓰는 회원권이 알림 구간(잔여 30% 이하 · 만료 30일 안 · 다 못 씀)에 들어오면 후보 줄(대기)
 *  - 새 회원권이 나가면(트리거) · 매일 밤: 같은 회원에게 새 회원권 → 재등록, 끝나고 30일 지나도 없으면 → 끊김
 *  - 다시 채우기(대표): 이미 끝난 회원권을 원장으로 한 번 채워 넣는다 -- 오늘 이전 데이터도 집계에
 *
 * 계산은 shared/renewal-forecast.mjs 하나 -- 앱의 한 줄과 같은 계산이다. 이름 · 연락처는 쓰지 않는다.
 */

const text = (value) => String(value ?? "").trim();
const DAY_MS = 86400000;
const shared = () => import("../shared/renewal-forecast.mjs");
const scope = () => import("../shared/instructor-scope.mjs");

const candidatePath = (organizationId, passId) => `organizations/${organizationId}/renewalCandidates/${passId}`;

/**
 * @param {{ firestore: any, now?: () => Date, log?: (level: string, event: string, fields: any) => void }} deps
 */
function createRenewalService({ firestore, now = () => new Date(), log = () => {} }) {
  async function readPasses(organizationId) {
    const snapshot = await firestore.collection(`organizations/${organizationId}/passes`).get();
    return snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
  }
  async function readRecentEntries(organizationId, from) {
    const snapshot = await firestore.collectionGroup("ledger")
      .where("organizationId", "==", organizationId)
      .where("type", "in", ["deduct", "correction"])
      .where("occurredAt", ">=", from)
      .get();
    return snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
  }
  async function readCandidates(organizationId) {
    const snapshot = await firestore.collection(`organizations/${organizationId}/renewalCandidates`).get();
    return snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
  }

  const candidateRow = (pass, forecast, kind, at) => ({
    organizationId: text(pass.organizationId),
    passId: text(pass.id),
    clientId: text(pass.clientId),
    clientIds: Array.isArray(pass.clientIds) && pass.clientIds.length ? pass.clientIds.map(text) : [text(pass.clientId)],
    instructorId: text(pass.instructorId),
    locationId: text(pass.locationId),
    alert: kind,
    remaining: forecast ? forecast.remaining : null,
    enteredAt: at,
    expiresAt: pass.expiresAt || null,
    endedAt: null,
    status: "pending",
    source: "nightly",
  });

  /** 한 센터를 한 번 훑는다. */
  async function sweepOrganization(organizationId, { at = now() } = {}) {
    const forecastModule = await shared();
    const scopeModule = await scope();
    const [passes, entries, candidates] = await Promise.all([
      readPasses(organizationId),
      readRecentEntries(organizationId, new Date(at.getTime() - forecastModule.RENEWAL_WINDOW_DAYS * DAY_MS)),
      readCandidates(organizationId),
    ]);
    const byPass = new Map(candidates.map((row) => [row.id, row]));
    const counts = { created: 0, renewed: 0, lapsed: 0, ended: 0 };
    const writes = [];

    /* 1) 새로 알림 구간에 든 회원권. 회원 하나의 예상은 그 회원의 쓰는 회원권 전부로 낸다 -- 후보 줄은 지금 쓰는
          (가장 먼저 발급된) 회원권에 단다. 이미 줄이 있으면 두지 않는다. */
    const clientIds = [...new Set(passes.flatMap((pass) => (Array.isArray(pass.clientIds) && pass.clientIds.length ? pass.clientIds : [pass.clientId]).map(text)).filter(Boolean))];
    const seenPass = new Set();
    for (const clientId of clientIds) {
      const forecast = forecastModule.renewalForecast({ clientId, passes, entries, now: at });
      if (!forecastModule.isRenewalAlert(forecast)) continue;
      const passId = forecast.passIds.at(-1); // 마지막 장 -- 그 장이 끝나면 회원권이 다 끝난다
      if (!passId || seenPass.has(passId) || byPass.has(passId)) continue;
      seenPass.add(passId);
      const pass = passes.find((item) => item.id === passId);
      writes.push({ path: candidatePath(organizationId, passId), data: { ...candidateRow({ ...pass, organizationId }, forecast, forecast.alert, at) }, merge: false });
      counts.created += 1;
    }

    /* 2) 대기 중인 줄: 끝났는지 · 재등록했는지 · 끊겼는지. */
    for (const row of candidates.filter((item) => item.status === "pending")) {
      const pass = passes.find((item) => item.id === row.id);
      let endedAt = row.endedAt || null;
      if (!endedAt && pass && !scopeModule.isLivePass(pass, at)) {
        endedAt = pass.status === "cancelled" ? at : (Number(pass.remainingCount) <= 0 ? at : pass.expiresAt || at);
        counts.ended += 1;
      }
      const outcome = forecastModule.candidateOutcome({ ...row, endedAt }, passes, at);
      if (outcome.status === "pending" && endedAt === (row.endedAt || null)) continue;
      const patch = { endedAt, status: outcome.status, updatedAt: at };
      if (outcome.status !== "pending") {
        patch.decidedAt = new Date(outcome.decidedAt);
        if (outcome.renewedPassId) { patch.renewedPassId = outcome.renewedPassId; patch.renewedInstructorId = outcome.renewedInstructorId; }
        counts[outcome.status] += 1;
      }
      writes.push({ path: candidatePath(organizationId, row.id), data: patch, merge: true });
    }

    for (let index = 0; index < writes.length; index += 400) {
      const batch = firestore.batch();
      for (const write of writes.slice(index, index + 400)) batch.set(firestore.doc(write.path), write.data, write.merge ? { merge: true } : {});
      await batch.commit();
    }
    return counts;
  }

  /** 새 회원권이 나가면 그 회원의 대기 줄을 재등록으로. */
  async function onPassCreated(organizationId, pass, at = now()) {
    const forecastModule = await shared();
    const ids = (Array.isArray(pass?.clientIds) && pass.clientIds.length ? pass.clientIds : [pass?.clientId]).map(text).filter(Boolean);
    if (!ids.length) return 0;
    /* 조건 하나만 건다 (array-contains-any 에 다른 조건을 더하면 복합 색인이 필요하다). 대기만 메모리에서 거른다. */
    const snapshot = await firestore.collection(`organizations/${organizationId}/renewalCandidates`)
      .where("clientIds", "array-contains-any", ids.slice(0, 10)).get();
    let renewed = 0;
    for (const document of snapshot.docs) {
      const row = { id: document.id, ...document.data() };
      if (row.status !== forecastModule.CANDIDATE_STATUS.PENDING) continue;
      const outcome = forecastModule.candidateOutcome(row, [pass], at);
      if (outcome.status !== forecastModule.CANDIDATE_STATUS.RENEWED) continue;
      await document.ref.set({ status: outcome.status, decidedAt: new Date(outcome.decidedAt), renewedPassId: outcome.renewedPassId, renewedInstructorId: outcome.renewedInstructorId, updatedAt: at }, { merge: true });
      renewed += 1;
    }
    if (renewed) log("info", "renewal_candidate_renewed", { feature: "renewal_alerts", stage: "pass_created", organizationId, count: renewed });
    return renewed;
  }

  /**
   * 다시 채우기: 지난 months 달 동안 끝난 회원권을 후보 줄로 (이미 있는 줄은 두지 않음). 소진일은 원장의 마지막 차감.
   * 결과는 "만료 회원" 화면과 같은 기준(만료 뒤 30일 안 새 회원권 = 재등록)이다.
   */
  async function backfill(organizationId, { months = 6, at = now() } = {}) {
    const forecastModule = await shared();
    const scopeModule = await scope();
    const since = new Date(at.getTime() - months * 31 * DAY_MS);
    const [passes, candidates, deductSnapshot] = await Promise.all([
      readPasses(organizationId),
      readCandidates(organizationId),
      firestore.collectionGroup("ledger").where("organizationId", "==", organizationId).where("type", "==", "deduct").where("occurredAt", ">=", since).get(),
    ]);
    const lastDeducted = new Map();
    for (const document of deductSnapshot.docs) {
      const entry = document.data();
      const t = forecastModule.timeOf(entry.occurredAt);
      if (Number.isFinite(t) && t > (lastDeducted.get(entry.passId) || 0)) lastDeducted.set(entry.passId, t);
    }
    const existing = new Set(candidates.map((row) => row.id));
    const writes = [];
    for (const pass of passes) {
      if (existing.has(pass.id) || pass.status === "cancelled") continue;
      const expiry = scopeModule.passExpiry(pass, { now: at, lastDeductedAt: lastDeducted.has(pass.id) ? new Date(lastDeducted.get(pass.id)) : null });
      if (expiry.live || !expiry.at || expiry.at < since) continue;
      const row = {
        ...candidateRow({ ...pass, organizationId }, null, expiry.reason === "used_up" ? "backfill_used_up" : "backfill_date_passed", expiry.at),
        endedAt: expiry.at, source: "backfill",
      };
      const outcome = forecastModule.candidateOutcome(row, passes, at);
      writes.push({ path: candidatePath(organizationId, pass.id), data: { ...row, status: outcome.status, ...(outcome.decidedAt ? { decidedAt: new Date(outcome.decidedAt) } : {}), ...(outcome.renewedPassId ? { renewedPassId: outcome.renewedPassId, renewedInstructorId: outcome.renewedInstructorId } : {}) } });
    }
    for (let index = 0; index < writes.length; index += 400) {
      const batch = firestore.batch();
      for (const write of writes.slice(index, index + 400)) batch.set(firestore.doc(write.path), write.data);
      await batch.commit();
    }
    const counts = writes.reduce((all, write) => ({ ...all, [write.data.status]: (all[write.data.status] || 0) + 1 }), {});
    return { written: writes.length, counts };
  }

  return { sweepOrganization, onPassCreated, backfill };
}

module.exports = { createRenewalService, candidatePath };
