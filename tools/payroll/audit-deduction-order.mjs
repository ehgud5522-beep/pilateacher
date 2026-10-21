/**
 * 순서가 틀린 차감을 뽑는다. **읽기 전용이고 `--write` 가 없다.**
 *
 *   node tools/payroll/audit-deduction-order.mjs --organization bonita
 *   node tools/payroll/audit-deduction-order.mjs --organization bonita \
 *     --from 2026-10-09 --to 2026-10-22
 *
 * ── 무엇을 찾는가 ──
 * 2026-10-09 ~ 10-22 사이에 차감이 **차수 순**으로 돌았다. 그 사이에 뒤
 * 차수의 만료가 더 이른 회원이 있으면 앞 차수가 먼저 빠지고, 뒤 차수는 손도
 * 못 대 보고 만료로 간다 -- 회원이 돈을 낸 회차다.
 *
 * ── 고치지 않는다 ──
 * 원장은 append-only 라 지난 항목을 옮길 수 없다. 고치는 길은 보정 항목을
 * 쌓고 다시 차감하는 것뿐이고, 그것은 회원과 이야기한 뒤에 정할 일이다.
 *
 * firebase-admin 은 쓰는 순간에 들여온다 (CLAUDE.md 의 CI 항목).
 */

import { openFirestore } from "./admin-sdk.mjs";
import { candidateKind, misorderedDeductions, summarizeOrderAudit } from "./deduction-order-audit.js";

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
const from = dayOf(options.from, "2026-10-09");
const to = dayOf(options.to, "2026-10-22");

const firestore = await openFirestore({ key: options.key });

console.log(`센터      : ${organizationId}`);
/* 화면에 찍는 날짜는 **그 자리의 날짜**다. toISOString 으로 찍으면 KST 자정이
   전날 15시가 되어, --from 2026-10-01 을 주고 09-30 을 읽게 된다. */
const localDay = (at) => [at.getFullYear(), at.getMonth() + 1, at.getDate()]
  .map((part, index) => String(part).padStart(index ? 2 : 4, "0")).join("-");
console.log(`구간      : ${localDay(from)} ~ ${localDay(to)} (차수 순으로 돌던 기간)`);
console.log("읽기 전용 : 아무것도 바꾸지 않습니다");
console.log("");

/* 회원권 전부. 그때 쓸 수 있었던 것을 되짚으려면 끝난 것도 필요하다 --
   지금 잔여가 0 이어도 그때는 남아 있었을 수 있다. */
const passSnapshot = await firestore.collection(`organizations/${organizationId}/passes`).get();
const passes = passSnapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
console.log(`회원권 ${passes.length}장을 읽었습니다.`);

/* 원장은 구간보다 넓게 읽는다 -- 구간 **뒤의** 차감까지 알아야 그때의 잔여를
   되짚을 수 있다 (misorderedDeductions 의 remainingAt). */
const ledgerSnapshot = await firestore.collectionGroup("ledger")
  .where("organizationId", "==", organizationId)
  .where("type", "==", "deduct")
  .where("occurredAt", ">=", from)
  .get();
const entries = ledgerSnapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
console.log(`차감 ${entries.length}건을 읽었습니다 (구간 뒤까지 -- 그때의 잔여를 되짚기 위해).`);

const rows = misorderedDeductions({ entries, passes, from, to });

/* 이름을 붙인다. 회원권 번호만 보여 주면 대표는 그것이 누구인지 알 수 없다. */
const clientSnapshot = await firestore.collection(`organizations/${organizationId}/clients`).get();
const nameById = new Map(clientSnapshot.docs.map((document) => [document.id, String(document.data()?.name || "")]));
const instructorSnapshot = await firestore.collection("memberships")
  .where("organizationId", "==", organizationId).get();
const instructorById = new Map(instructorSnapshot.docs.map((document) => [
  String(document.data()?.userId || ""), String(document.data()?.displayName || ""),
]));

console.log("");
console.log("날짜        강사        회원        쓴 회원권(차수·만료)        썼어야 할 회원권(차수·만료)");
console.log("".padEnd(108, "-"));
const day = (at) => (at ? at.toISOString().slice(0, 10) : "날짜없음");
for (const row of rows) {
  console.log([
    day(row.occurredAt),
    (instructorById.get(row.instructorId) || row.instructorId).padEnd(10).slice(0, 10),
    (nameById.get(row.clientId) || row.clientId).padEnd(10).slice(0, 10),
    `${row.usedPassId} (${row.usedRound ?? "?"}차 · ${day(row.usedExpiresAt)})`.padEnd(28),
    `${row.shouldPassId} (${row.shouldRound ?? "?"}차 · ${day(row.shouldExpiresAt)})`,
  ].join(" "));
}

/* ── --client: 한 회원의 회원권을 전부 펼친다 ──────────────────────────
   "왜 저 회원권이 안 빠졌나" 는 순서만 봐서는 답이 안 나온다. 거름망에서
   떨어졌을 수도 있기 때문이다 (잔여 0 · 비활성 · 2:1 카테고리 · 짝이 적힌
   1:1). 그 셋은 정렬을 바꿔도 후보에 없다.

   그래서 **필드를 그대로** 찍는다. 정규화한 판정만 보여 주면 원인을 확정할
   수 없다 -- 상품명에 "3차" 가 적혀 있어도 purchaseRound 가 비어 있으면
   코드는 그것을 모르고, 그 차이는 원본 값에서만 보인다. */
const wanted = String(options.client || "").trim();
if (wanted) {
  const ids = new Set([...nameById.entries()]
    .filter(([id, name]) => id === wanted || name === wanted)
    .map(([id]) => id));
  if (ids.size === 0) {
    console.log("");
    console.log(`"${wanted}" 로 회원을 찾지 못했습니다. 이름이 정확한지, 센터가 맞는지 보세요.`);
  } else {
    console.log("");
    console.log(`── ${wanted} 의 회원권 (거름망 그대로) ──`);
    console.log("회원권        상품명              종류   차수      잔여  상태      만료일      후보?");
    console.log("".padEnd(104, "-"));
    const mine = passes.filter((item) => ids.has(String(item?.clientId || ""))
      || (Array.isArray(item?.clientIds) && item.clientIds.some((id) => ids.has(String(id)))));
    for (const item of mine) {
      const kind = candidateKind(item);
      const round = item?.purchaseRound;
      const remaining = Number(item?.remainingCount);
      const status = String(item?.status || "");
      const at = item?.expiresAt;
      const expiry = typeof at?.toDate === "function" ? at.toDate() : (at ? new Date(String(at)) : null);
      const live = Number.isFinite(expiry?.getTime?.()) ? expiry : null;
      /* 1:1 수업 기준으로 후보인가. 막은 것이 무엇인지 하나만 적는다 --
         여럿이면 앞의 것부터다. */
      const blocked = kind !== "solo" ? kind
        : status !== "active" ? `상태 ${status || "없음"}`
          : !(remaining > 0) ? "잔여 0"
            : (live && live.getTime() < Date.now()) ? "만료됨" : "";
      console.log([
        String(item.id).padEnd(13).slice(0, 13),
        String(item?.productId || "").padEnd(19).slice(0, 19),
        String(item?.category || "").padEnd(6).slice(0, 6),
        (Number.isInteger(Number(round)) && Number(round) > 0 ? `${round}차` : "**비어있음**").padEnd(9),
        String(Number.isFinite(remaining) ? remaining : "?").padStart(4),
        `  ${status.padEnd(8).slice(0, 8)}`,
        (live ? live.toISOString().slice(0, 10) : "없음").padEnd(11),
        blocked ? `아니오 (${blocked})` : "예",
      ].join(" "));
    }
    console.log("");
    console.log("차수가 **비어있음** 이면 차수 순 정렬에서 그 회원권은 맨 뒤로 밀렸습니다 --");
    console.log("상품명에 차수가 적혀 있어도 필드가 비어 있으면 코드는 그것을 모릅니다.");
    console.log("후보가 '아니오' 면 순서를 바꿔도 빠지지 않습니다. 그 갈래는 정렬로 고쳐지지 않습니다.");
  }
}

console.log("");
console.log(JSON.stringify(summarizeOrderAudit(rows), null, 2));
console.log("");
console.log("**고치지 않습니다.** 원장은 append-only 라 지난 항목을 옮길 수 없습니다.");
console.log("고치려면 보정 항목을 쌓고 다시 차감해야 하고, 그것은 회원과 이야기한 뒤 정할 일입니다.");
console.log("당장 할 수 있는 것은 위 '썼어야 할 회원권' 의 만료일을 미루는 쪽입니다 (회원권 수정).");
