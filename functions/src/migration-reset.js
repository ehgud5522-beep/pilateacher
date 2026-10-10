"use strict";

/**
 * 이관 데이터 초기화 — **출시 전 한 번 쓰는 통로다.**
 *
 * 10/1 에 새 엑셀로 다시 이관한다. 옛 엑셀로 만든 것을 지우지 않으면 같은
 * 회원에게 회원권이 두 벌 생기고, 잔여도 급여 근거도 두 배로 읽힌다.
 *
 * ── 왜 규칙이 아니라 서버인가 ──
 * 규칙에는 `allow delete: if false` 가 열두 군데 있다. 클라이언트에서 지우려면
 * passes · ledger · clients · instructorClientTotals · memberViews 다섯 곳에
 * 구멍을 내야 하고, **한 번 쓰는 기능을 위해 영구적인 문 다섯 개**를 내는
 * 일이 된다.
 *
 * Admin SDK 는 규칙을 우회한다. 그래서 규칙은 계속 "아무도 원장을 못 지운다"
 * 고 말하고, 그 예외는 대표가 부르는 이 함수 하나다. 예외를 문이 아니라
 * 통로로 둔다.
 *
 * ── 무엇을 지우는가 ──
 * 엑셀 이관이 만든 것만이다. id 접두 `csv_` 가 그 표시다
 * (migration-repository.js: 회원 `csv_<번호>`, 회원권 `csv_<clientId>_<차수>`).
 *
 *   지운다 : passes/csv_* · 그 원장 전부 · instructorClientTotals ·
 *            memberViews · 조건을 만족하는 clients/csv_*
 *   남긴다 : 앱에서 발급한 회원권 · 강사 · 지점 · 상품 · lessonNotes ·
 *            감사 로그
 *
 * ── 회원을 접두만으로 지우지 않는다 ──
 * 이관 코드는 지금 **번호로 먼저 찾고 없을 때만** 만든다. 그래서 `csv_` 회원
 * 중에는 이관 후 앱에서 쌓인 것이 붙은 사람이 있다 -- 앱에서 발급한 회원권,
 * 회원 앱 연결, 앱에서 바꾼 번호 이력. 접두만 보고 지우면 **그 사람의 신원은
 * 사라지고 수업 기록은 남는다.** 고아가 된 기록은 되돌릴 수 없다.
 *
 * 그래서 셋 중 하나라도 있으면 지우지 않고 목록에 올린다. 남긴 회원은 새
 * 엑셀이 번호로 찾아 이어 붙인다 -- 그것이 지금 이관 코드가 하는 일이다.
 *
 * ── lessonNotes 는 건드리지 않는다 ──
 * 그 문서는 `${lessonId}_${clientId}` 라 passId 를 모른다. 강사가 회원에게
 * 적은 말이고, 회원권이 사라졌다고 그 말이 틀린 말이 되는 것은 아니다.
 * 회원 앱 이력에서는 안 보이게 된다 -- 이력이 원장에서 만들어지기 때문이고,
 * 9월 기록을 지우기로 한 것이 그 뜻이다.
 *
 * ── 기기는 이 함수가 못 닿는다 ──
 * 강사 기기의 일정에는 확정 표시(orgPassId · orgEntryId)가 남는다. 되돌리기는
 * 없는 회원권을 `pass_missing` 으로 보고하고 멈추므로 **깨지지는 않지만**,
 * 9월 수업이 영영 "확정됨" 으로 남는다. 그 정리는 앱이 한다
 * (clearSettlementFromLesson).
 */

const MIGRATED_PREFIX = "csv_";
const SNAPSHOT_PREFIX = "migration-reset";
/* 한 배치의 한계는 500 이다. 넉넉히 아래로 잡는다 -- 한 문서가 두 쓰기를
   차지하는 경우가 생기면 500 에 딱 맞춘 배치가 터진다. */
const BATCH_LIMIT = 400;

const text = (value) => String(value ?? "").trim();
const isMigrated = (id) => text(id).startsWith(MIGRATED_PREFIX);

/** 초기화를 멈춰야 하는 이유. 코드 없는 "할 수 없습니다" 를 남기지 않는다. */
const BLOCK_REASON = Object.freeze({
  MEMBER_LINK: "member_link",
  APP_ISSUED_PASS: "app_issued_pass",
  PHONE_CHANGED: "phone_changed",
});

/**
 * 무엇을 지울지 센다. **아무것도 쓰지 않는다.**
 *
 * @param {any} firestore
 * @param {{ organizationId: string }} input
 */
async function planMigrationReset(firestore, { organizationId }) {
  const org = firestore.collection("organizations").doc(text(organizationId));

  const [passes, clients, totals, views, links] = await Promise.all([
    org.collection("passes").get(),
    org.collection("clients").get(),
    org.collection("instructorClientTotals").get(),
    org.collection("memberViews").get(),
    firestore.collection("memberLinks").get(),
  ]);

  const migratedPasses = passes.docs.filter((snapshot) => isMigrated(snapshot.id));
  const appPassClientIds = new Set();
  for (const snapshot of passes.docs) {
    if (isMigrated(snapshot.id)) continue;
    const data = snapshot.data() || {};
    for (const clientId of [data.clientId, ...(Array.isArray(data.clientIds) ? data.clientIds : [])]) {
      if (text(clientId)) appPassClientIds.add(text(clientId));
    }
  }

  /* 회원 앱에 이어진 회원. 지시받은 대로 멈추고 목록에 올린다 -- 그 사람의
     clientId 를 지우면 회원 앱이 자기 것을 영영 못 찾는다. */
  const linkedClientIds = new Set();
  for (const snapshot of links.docs) {
    for (const link of Array.isArray(snapshot.data()?.links) ? snapshot.data().links : []) {
      if (text(link?.organizationId) === text(organizationId) && text(link?.clientId)) {
        linkedClientIds.add(text(link.clientId));
      }
    }
  }

  const clientsToDelete = [];
  const blockedClients = [];
  for (const snapshot of clients.docs) {
    if (!isMigrated(snapshot.id)) continue;
    const data = snapshot.data() || {};
    const reasons = [];
    if (linkedClientIds.has(snapshot.id)) reasons.push(BLOCK_REASON.MEMBER_LINK);
    if (appPassClientIds.has(snapshot.id)) reasons.push(BLOCK_REASON.APP_ISSUED_PASS);
    if (Array.isArray(data.previousPhones) && data.previousPhones.length > 0) {
      reasons.push(BLOCK_REASON.PHONE_CHANGED);
    }
    if (reasons.length) blockedClients.push({ clientId: snapshot.id, name: text(data.name), reasons });
    else clientsToDelete.push(snapshot.id);
  }

  /* 원장은 회원권마다 하위 컬렉션이다. 세려면 읽어야 하고, 지울 때 다시
     읽지 않도록 경로를 그대로 들고 간다. */
  const ledgerPaths = [];
  for (const snapshot of migratedPasses) {
    const entries = await snapshot.ref.collection("ledger").get();
    for (const entry of entries.docs) ledgerPaths.push(entry.ref.path);
  }

  return {
    organizationId: text(organizationId),
    passIds: migratedPasses.map((snapshot) => snapshot.id),
    ledgerPaths,
    clientIds: clientsToDelete,
    totalIds: totals.docs.map((snapshot) => snapshot.id),
    viewIds: views.docs.map((snapshot) => snapshot.id),
    blockedClients,
    /* 앱에서 발급한 회원권은 손대지 않는다. 몇 장이 남는지 미리 보여준다 --
       0 이면 대표가 "전부 지워진다" 를 알고 누른다. */
    keptPasses: passes.docs.length - migratedPasses.length,
    counts: {
      passes: migratedPasses.length,
      ledger: ledgerPaths.length,
      clients: clientsToDelete.length,
      instructorClientTotals: totals.docs.length,
      memberViews: views.docs.length,
      blockedClients: blockedClients.length,
      keptPasses: passes.docs.length - migratedPasses.length,
    },
  };
}

/** 사본. 지우기 전에 한 벌 남긴다 -- 원장은 되돌릴 자리가 없다. */
async function writeSnapshot(firestore, bucket, plan, { actorId, at }) {
  const org = firestore.collection("organizations").doc(plan.organizationId);
  const body = { organizationId: plan.organizationId, actorId, at: at.toISOString(), passes: [], clients: [] };

  for (const passId of plan.passIds) {
    const [pass, entries] = await Promise.all([
      org.collection("passes").doc(passId).get(),
      org.collection("passes").doc(passId).collection("ledger").get(),
    ]);
    body.passes.push({
      id: passId,
      data: pass.exists ? pass.data() : null,
      ledger: entries.docs.map((snapshot) => ({ id: snapshot.id, data: snapshot.data() })),
    });
  }
  for (const clientId of plan.clientIds) {
    const client = await org.collection("clients").doc(clientId).get();
    body.clients.push({ id: clientId, data: client.exists ? client.data() : null });
  }

  /* Firestore 문서가 아니라 Storage 다. 회원권 수백 건 + 원장 전부는 1MB
     문서 한계를 넘는다. 경로는 대표만 읽는 자리다 (storage.rules). */
  const name = `${SNAPSHOT_PREFIX}/${plan.organizationId}/${at.toISOString().replaceAll(":", "-")}.json`;
  const file = bucket.file(name);
  await file.save(JSON.stringify(body), { contentType: "application/json", resumable: false });
  return { path: name, passes: body.passes.length, clients: body.clients.length };
}

/** 경로 목록을 배치로 지운다. */
async function deletePaths(firestore, paths) {
  let removed = 0;
  for (let index = 0; index < paths.length; index += BATCH_LIMIT) {
    const batch = firestore.batch();
    for (const path of paths.slice(index, index + BATCH_LIMIT)) batch.delete(firestore.doc(path));
    await batch.commit();
    removed += Math.min(BATCH_LIMIT, paths.length - index);
  }
  return removed;
}

/**
 * 실제로 지운다. 사본을 먼저 남기고, 남기지 못하면 아무것도 지우지 않는다.
 *
 * @param {any} firestore
 * @param {any} bucket
 * @param {{ organizationId: string, actorId: string, now?: () => Date }} input
 */
async function runMigrationReset(firestore, bucket, { organizationId, actorId, now = () => new Date() }) {
  const at = now();
  const plan = await planMigrationReset(firestore, { organizationId });

  /* 사본이 실패하면 지우지 않는다. 되돌릴 자리 없이 원장을 지우는 것은
     이 기능이 가장 하지 말아야 하는 일이다. */
  const snapshot = await writeSnapshot(firestore, bucket, plan, { actorId, at });

  const org = `organizations/${plan.organizationId}`;
  const removed = {
    ledger: await deletePaths(firestore, plan.ledgerPaths),
    passes: await deletePaths(firestore, plan.passIds.map((id) => `${org}/passes/${id}`)),
    instructorClientTotals: await deletePaths(firestore, plan.totalIds.map((id) => `${org}/instructorClientTotals/${id}`)),
    memberViews: await deletePaths(firestore, plan.viewIds.map((id) => `${org}/memberViews/${id}`)),
    clients: await deletePaths(firestore, plan.clientIds.map((id) => `${org}/clients/${id}`)),
  };

  /* 감사 로그 한 줄. 이 통로가 열렸다는 사실은 남아야 한다 -- 원장을 지운
     유일한 경우이고, 반년 뒤 "9월이 왜 비었나" 를 묻는 사람에게 답이 된다.
     이름은 적지 않는다 (§7). */
  await firestore.collection("auditLogs").doc().set({
    organizationId: plan.organizationId,
    actorId: text(actorId),
    actorRole: "owner",
    action: "migration_reset",
    createdAt: at,
    clientId: "",
    targetId: snapshot.path,
  });

  return { ...removed, snapshot, blockedClients: plan.blockedClients, keptPasses: plan.keptPasses };
}

module.exports = {
  BLOCK_REASON,
  MIGRATED_PREFIX,
  planMigrationReset,
  runMigrationReset,
};
