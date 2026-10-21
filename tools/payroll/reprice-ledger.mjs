/**
 * 10/1 이후 차감을 새 규칙으로 다시 계산해 **금액이 달라지는 항목만** 뽑는다.
 *
 *   node tools/payroll/reprice-ledger.mjs --organization bonita
 *   node tools/payroll/reprice-ledger.mjs --organization bonita --since 2026-10-01
 *
 * **읽기 전용이다. `--write` 가 없다.** 원장은 append-only 라 지난 항목의
 * 금액을 고칠 수 없고, 고치는 길은 보정 항목을 새로 쌓는 것뿐이다 -- 그것은
 * 사람이 보고 정할 일이다. 이 스크립트는 "얼마나 차이가 나는가" 까지만 답한다.
 *
 * ── 먼저 돌릴 것 ──
 * **누적 보정(repair-service-totals.mjs)보다 먼저 돌린다.** 이 셈은 지금
 * 저장된 누적에서 기준일 이후를 되짚어 출발점을 잡는데, 보정이 그 값을 먼저
 * 바꾸면 되짚기가 그만큼 어긋난다.
 *
 * firebase-admin 은 쓰는 순간에 들여온다 (CLAUDE.md 의 CI 항목).
 */

import { openFirestore } from "./admin-sdk.mjs";
import {
  byInstructor, changedOnly, repriceEntries, rewindShortfall, sessionsAtStart,
  summarizeReprice,
} from "./reprice.js";

const parseArgs = (argv) => {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key.startsWith("--")) options[key.slice(2)] = argv[index += 1];
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

const firestore = await openFirestore({ key: options.key });

console.log(`센터      : ${organizationId}`);
console.log(`기준 시각 : ${since.toISOString()} 이후`);
console.log("읽기 전용 : 아무것도 바꾸지 않습니다");
console.log("");

/* 기준일 이후 원장 전체. 차감만이 아니라 **보정도** 읽는다 -- 출발점을
   되짚으려면 그 사이에 내려간 것도 알아야 한다. */
const snapshot = await firestore.collectionGroup("ledger")
  .where("organizationId", "==", organizationId)
  .where("occurredAt", ">=", since)
  .get();
const entries = snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
console.log(`원장 ${entries.length}건을 읽었습니다.`);

/* 회원권. 단가를 다시 구하려면 baseUnitPrice 와 계약 금액이 필요하다. */
const passIds = [...new Set(entries.map((entry) => String(entry.passId || "")).filter(Boolean))];
const passById = new Map();
for (const passId of passIds) {
  const found = await firestore.doc(`organizations/${organizationId}/passes/${passId}`).get();
  if (found.exists) passById.set(passId, found.data());
}
console.log(`회원권 ${passById.size}/${passIds.length}장을 읽었습니다.`);

/* 직급. **지금 값이다** -- 그때의 직급은 원장에 없다. 승진한 사람의 지난
   회차가 지금 직급으로 다시 계산되므로, 점장·팀장 줄은 눈으로 한 번 더 본다. */
const memberships = await firestore.collection("memberships")
  .where("organizationId", "==", organizationId).get();
const titleByInstructor = new Map(memberships.docs.map((document) => [
  String(document.data()?.userId || ""), String(document.data()?.title || ""),
]));

/* 강사–회원 쌍마다 따로 걷는다. 누적이 그 쌍의 값이기 때문이다.
   **듀엣은 두 사람 중 적은 쪽이 단가를 정하므로**, 쌍 하나만 보면 짝이 더
   새 사람일 때를 놓친다 -- 그런 줄은 아래에서 따로 표시한다. */
const byPair = new Map();
for (const entry of entries) {
  const key = `${String(entry.instructorId || "")}_${String(entry.clientId || "")}`;
  if (!byPair.has(key)) byPair.set(key, []);
  byPair.get(key).push(entry);
}

const rows = [];
/** 되짚기가 어긋난 강사–회원 쌍. key → 모자란 횟수. */
const shaky = new Map();
for (const [key, pairEntries] of byPair) {
  const [instructorId, clientId] = key.split("_");
  if (!instructorId || !clientId) continue;
  const stored = await firestore
    .doc(`organizations/${organizationId}/instructorClientTotals/${key}`).get();
  const storedSessions = stored.exists ? Number(stored.data()?.sessions) || 0 : 0;
  const startingSessions = sessionsAtStart({ storedSessions, entriesSince: pairEntries });
  /* 되짚기가 0 아래로 내려갔으면 지금 저장된 누적이 원장만으로는 설명되지
     않는다는 뜻이다. **콘솔에서 손으로 고친 회원이 여기 걸린다.** 그 줄의
     새 단가는 믿을 수 없다 -- 조용히 0 으로 눌러 두면 들어맞은 값과 똑같은
     얼굴로 나온다. */
  const shortfall = rewindShortfall({ storedSessions, entriesSince: pairEntries });
  if (shortfall > 0) shaky.set(key, shortfall);
  rows.push(...repriceEntries({
    entries: pairEntries,
    startingSessions,
    passOf: (passId) => passById.get(passId) || null,
    titleOf: (uid) => titleByInstructor.get(uid) || "",
  }));
}

const changed = changedOnly(rows).sort((left, right) => (
  (left.occurredAt?.getTime() ?? 0) - (right.occurredAt?.getTime() ?? 0)
));

/* 이름을 붙인다. **id 만 보여 주면 대표는 그것이 누구인지 알 수 없고**,
   강사별 합계는 읽을 수조차 없다. */
const clientSnapshot = await firestore.collection(`organizations/${organizationId}/clients`).get();
const nameById = new Map(clientSnapshot.docs.map((document) => [document.id, String(document.data()?.name || "")]));
const membershipSnapshot = await firestore.collection("memberships")
  .where("organizationId", "==", organizationId).get();
const instructorById = new Map(membershipSnapshot.docs.map((document) => [
  String(document.data()?.userId || ""), String(document.data()?.displayName || ""),
]));
const who = (id) => instructorById.get(id) || String(id).slice(0, 8);
const whom = (id) => nameById.get(id) || String(id).slice(0, 12);

console.log("");
console.log("날짜        강사        회원        종류                    누적  기존 →   새   차액");
console.log("".padEnd(116, "-"));
for (const row of changed) {
  const day = row.occurredAt ? row.occurredAt.toISOString().slice(0, 10) : "날짜없음";
  if (row.skipped) {
    console.log(`${day}  ${who(row.instructorId).padEnd(10).slice(0, 10)} ${whom(row.clientId).padEnd(10).slice(0, 10)} ${row.category.padEnd(22)} (${row.skipped})`);
    continue;
  }
  console.log([
    day,
    who(row.instructorId).padEnd(10).slice(0, 10),
    whom(row.clientId).padEnd(10).slice(0, 10),
    row.category.padEnd(22),
    String(row.priorSessions).padStart(4),
    String(row.oldUnitPrice).padStart(6),
    String(row.newUnitPrice).padStart(6),
    `${row.difference > 0 ? "+" : ""}${row.difference}`.padStart(7),
  ].join(" "));
  const mark = shaky.has(`${row.instructorId}_${row.clientId}`)
    ? "   ** 되짚기 어긋남 — 손으로 고친 회원일 수 있음. 이 줄의 새 단가는 믿지 마세요 **"
    : "";
  console.log(`${"".padEnd(12)}${row.oldRule} → ${row.newRule}${mark}`);
}

/* ── 강사별 합계 ──────────────────────────────────────────────────────
   **올라간 것과 내려간 것을 따로 적는다.** 합계만 보면 서로 지워져 "차이
   없음" 으로 보이는데, 강사마다는 받을 돈과 돌려줄 돈이 따로 있다. */
console.log("");
console.log("── 강사별 합계 ──");
console.log("강사            건수   올라감      내려감        합계");
console.log("".padEnd(60, "-"));
for (const line of byInstructor(rows)) {
  console.log([
    who(line.instructorId).padEnd(14).slice(0, 14),
    String(line.entries).padStart(4),
    `${line.increased}건 +${line.up}`.padStart(11),
    `${line.decreased}건 ${line.down}`.padStart(11),
    `${line.difference > 0 ? "+" : ""}${line.difference}`.padStart(10),
  ].join(" "));
}

/* ── 되짚기가 어긋난 쌍 ───────────────────────────────────────────────
   **따로 모아 둔다.** 줄마다 표시해도 77줄 사이에 묻히고, 대표가 봐야 할
   것은 "어느 회원을 사람이 봐야 하는가" 하나다. */
console.log("");
console.log("── 되짚기가 어긋난 강사–회원 (손으로 고친 회원일 수 있음) ──");
if (shaky.size === 0) {
  console.log("없습니다. 저장된 누적이 원장만으로 전부 설명됩니다.");
} else {
  for (const [key, short] of [...shaky.entries()].sort((a, b) => b[1] - a[1])) {
    const [instructorId, clientId] = key.split("_");
    console.log(`  ${who(instructorId).padEnd(12).slice(0, 12)} ${whom(clientId).padEnd(12).slice(0, 12)} 원장보다 ${short}회 모자람`);
  }
  console.log("");
  console.log("저장된 누적이 원장보다 작습니다 -- 원장만으로는 설명되지 않습니다.");
  console.log("위 줄들의 '새 단가' 는 출발점이 틀렸을 수 있으니 그대로 쓰지 마세요.");
}

console.log("");
console.log(JSON.stringify({ ...summarizeReprice(rows), shakyPairs: shaky.size }, null, 2));
console.log("");
console.log("원장은 append-only 입니다 -- 이 스크립트는 고치지 않습니다.");
console.log("고치려면 보정 항목을 새로 쌓아야 하고, 그것은 대표가 정할 일입니다.");
console.log("직급은 **지금 값**으로 계산했습니다. 승진한 강사의 지난 회차는 한 번 더 봐 주세요.");
console.log("듀엣은 두 사람 중 적은 누적이 단가를 정합니다 -- 여기서는 쌍 하나만 걷습니다.");
