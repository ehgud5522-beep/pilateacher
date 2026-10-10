"use strict";

/**
 * 밤마다 잔여와 원장을 견준다. **건수만 적는다.**
 *
 * ── 왜 고치지 않는가 ──
 * 어긋난 회원권을 자동으로 맞추면 어느 쪽이 참인지 모른 채 한쪽을 덮어쓰게
 * 된다. 잔여가 맞고 원장이 빠진 것일 수도, 그 반대일 수도 있다. 밤에 아무도
 * 보지 않는 사이에 그 선택을 내리는 것이 가장 나쁘다 -- 잘못 덮어쓴 것은
 * 원장이 append-only 라 되돌릴 수도 없다.
 *
 * 그래서 세기만 하고 로그에 남긴다. 대표가 아침에 [잔여 점검] 을 눌러 목록을
 * 보고, [잔여 조정] 으로 맞춘다. 그러면 맞춘 사실도 원장에 남는다.
 *
 * ── 왜 로그인가 ──
 * Firestore 에 결과 문서를 쓰지 않는다. 그 문서를 읽는 화면이 없으면 아무도
 * 안 보고, 있으면 화면이 "어젯밤 숫자" 와 "지금 숫자" 둘을 들고 있게 된다 --
 * 둘이 다를 때 어느 쪽을 믿어야 하는지 아무도 모른다. 추세는 로그로 본다.
 *
 * ── 이름에 주의 ──
 * 로그에 회원 이름도 회원권 id 도 적지 않는다 (§7). 건수만 적는다 -- 누가
 * 어긋났는지는 대표가 화면에서 본다.
 */

const LEDGER_COLLECTION = "ledger";

/* 판정은 앱과 같은 함수를 쓴다. 갈라지면 밤에 세는 숫자와 아침에 보는 숫자가
   달라지고, 대표는 어느 쪽을 믿어야 할지 알 수 없다.

   이 파일은 CommonJS 라 ESM 을 require 할 수 없어 동적 import 로 읽는다 --
   Node 가 모듈을 캐시하므로 인스턴스당 한 번이다 (member-link.js 와 같다). */
let reconcileModule = null;
async function loadReconcile() {
  if (!reconcileModule) {
    reconcileModule = await import("../shared/pass-reconcile.mjs");
  }
  return reconcileModule;
}

/**
 * 센터 하나를 견준다.
 *
 * @param {any} firestore
 * @param {{ organizationId: string }} input
 * @returns {Promise<{ total: number, matched: number, mismatched: number, unknown: number }>}
 */
async function reconcileOrganization(firestore, { organizationId }) {
  const { reconcileReport } = await loadReconcile();
  const org = firestore.collection("organizations").doc(organizationId);

  const [passes, entries] = await Promise.all([
    org.collection("passes").get(),
    /* 회원권마다 하위 컬렉션을 읽으면 회원권 수만큼 질의가 나간다.
       collectionGroup 한 번이면 끝난다 -- 인덱스는 앱이 쓰는 것과 같다. */
    firestore.collectionGroup(LEDGER_COLLECTION)
      .where("organizationId", "==", organizationId).get(),
  ]);

  const byPass = new Map();
  for (const snapshot of entries.docs) {
    const entry = snapshot.data() || {};
    const passId = String(entry.passId ?? "").trim();
    if (!passId) continue;
    if (!byPass.has(passId)) byPass.set(passId, []);
    byPass.get(passId).push(entry);
  }

  const rows = passes.docs.map((snapshot) => ({
    pass: { id: snapshot.id, ...snapshot.data() },
    entries: byPass.get(snapshot.id) || [],
  }));

  const report = reconcileReport(rows);
  return {
    total: report.total,
    matched: report.matched,
    mismatched: report.mismatched,
    unknown: report.unknown,
  };
}

module.exports = { reconcileOrganization };
