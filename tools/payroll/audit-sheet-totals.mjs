/**
 * 원본 엑셀의 강사누적진행과 지금 저장된 누적을 견준다. **읽기만 한다** --
 * `--write` 가 없다. 어느 쪽이 참인지는 사람이 정해야 한다.
 *
 *   node tools/payroll/audit-sheet-totals.mjs --organization bonita \
 *     --sheet 반송.csv --sheet 율하.csv
 *
 * ── 무엇을 확인하려는 것인가 ──
 * 이관은 한 행마다 누적 문서를 **덮어쓴다** (batch.set). 한 회원에 회원권이
 * 여러 장이면 그만큼 덮어쓰이고 마지막 행만 남는다.
 *
 * 옛 양식은 줄마다 그 회원권의 횟수를 적었으므로 합이 맞아야 하는데, 덮어쓰기
 * 때문에 마지막 한 장만 남았다. 새 양식은 모든 줄에 같은 총합을 적어 어느
 * 줄이 이기든 값이 같다.
 *
 * 그래서 `matches_last_row_only` 로 찍히는 회원이 있으면 **옛 양식으로 올린
 * 것이고 그 회원의 누적이 모자란다.**
 *
 * 엑셀은 CSV 로 내보내 주세요 -- 이 스크립트는 xlsx 를 열지 않습니다.
 */

import { readFile } from "node:fs/promises";

import { planPassMigration } from "../../src/data/repositories/migration-repository.js";
import { compareWithStored, sheetTotals, summarizeAudit } from "./sheet-totals-audit.js";

const parseArgs = (argv) => {
  const options = { sheet: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--sheet") options.sheet.push(argv[index += 1]);
    else if (key.startsWith("--")) options[key.slice(2)] = argv[index += 1];
  }
  return options;
};

const options = parseArgs(process.argv.slice(2));
const organizationId = String(options.organization || "").trim();
if (!organizationId || options.sheet.length === 0) {
  console.error("--organization 과 --sheet 가 필요합니다 (--sheet 는 여러 번 쓸 수 있습니다).");
  process.exit(1);
}

const { cert, getApps, initializeApp } = await import("firebase-admin/app");
const { getFirestore } = await import("firebase-admin/firestore");
if (!getApps().length) {
  initializeApp(options.key ? { credential: cert(options.key) } : undefined);
}
const firestore = getFirestore();

/* 엑셀을 읽으려면 회원·지점·강사 명부가 필요하다 -- planPassMigration 이
   이름과 번호를 그것으로 푼다. 이관 때와 **같은 함수**를 쓰는 것이 요점이다:
   따로 파싱하면 그 파서가 이관과 다르게 읽는 순간 이 비교가 거짓말이 된다. */
const readAll = async (collection) => {
  const snapshot = await firestore.collection(`organizations/${organizationId}/${collection}`).get();
  return snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
};
const [clients, locations, instructors] = await Promise.all([
  readAll("clients"), readAll("locations"), readAll("instructors"),
]);
console.log(`명부: 회원 ${clients.length} · 지점 ${locations.length} · 강사 ${instructors.length}`);

const rows = [];
for (const path of options.sheet) {
  const text = await readFile(path, "utf8");
  const plan = planPassMigration(text, { clients, locations, instructors, createdBy: "audit" });
  /* 실패한 행은 비교에서 빠진다. 이관 때 올라가지 않은 행이라 저장된 누적에
     기여한 적이 없다 -- 넣으면 "모자라다" 가 거짓으로 뜬다. */
  if (plan.failures.length) {
    console.log(`${path}: ${plan.failures.length}행은 읽지 못해 비교에서 뺍니다.`);
  }
  console.log(`${path}: ${plan.writes.length}행`);
  rows.push(...plan.writes);
}

const sums = sheetTotals({ rows });

const storedByKey = new Map();
for (const entry of sums.values()) {
  const key = `${entry.instructorId}_${entry.clientId}`;
  const found = await firestore
    .doc(`organizations/${organizationId}/instructorClientTotals/${key}`).get();
  storedByKey.set(key, found.exists ? Number(found.data()?.sessions) || 0 : null);
}

const differing = compareWithStored({
  sums,
  sessionsOf: (instructorId, clientId) => storedByKey.get(`${instructorId}_${clientId}`) ?? null,
});

console.log("");
console.log("강사                 회원                 줄  엑셀합  최대  저장됨  읽히는 모양");
console.log("".padEnd(92, "-"));
for (const row of differing) {
  console.log([
    row.instructorId.padEnd(20),
    row.clientId.padEnd(20),
    String(row.sheetRows).padStart(2),
    String(row.sheetSum).padStart(6),
    String(row.sheetMax).padStart(5),
    String(row.stored === null ? "없음" : row.stored).padStart(6),
    row.looksLike,
  ].join(" "));
}

console.log("");
console.log(JSON.stringify(summarizeAudit(differing, sums), null, 2));
console.log("");
console.log("matches_last_row_only = 덮어쓰기로 마지막 줄만 남았습니다 (옛 양식).");
console.log("neither = 엑셀과도 저장값과도 안 맞습니다. 이관 뒤 실제 수업이 쌓였을 수 있습니다.");
console.log("이 스크립트는 **고치지 않습니다.** 어느 쪽이 참인지 보고 정해 주세요.");
