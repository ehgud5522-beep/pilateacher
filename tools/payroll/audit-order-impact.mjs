/**
 * 순서가 틀린 차감의 **차액과 잔여 정정 목록**. 읽기 전용이고 `--write` 가 없다.
 *
 *   node tools/payroll/audit-order-impact.mjs --organization bonita \
 *     --from 2026-10-01 --to 2026-10-22
 *
 * ── 대상 ──
 * **창 안의 원장만 본다.** 창 밖의 차감은 규칙대로 간 것이고, 섞어 세면 이
 * 목록이 "순서 때문에 생긴 차이" 가 아니게 된다.
 *
 * 잔여를 되짚을 때만 창 뒤의 차감을 함께 읽는다 -- 지금 잔여에서 그 뒤에
 * 일어난 것을 되돌려야 그때의 잔여가 나온다. 읽기만 하고 세지는 않는다.
 *
 * ── 고치지 않는다 ──
 * 원장은 append-only 다. 이 목록은 사람이 콘솔에서 무엇을 몇 개 움직여야
 * 하는가를 적은 것이다.
 */

import { openFirestore } from "./admin-sdk.mjs";
import { misorderedDeductions } from "./deduction-order-audit.js";
import { isServiceDeduction, sessionsAtStart } from "./reprice.js";
import {
  impactByInstructor, impactOfRow, remainingCorrections, summarizeImpact,
} from "./order-impact.js";

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
const dayOf = (value, fallback) => {
  const at = new Date(`${String(value || fallback)}T00:00:00`);
  if (Number.isNaN(at.getTime())) {
    console.error(`날짜를 읽지 못했습니다: ${value}`);
    process.exit(1);
  }
  return at;
};
const from = dayOf(options.from, "2026-10-01");
const to = dayOf(options.to, "2026-10-22");
/* 끝날을 포함한다. --to 2026-10-22 는 그날 자정까지가 아니라 **그날까지**를
   뜻한다 -- 하루를 조용히 빠뜨리면 그 하루의 차감이 목록에서 사라진다. */
const toExclusive = new Date(to.getTime() + 24 * 60 * 60 * 1000);

const localDay = (at) => [at.getFullYear(), at.getMonth() + 1, at.getDate()]
  .map((part, index) => String(part).padStart(index ? 2 : 4, "0")).join("-");

const firestore = await openFirestore({ key: options.key });

console.log(`센터      : ${organizationId}`);
console.log(`대상      : ${localDay(from)} ~ ${localDay(to)} 원장만`);
console.log("읽기 전용 : 아무것도 바꾸지 않습니다");
console.log("");

const passSnapshot = await firestore.collection(`organizations/${organizationId}/passes`).get();
const passes = passSnapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
const passById = new Map(passes.map((pass) => [pass.id, pass]));

/* 원장은 창보다 넓게 읽는다 -- 그때의 잔여를 되짚으려면 창 **뒤의** 차감까지
   알아야 한다. 차액은 창 안의 것만 센다. */
const ledgerSnapshot = await firestore.collectionGroup("ledger")
  .where("organizationId", "==", organizationId)
  .where("type", "==", "deduct")
  .where("occurredAt", ">=", from)
  .get();
const entries = ledgerSnapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
const entryById = new Map(entries.map((entry) => [entry.id, entry]));
console.log(`회원권 ${passes.length}장 · 차감 ${entries.length}건을 읽었습니다.`);

const clientSnapshot = await firestore.collection(`organizations/${organizationId}/clients`).get();
const nameById = new Map(clientSnapshot.docs.map((document) => [document.id, String(document.data()?.name || "")]));
const membershipSnapshot = await firestore.collection("memberships")
  .where("organizationId", "==", organizationId).get();
const instructorById = new Map(membershipSnapshot.docs.map((document) => [
  String(document.data()?.userId || ""), String(document.data()?.displayName || ""),
]));

const misordered = misorderedDeductions({ entries, passes, from, to: toExclusive });
console.log(`그중 순서가 틀린 것 ${misordered.length}건.`);

/* ── 그때의 누적을 되짚는다 ────────────────────────────────────────────
   **원장은 priorSessions 를 들고 있지 않다.** 그냥 읽으면 전부 0 이 되어 모든
   줄이 "누적 20회 미만" 으로 떨어지고, 차액이 통째로 거짓이 된다 -- 처음에
   그렇게 나왔다.

   지금 저장된 누적에서 기준일 이후를 되돌려 출발점을 잡고, 시간 순으로
   걸으며 한 줄씩 센다. reprice 가 쓰는 길과 같다. */
const byPair = new Map();
for (const entry of entries) {
  const key = `${String(entry.instructorId || "")}_${String(entry.clientId || "")}`;
  if (!byPair.has(key)) byPair.set(key, []);
  byPair.get(key).push(entry);
}
const priorByEntry = new Map();
for (const [key, pairEntries] of byPair) {
  const [instructorId, clientId] = key.split("_");
  if (!instructorId || !clientId) continue;
  const stored = await firestore
    .doc(`organizations/${organizationId}/instructorClientTotals/${key}`).get();
  let sessions = sessionsAtStart({
    storedSessions: stored.exists ? Number(stored.data()?.sessions) || 0 : 0,
    entriesSince: pairEntries,
  });
  const ordered = pairEntries.slice().sort((left, right) => {
    const at = (value) => (typeof value?.toDate === "function" ? value.toDate().getTime() : 0);
    return at(left.occurredAt) - at(right.occurredAt) || String(left.id).localeCompare(String(right.id));
  });
  for (const entry of ordered) {
    priorByEntry.set(String(entry.id), sessions);
    // 서비스 회차는 누적을 올리지 않는다 (새 규칙).
    if (!isServiceDeduction(entry)) sessions += 1;
  }
}

/* 직급은 **지금 값**이다. 원장이 그때의 직급을 들고 있지 않다 -- 이 기간에
   승진한 강사가 있으면 그 줄은 사람이 한 번 더 봐야 한다 (아래 꼬리말).
   부원장은 그때 이긴 판정으로 되짚는다 (rule 이 deputy_director 였는가). */
const titleByInstructor = new Map(membershipSnapshot.docs.map((document) => [
  String(document.data()?.userId || ""), String(document.data()?.title || ""),
]));

const rows = misordered.map((row) => {
  const usedEntry = entryById.get(row.entryId) || null;
  const shouldPass = passById.get(row.shouldPassId) || null;
  return {
    ...row,
    ...impactOfRow({
      row,
      usedEntry,
      shouldPass,
      priorSessions: priorByEntry.get(row.entryId),
      title: titleByInstructor.get(String(row.instructorId)) || "",
      isDeputyDirector: String(usedEntry?.rule || "") === "deputy_director",
    }),
  };
});

const who = (id) => instructorById.get(id) || String(id).slice(0, 8);
const whom = (id) => nameById.get(id) || String(id).slice(0, 12);

console.log("");
console.log("── 차감별 차액 (맞는 회원권에서 빠졌다면) ──");
console.log("날짜        강사        회원        적힌값   맞는값    차액  맞는 규칙");
console.log("".padEnd(92, "-"));
for (const row of rows) {
  const day = row.occurredAt ? localDay(row.occurredAt) : "날짜없음";
  if (row.unknown) {
    console.log(`${day}  ${who(row.instructorId).padEnd(10).slice(0, 10)} ${whom(row.clientId).padEnd(10).slice(0, 10)} (맞는 회원권을 읽지 못해 셈하지 않음)`);
    continue;
  }
  console.log([
    day,
    who(row.instructorId).padEnd(10).slice(0, 10),
    whom(row.clientId).padEnd(10).slice(0, 10),
    String(row.oldUnitPrice).padStart(7),
    String(row.newUnitPrice).padStart(7),
    `${row.difference > 0 ? "+" : ""}${row.difference}`.padStart(7),
    `  ${row.newRule}`,
  ].join(" "));
}

console.log("");
console.log("── 강사별 차액 합계 ──");
console.log("강사            건수     올라감      내려감        합계");
console.log("".padEnd(62, "-"));
for (const line of impactByInstructor(rows)) {
  console.log([
    who(line.instructorId).padEnd(14).slice(0, 14),
    String(line.entries).padStart(4),
    `+${line.up}`.padStart(11),
    String(line.down).padStart(11),
    `${line.difference > 0 ? "+" : ""}${line.difference}`.padStart(10),
  ].join(" "));
}

const corrections = remainingCorrections(misordered);
console.log("");
console.log("── 잔여 정정 목록 (콘솔에서 사람이 움직일 것) ──");
console.log("+ 는 돌려받을 회차, - 는 빼야 할 회차입니다.");
console.log("");
console.log("회원        회원권                                  정정");
console.log("".padEnd(70, "-"));
for (const item of corrections) {
  console.log([
    whom(item.clientId).padEnd(10).slice(0, 10),
    item.passId.padEnd(40).slice(0, 40),
    `${item.delta > 0 ? "+" : ""}${item.delta}`.padStart(5),
  ].join(" "));
}

console.log("");
console.log(JSON.stringify({
  ...summarizeImpact(rows),
  passesToCorrect: corrections.length,
  /* 더해서 0 이어야 한다. 한쪽에서 돌려받은 만큼 다른 쪽에서 빠지기
     때문이다 -- 0 이 아니면 짝을 못 찾은 줄이 있다는 뜻이다. */
  correctionBalance: corrections.reduce((sum, item) => sum + item.delta, 0),
}, null, 2));

console.log("");
console.log("**고치지 않습니다.** 원장은 append-only 라 지난 항목을 옮길 수 없습니다.");
console.log("차액은 '맞는 회원권에서 빠졌다면 얼마였을까' 와 실제로 적힌 금액의 차이입니다.");
console.log("차액이 0 이어도 잔여는 되돌려야 합니다 -- 만료가 이른 쪽이 그만큼 더 사라집니다.");
console.log("직급은 **지금 값**으로 셈했습니다. 이 기간에 승진한 강사의 줄은 한 번 더 봐 주세요.");
console.log("누적은 지금 저장된 값에서 되짚었습니다 -- 콘솔에서 손으로 고친 회원은 어긋날 수 있습니다.");
