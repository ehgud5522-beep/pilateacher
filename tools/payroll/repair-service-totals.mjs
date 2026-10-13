/**
 * 서비스 회차만큼 누적을 되돌린다. **기본은 dry-run 이다.**
 *
 *   node tools/payroll/repair-service-totals.mjs --organization bonita
 *   node tools/payroll/repair-service-totals.mjs --organization bonita --write
 *
 * ── 무엇을 고치는가 ──
 * 2026-10-13 까지 서비스 차감도 누적(instructorClientTotals)을 올렸다. 서비스는
 * 따로 정산하는 회차라 "이 강사와 몇 번 했는가" 에 들어가면 안 되는데, 그만큼
 * 신규 단가 구간이 일찍 끝나 강사가 받을 25,000 짜리 회차가 사라졌다.
 *
 * 원장에 찍힌 service 차감 수만큼 그 쌍의 누적을 내린다.
 *
 * ── 왜 serviceUsed 를 쓰지 않는가 ──
 * 회원권의 그 숫자에는 **이관 전에 쓴 분량이 섞여 있다.** 그 회차들은 앱이
 * 누적을 올린 적이 없으므로 빼면 안 되는데, 회원권만 보고는 가려낼 수 없다.
 * 원장에 실제로 찍힌 것만 세는 것이 "앱이 올린 것" 과 정확히 같은 집합이다.
 *
 * ── 언제부터인가 ──
 * `--since` 로 정한다 (기본 2026-10-01). 그 앞의 서비스 차감은 이관으로 심은
 * 누적에 들어 있지 않다 -- 이관은 엑셀의 강사누적진행을 그대로 심었고, 그
 * 숫자는 앱이 올린 것이 아니다. 거기까지 빼면 두 번 빼는 것이 된다.
 *
 * firebase-admin 은 `functions/node_modules` 에만 있다. 루트 테스트가 적재
 * 단계에서 죽지 않도록 **쓰는 순간에** 들여온다 (CLAUDE.md 의 CI 항목).
 */

import {
  planTotalsRepair, serviceDeductionsByPair, summarizeRepair,
} from "./totals-repair.js";

const parseArgs = (argv) => {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--write") options.write = true;
    else if (key.startsWith("--")) options[key.slice(2)] = argv[index += 1];
  }
  return options;
};

const options = parseArgs(process.argv.slice(2));
const organizationId = String(options.organization || "").trim();
if (!organizationId) {
  console.error("--organization 이 필요합니다. 예: --organization bonita");
  process.exit(1);
}
const since = new Date(`${String(options.since || "2026-10-01")}T00:00:00`);
if (Number.isNaN(since.getTime())) {
  console.error(`--since 를 날짜로 읽지 못했습니다: ${options.since}`);
  process.exit(1);
}

const { cert, getApps, initializeApp } = await import("firebase-admin/app");
const { getFirestore } = await import("firebase-admin/firestore");
if (!getApps().length) {
  /* 자격은 환경이 준다 (GOOGLE_APPLICATION_CREDENTIALS). 키를 코드에 두지
     않는 것이 요점이고, cert 는 그 경로를 쓰는 분을 위해 남겨 둔다. */
  initializeApp(options.key ? { credential: cert(options.key) } : undefined);
}
const firestore = getFirestore();

console.log(`센터       : ${organizationId}`);
console.log(`기준 시각  : ${since.toISOString()} 이후`);
console.log(`모드       : ${options.write ? "쓰기" : "**dry-run** (아무것도 바꾸지 않습니다)"}`);
console.log("");

/* 원장은 회원권 아래에 흩어져 있다. 그룹 질의로 센터 것만 모은다 -- 급여
   집계가 쓰는 길과 같다 (payroll-repository). */
const snapshot = await firestore.collectionGroup("ledger")
  .where("organizationId", "==", organizationId)
  .where("type", "==", "deduct")
  .where("category", "==", "service")
  .where("occurredAt", ">=", since)
  .get();
const entries = snapshot.docs.map((document) => document.data());
console.log(`서비스 차감 ${entries.length}건을 읽었습니다.`);

/* 듀엣이면 차감이 **두 사람의** 누적을 올렸다. 원장 항목은 대표 한 명만
   들고 있으므로 회원권에서 짝을 찾는다. */
const passIds = [...new Set(entries.map((entry) => String(entry.passId || "")).filter(Boolean))];
const clientIdsByPass = new Map();
for (const passId of passIds) {
  const pass = await firestore.doc(`organizations/${organizationId}/passes/${passId}`).get();
  if (!pass.exists) continue;
  const data = pass.data();
  const listed = Array.isArray(data.clientIds) && data.clientIds.length
    ? data.clientIds
    : [data.clientId];
  clientIdsByPass.set(passId, listed.map((id) => String(id || "")).filter(Boolean));
}

const pairs = serviceDeductionsByPair({
  entries,
  clientIdsOf: (passId) => clientIdsByPass.get(passId) || null,
});

/* 지금 저장된 누적. 없는 문서는 건드리지 않는다 -- 만들면 있지도 않던
   기록이 생긴다. */
const storedByKey = new Map();
for (const pair of pairs.values()) {
  const key = `${pair.instructorId}_${pair.clientId}`;
  const found = await firestore
    .doc(`organizations/${organizationId}/instructorClientTotals/${key}`).get();
  storedByKey.set(key, found.exists ? Number(found.data()?.sessions) || 0 : null);
}

const rows = planTotalsRepair({
  pairs,
  sessionsOf: (instructorId, clientId) => storedByKey.get(`${instructorId}_${clientId}`) ?? null,
});

console.log("");
console.log("강사                 회원                 서비스  전 → 후");
console.log("".padEnd(68, "-"));
for (const row of rows) {
  const change = row.skipped
    ? `(${row.skipped})`
    : `${String(row.before).padStart(4)} → ${String(row.after).padStart(4)}${row.clamped ? `  (0 에서 멈춤, ${row.clamped} 남음)` : ""}`;
  console.log(
    `${row.instructorId.padEnd(20)} ${row.clientId.padEnd(20)} ${String(row.serviceDeductions).padStart(5)}  ${change}`,
  );
}

console.log("");
console.log(JSON.stringify(summarizeRepair(rows), null, 2));

if (!options.write) {
  console.log("");
  console.log("dry-run 입니다. 위 목록을 확인한 뒤 --write 를 붙여 다시 실행하세요.");
  process.exit(0);
}

/* 쓴다. 한 번에 하나씩이고 batch 로 묶지 않는다 -- 중간에 멈춰도 어디까지
   갔는지가 화면에 남는 편이, 500건이 통째로 되돌아가는 것보다 낫다. */
let written = 0;
for (const row of rows) {
  if (row.skipped || row.after === row.before) continue;
  await firestore
    .doc(`organizations/${organizationId}/instructorClientTotals/${row.instructorId}_${row.clientId}`)
    .update({ sessions: row.after });
  written += 1;
  console.log(`썼습니다: ${row.instructorId}_${row.clientId} ${row.before} → ${row.after}`);
}
console.log("");
console.log(`${written}건을 바꿨습니다.`);
