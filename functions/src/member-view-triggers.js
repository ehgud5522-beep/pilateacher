"use strict";

/**
 * 회원용 투영을 다시 만드는 트리거.
 *
 * ── 사후 처리다 ──
 * 강사가 차감을 누르면 그 배치는 이미 커밋된 뒤에 이 코드가 불린다. 그래서
 * 여기서 무엇이 실패하든 **회차는 줄어들고 발급은 나간다.** 투영이 잠깐
 * 뒤처질 뿐이고, 다음 쓰기나 백필이 채운다.
 *
 * ── 왜 passes 와 clients 둘만인가 ──
 * 원장에 쓰는 다섯 함수가 전부 같은 배치에서 passes 문서도 쓴다 --
 * issuePass · deductPass · correctDeduction · cancelPass ·
 * transferPassInstructor. 그래서 passes 트리거 하나가 원장 변화까지 다 잡는다.
 * ledger 에도 트리거를 달면 같은 일을 두 번 하고 비용이 두 배가 된다.
 *
 * clients 는 따로 필요하다. 연결(linkMemberAccount)이 userId 를 채우는 순간과
 * 이름·상태가 바뀌는 순간은 회원권을 건드리지 않는다.
 *
 * ── 순서가 뒤집혀도 옛 값으로 덮이지 않는다 ──
 * 같은 회원에 쓰기가 몰리면 호출 둘이 겹칠 수 있다. A 가 먼저 읽고, B 가 나중에
 * 읽어 먼저 쓰고, 그 뒤에 A 가 쓰면 옛 값이 남는다.
 *
 * 그래서 투영에 sourceEventAt 을 두고 트랜잭션 안에서 견준다. 자기 event.time
 * 이 이미 있는 값보다 오래됐으면 쓰지 않는다. 같은 배치에서 온 호출들은
 * event.time 이 같고 둘 다 커밋 뒤에 읽으므로 어느 쪽이 이겨도 값이 같다.
 *
 * ── 투영은 한 곳에서만 만들어진다 ──
 * 필드를 고르는 일은 buildMemberView 만 한다 (member-view.js). 여기서는 읽어
 * 오고 넘기고 쓰기만 한다 -- 그 함수가 개인정보의 유일한 관문이라는 말이
 * 참이려면 이 파일이 지름길을 내면 안 된다.
 */

const { buildMemberView } = require("./member-view");

/** 회원권 하나의 원장을 얼마나 읽을 것인가. 읽기 비용의 대부분이 여기다. */
const LEDGER_LIMIT_PER_PASS = 60;

/** 투영에 담을 이력의 최대 건수. 문서가 무한히 자라지 않게. */
const HISTORY_LIMIT = 100;

const text = (value) => String(value ?? "").trim();

/**
 * 이 회원권 변화가 어느 회원의 투영을 건드리는가.
 *
 * before 와 after 를 모두 본다. 회원권이 지워지거나(지금은 규칙이 막지만)
 * 담당이 바뀌어도 before 쪽 회원의 투영은 다시 만들어져야 한다.
 *
 * @param {any} before @param {any} after
 * @returns {Array<string>}
 */
function clientIdsFromPassChange(before, after) {
  const found = new Set();
  for (const snapshot of [before, after]) {
    if (!snapshot) continue;
    const anchor = text(snapshot.clientId);
    if (anchor) found.add(anchor);
    const listed = Array.isArray(snapshot.clientIds) ? snapshot.clientIds : [];
    for (const id of listed) if (text(id)) found.add(text(id));
  }
  return [...found];
}

/**
 * 투영을 만드는 데 필요한 것을 전부 읽어 온다.
 *
 * @param {any} db Firestore (Admin SDK)
 * @param {string} organizationId @param {string} clientId
 */
async function collectMemberViewInput(db, organizationId, clientId) {
  const org = db.collection("organizations").doc(organizationId);

  const clientSnapshot = await org.collection("clients").doc(clientId).get();
  if (!clientSnapshot.exists) return null;
  const client = { id: clientSnapshot.id, ...clientSnapshot.data() };

  /* 회원권은 두 번 묻는다. 옛 회원권에는 clientIds 가 없고 clientId 하나뿐이라,
     array-contains 만으로는 이관분과 듀엣 이전 발급분이 통째로 빠진다.
     둘 다 단일 조건이라 자동 인덱스로 처리된다 -- 새 색인이 필요 없다. */
  const [byAnchor, byList] = await Promise.all([
    org.collection("passes").where("clientId", "==", clientId).get(),
    org.collection("passes").where("clientIds", "array-contains", clientId).get(),
  ]);
  const passById = new Map();
  for (const snapshot of [...byAnchor.docs, ...byList.docs]) {
    passById.set(snapshot.id, { id: snapshot.id, ...snapshot.data() });
  }
  const passes = [...passById.values()];

  /* 원장은 회원권마다 하위 컬렉션을 읽는다. 그룹 질의를 쓰면 organizationId 와
     clientId 두 동등 조건이라 복합 인덱스가 필요해진다 -- 회원권이 보통 한둘
     이라 이쪽이 싸고 색인도 늘지 않는다.

     최근 것부터 상한을 둔다. 회원 화면의 수업 이력은 최근이 중요하고, 오래된
     회차까지 매번 읽으면 그것이 비용의 대부분이 된다. */
  const ledgerPages = await Promise.all(passes.map((pass) => (
    org.collection("passes").doc(pass.id).collection("ledger")
      .orderBy("occurredAt", "desc").limit(LEDGER_LIMIT_PER_PASS).get()
  )));
  const ledger = ledgerPages.flatMap((page) => page.docs.map((snapshot) => ({
    id: snapshot.id, ...snapshot.data(),
  })));

  /* 지점 이름과 강사 이름. 못 읽어도 투영은 만든다 -- 이름이 비는 것이 잔여가
     안 보이는 것보다 낫다. */
  const locationId = text(client.locationId);
  const [locationSnapshot, membershipPage] = await Promise.all([
    locationId ? org.collection("locations").doc(locationId).get() : Promise.resolve(null),
    db.collection("memberships").where("organizationId", "==", organizationId).get(),
  ]);
  const instructorNames = {};
  for (const snapshot of membershipPage.docs) {
    const data = snapshot.data() || {};
    if (text(data.userId)) instructorNames[text(data.userId)] = text(data.displayName);
  }

  /* 듀엣 상대의 이름. 이 회원의 회원권에 함께 적힌 사람만 읽는다 -- 명부 전체를
     읽을 이유가 없다. */
  const partnerIds = new Set();
  for (const pass of passes) {
    for (const id of Array.isArray(pass.clientIds) ? pass.clientIds : []) {
      if (text(id) && text(id) !== clientId) partnerIds.add(text(id));
    }
  }
  const partnerSnapshots = await Promise.all(
    [...partnerIds].map((id) => org.collection("clients").doc(id).get()),
  );
  const clientNames = { [clientId]: text(client.name) };
  for (const snapshot of partnerSnapshots) {
    if (snapshot.exists) clientNames[snapshot.id] = text(snapshot.data()?.name);
  }

  /* 여정의 "앱 이전" 구간이 쓰는 누적. 지금 쓸 수 있는 회원권의 담당 강사
     기준이다 -- 담당이 여럿이면 가장 최근 것을 쓴다. */
  const activePass = passes.find((pass) => text(pass.status) === "active") || passes[0] || null;
  const instructorId = text(activePass?.instructorId);
  let instructorSessions = 0;
  if (instructorId) {
    const totalSnapshot = await org.collection("instructorClientTotals")
      .doc(`${instructorId}_${clientId}`).get();
    instructorSessions = Number(totalSnapshot.data()?.sessions) || 0;
  }

  return {
    client,
    passes,
    ledger,
    locationName: text(locationSnapshot?.data()?.name),
    instructorNames,
    clientNames,
    instructorSessions,
  };
}

/**
 * 투영 하나를 다시 만들어 쓴다.
 *
 * @param {any} db
 * @param {{ organizationId: string, clientId: string, eventAt: Date, buildJourney?: any, now?: () => Date }} input
 * @returns {Promise<"written" | "skipped" | "no_client">}
 */
async function rebuildMemberView(db, input) {
  const organizationId = text(input?.organizationId);
  const clientId = text(input?.clientId);
  if (!organizationId || !clientId) return "no_client";

  const collected = await collectMemberViewInput(db, organizationId, clientId);
  /* 회원 문서가 없으면 투영도 없다. 지우지는 않는다 -- 규칙이 삭제를 막고 있고,
     회원 삭제는 지금 어느 화면에도 없다. */
  if (!collected) return "no_client";

  const view = buildMemberView({
    ...collected,
    buildJourney: input?.buildJourney || null,
    now: typeof input?.now === "function" ? input.now() : new Date(),
  });
  if (!view) return "no_client";
  if (Array.isArray(view.history) && view.history.length > HISTORY_LIMIT) {
    view.history = view.history.slice(0, HISTORY_LIMIT);
  }

  const eventAt = input?.eventAt instanceof Date ? input.eventAt : new Date();
  const ref = db.collection("organizations").doc(organizationId)
    .collection("memberViews").doc(clientId);

  return db.runTransaction(async (transaction) => {
    const current = await transaction.get(ref);
    /* 이미 더 새로운 쓰기가 다녀갔으면 손대지 않는다. 늦게 도착한 호출이 옛
       값으로 덮는 것을 막는 유일한 장치다. */
    const seen = current.exists ? current.data()?.sourceEventAt : null;
    const seenAt = seen?.toDate ? seen.toDate() : seen instanceof Date ? seen : null;
    if (seenAt && seenAt.getTime() >= eventAt.getTime()) return "skipped";
    transaction.set(ref, { ...view, sourceEventAt: eventAt });
    return "written";
  });
}

/**
 * 여러 회원을 다시 만든다. 하나가 실패해도 나머지는 계속한다.
 *
 * 듀엣에서 한쪽 실패가 다른 쪽을 막으면 안 된다. 그리고 트리거 전체를 던지게
 * 두면 그 호출이 재시도되거나(끄지 않았다면) 로그에 원인 하나만 남는다 --
 * 회원마다 따로 적어야 어느 투영이 뒤처졌는지 안다.
 *
 * @param {any} db
 * @param {{ organizationId: string, clientIds: Array<string>, eventAt: Date, buildJourney?: any, log?: any }} input
 */
async function rebuildMemberViews(db, input) {
  const results = [];
  for (const clientId of input?.clientIds || []) {
    try {
      const outcome = await rebuildMemberView(db, {
        organizationId: input.organizationId,
        clientId,
        eventAt: input.eventAt,
        buildJourney: input.buildJourney,
      });
      results.push({ clientId, outcome });
    } catch (error) {
      results.push({ clientId, outcome: "failed", code: error?.code || "member_view_rebuild_failed" });
      input?.log?.error?.("member_view_rebuild_failed", {
        feature: "member_view",
        stage: "rebuild",
        errorDomain: "firestore",
        // 원본 코드를 그대로 남긴다 -- 정규화하면 원인 확정이 불가능해진다.
        errorCode: error?.code || "unknown",
        message: String(error?.message || error).slice(0, 300),
        organizationId: input.organizationId,
        clientId,
      });
    }
  }
  return results;
}

module.exports = {
  HISTORY_LIMIT,
  LEDGER_LIMIT_PER_PASS,
  clientIdsFromPassChange,
  collectMemberViewInput,
  rebuildMemberView,
  rebuildMemberViews,
};
