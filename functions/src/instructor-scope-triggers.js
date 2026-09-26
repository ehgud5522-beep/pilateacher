/**
 * clients.instructorIds 를 채운다. **이 배열이 곧 "누가 이 회원을 보는가" 다.**
 *
 * ── 왜 파생값을 따로 두는가 ──
 * 강사가 보는 회원을 규칙으로 막으려면 규칙이 읽을 수 있는 자리에 답이 있어야
 * 한다. 규칙은 회원권을 훑어 담당 강사를 모을 수 없다 -- get() 한 번에 문서
 * 하나뿐이고, 회원권은 몇 장인지 모른다. 그래서 답을 회원 문서에 적어 둔다.
 *
 * 판정은 functions/shared/instructor-scope.mjs 에 있다. 앱도 같은 파일을 쓴다.
 *
 * ── 언제 어긋나는가 ──
 * 회원권이 **날짜만 지나 만료되는 순간에는 아무도 쓰지 않는다.** 그래서 A 와 B
 * 의 회원권을 함께 쓰던 회원이 A 의 것만 만료되면, 다음 쓰기가 있기 전까지
 * instructorIds 에 A 가 남는다.
 *
 * 이 어긋남은 **한쪽으로만 생긴다** -- 강사가 예정보다 조금 더 오래 보는 것이지,
 * 봐야 할 회원을 못 보는 일은 없다. 차감이 회원권을 쓰므로 다니는 회원은 계속
 * 갱신되고, 아무 일도 없는 회원은 "마지막 회원권의 담당" 이 어차피 같은 답을
 * 낸다. 완전히 맞추려면 rebuildInstructorIds 를 주기적으로 돌리면 된다.
 *
 * 자세한 배경은 docs/instructor-scope-plan.md.
 */

/* 판정은 functions/shared 에 ESM 으로 있다 (앱과 같은 한 벌을 쓰기 위해서다).
   이 파일은 CommonJS 라 require 할 수 없어 동적 import 로 읽는다 -- Node 가
   모듈을 캐시하므로 인스턴스당 한 번이다. member-link.js 와 같은 방식이다. */
let scopeModule = null;
async function loadInstructorIdsFor() {
  if (!scopeModule) scopeModule = await import("../shared/instructor-scope.mjs");
  return scopeModule.instructorIdsFor;
}

const text = (value) => String(value ?? "").trim();

/**
 * 이 회원권 변경이 어느 회원의 목록을 흔드는가.
 *
 * 전후를 모두 본다. 인수인계는 담당만 바뀌므로 회원은 그대로지만, 듀엣에서
 * 한 명이 빠지면 **빠진 사람의** 목록도 다시 세어야 한다 -- after 만 보면
 * 그 사람은 옛 담당을 그대로 달고 남는다.
 */
function clientIdsFromPassChange(before, after) {
  const ids = new Set();
  for (const snapshot of [before, after]) {
    if (!snapshot) continue;
    const anchor = text(snapshot.clientId);
    if (anchor) ids.add(anchor);
    const listed = Array.isArray(snapshot.clientIds) ? snapshot.clientIds : [];
    for (const id of listed) {
      const clientId = text(id);
      if (clientId) ids.add(clientId);
    }
  }
  return [...ids];
}

/** 이 회원이 낀 회원권 전부. member-view-triggers 와 같은 두 번의 질의다. */
async function passesForClient(org, clientId) {
  /* 옛 회원권에는 clientIds 가 없고 clientId 하나뿐이라, array-contains 만으로는
     이관분과 듀엣 이전 발급분이 통째로 빠진다. 둘 다 단일 조건이라 자동
     인덱스로 처리된다 -- 새 색인이 필요 없다. */
  const [byAnchor, byList] = await Promise.all([
    org.collection("passes").where("clientId", "==", clientId).get(),
    org.collection("passes").where("clientIds", "array-contains", clientId).get(),
  ]);
  const passById = new Map();
  for (const snapshot of [...byAnchor.docs, ...byList.docs]) {
    passById.set(snapshot.id, { id: snapshot.id, ...snapshot.data() });
  }
  return [...passById.values()];
}

const same = (left, right) => left.length === right.length
  && left.every((value, index) => value === right[index]);

/**
 * 한 회원의 instructorIds 를 다시 세어 필요할 때만 쓴다.
 *
 * @returns {Promise<"unchanged"|"updated"|"missing">}
 */
async function syncOneClient(db, { organizationId, clientId, now, dryRun = false }) {
  const org = db.collection("organizations").doc(organizationId);
  const clientRef = org.collection("clients").doc(clientId);
  const clientSnapshot = await clientRef.get();
  if (!clientSnapshot.exists) return "missing";

  const passes = await passesForClient(org, clientId);
  const instructorIdsFor = await loadInstructorIdsFor();
  const next = instructorIdsFor(passes, { now });
  const current = Array.isArray(clientSnapshot.data()?.instructorIds)
    ? clientSnapshot.data().instructorIds.map(text).filter(Boolean)
    : [];

  /* 같으면 쓰지 않는다. 회원 문서를 건드리면 memberViews 트리거가 함께 깨어나
     투영을 다시 만든다 -- 아무것도 바뀌지 않은 쓰기 하나가 그 뒤를 전부
     불러오는 셈이고, 차감 한 번에 이 트리거가 회원 수만큼 돈다. */
  if (same(current, next)) return "unchanged";

  /* 미리보기는 세기만 한다. 대표가 "몇 명 바뀌는지" 를 보고 누르기 전에는
     아무것도 쓰지 않는다 -- 눌러 보고 되돌리는 문이 없기 때문이다. */
  if (dryRun) return "would_update";

  await clientRef.set({ instructorIds: next }, { merge: true });
  return "updated";
}

/**
 * 여러 회원의 instructorIds 를 맞춘다.
 *
 * 한 회원이 실패해도 나머지는 계속한다. 회원권 하나가 두 사람을 가리키는데
 * 앞사람에서 멈추면 뒷사람은 영영 갱신되지 않는다.
 *
 * @param {any} db @param {{ organizationId: string, clientIds: Array<string>,
 *   now?: Date, log?: any }} input
 */
async function syncInstructorIds(db, input) {
  const organizationId = text(input?.organizationId);
  const now = input?.now instanceof Date ? input.now : new Date();
  const results = [];
  for (const raw of input?.clientIds || []) {
    const clientId = text(raw);
    if (!clientId) continue;
    try {
      results.push({
        clientId,
        outcome: await syncOneClient(db, { organizationId, clientId, now, dryRun: input?.dryRun === true }),
      });
    } catch (error) {
      /* 회원 id 는 남기지 않는다. 무엇이 왜 실패했는지만 남긴다. */
      input?.log?.error?.("instructor_scope_sync_failed", {
        feature: "instructor_scope", stage: "sync_one",
        organizationId, errorCode: error?.code || "unknown", message: error?.message || "",
      });
      results.push({ clientId, outcome: "failed" });
    }
  }
  return results;
}

/**
 * 조직 전체를 다시 센다. 채우기와 상시 복구를 겸한다.
 *
 * 일회용 마이그레이션으로 만들지 않는다 -- 이 값은 파생값이라 트리거가 한 번
 * 실패하면 강사가 회원을 잃는다. 언제든 다시 돌릴 수 있어야 한다.
 *
 * @param {any} db @param {{ organizationId: string, now?: Date, log?: any,
 *   pageSize?: number }} input
 */
async function rebuildInstructorIds(db, input) {
  const organizationId = text(input?.organizationId);
  const org = db.collection("organizations").doc(organizationId);
  const pageSize = Number.isInteger(input?.pageSize) && input.pageSize > 0 ? input.pageSize : 200;
  const tally = { scanned: 0, updated: 0, wouldUpdate: 0, unchanged: 0, failed: 0, dryRun: input?.dryRun === true };

  /* 문서 id 순으로 넘긴다. 한 번에 다 읽으면 회원이 늘었을 때 메모리와
     시간 제한에 함께 걸린다. */
  let cursor = null;
  for (;;) {
    let query = org.collection("clients").orderBy("__name__").limit(pageSize);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    if (page.empty) break;
    const results = await syncInstructorIds(db, {
      organizationId, now: input?.now, log: input?.log, dryRun: input?.dryRun === true,
      clientIds: page.docs.map((snapshot) => snapshot.id),
    });
    for (const item of results) {
      tally.scanned += 1;
      if (item.outcome === "updated") tally.updated += 1;
      else if (item.outcome === "would_update") tally.wouldUpdate += 1;
      else if (item.outcome === "unchanged") tally.unchanged += 1;
      else tally.failed += 1;
    }
    if (page.size < pageSize) break;
    cursor = page.docs[page.docs.length - 1];
  }
  return tally;
}

/**
 * 채우기가 잘 됐는지 본다. 고치지 않고 세기만 한다.
 *
 * 배포 순서에서 ① 다음에 이것을 돌려 "모든 활성 회원에 instructorIds 가 있다"
 * 를 확인한 뒤에야 ② 로 간다.
 */
async function verifyInstructorIds(db, input) {
  const organizationId = text(input?.organizationId);
  const org = db.collection("organizations").doc(organizationId);
  const tally = { clients: 0, withInstructors: 0, empty: 0, emptyActive: 0 };
  /* 강사별 담당 회원 수. 대표가 비교하는 자리다 -- 한 사람만 0 이면 그
     사람의 회원이 빠진 것이고, 전부 0 이면 채우기가 안 돈 것이다. */
  const byInstructor = new Map();

  let cursor = null;
  const pageSize = 500;
  for (;;) {
    let query = org.collection("clients").orderBy("__name__").limit(pageSize);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    if (page.empty) break;
    for (const snapshot of page.docs) {
      const data = snapshot.data() || {};
      const listed = Array.isArray(data.instructorIds) ? data.instructorIds.filter(Boolean) : [];
      tally.clients += 1;
      if (listed.length) {
        tally.withInstructors += 1;
        for (const raw of listed) {
          const instructorId = text(raw);
          if (instructorId) byInstructor.set(instructorId, (byInstructor.get(instructorId) || 0) + 1);
        }
      }
      else {
        tally.empty += 1;
        /* 빈 것 자체는 정상이다 -- 회원권이 한 번도 안 나간 회원이 있다.
           운영중인데 비어 있으면 그것이 진짜 빠진 것이다. */
        if (text(data.status) === "active") tally.emptyActive += 1;
      }
    }
    if (page.size < pageSize) break;
    cursor = page.docs[page.docs.length - 1];
  }
  /* 많은 순으로. 대표가 보는 순간 이상한 줄이 위에 오게 한다. */
  return {
    ...tally,
    byInstructor: [...byInstructor.entries()]
      .map(([instructorId, clients]) => ({ instructorId, clients }))
      .sort((left, right) => right.clients - left.clients || left.instructorId.localeCompare(right.instructorId)),
  };
}

module.exports = {
  clientIdsFromPassChange,
  rebuildInstructorIds,
  syncInstructorIds,
  verifyInstructorIds,
};
