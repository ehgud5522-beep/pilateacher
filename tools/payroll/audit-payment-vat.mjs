/**
 * 결제수단 정리 · 부가세 기준 정정의 **영향 범위만** 읽는다. 쓰기는 없다.
 *
 *   node tools/payroll/audit-payment-vat.mjs
 *   node tools/payroll/audit-payment-vat.mjs --organization bonita --out report.txt
 *
 * ── 두 가지를 답한다 (2026-10-27 대표 요청) ──
 *
 * ① 부가세 기준이 바뀌어 **공급가액이 달라지는 회원권**. 담당이 부원장인
 *    것만 센다 -- netContractPrice 를 쓰는 판정은 부원장 5:5 하나뿐이라,
 *    나머지 회원권은 값이 달라져도 급여가 움직이지 않는다.
 *
 * ② 제로페이 · 바우처 → 기타결제 **변환 대상**.
 *
 * ── 왜 읽기만 하는가 ──
 * 이미 발급된 회원권의 netContractPrice 는 발급 시점에 박힌 값이고, 그것을
 * 고치면 그 회원권의 지난 차감과 앞으로의 차감이 서로 다른 근거로 계산된다.
 * 바로잡을지 말지는 대표가 정한다 (2026-10-27).
 */

import { writeFileSync } from "node:fs";
import { openFirestore } from "./admin-sdk.mjs";
import {
  PAYMENT_INCLUDES_VAT, netContractPriceFor,
} from "../../functions/shared/deduction-pricing.mjs";
import { LEGACY_PAYMENT_METHOD } from "../../functions/shared/constants.mjs";

const parseArgs = (argv) => {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) continue;
    const name = key.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) { options[name] = true; continue; }
    options[name] = next;
    index += 1;
  }
  return options;
};

/* 2026-10-27 전의 표. "무엇이 달라지는가" 는 두 표를 견주지 않으면 답할 수
   없고, 말로 적어 두면 다음에 표가 움직일 때 아무도 모른다. */
const BEFORE = Object.freeze({
  card: true, cash: false, transfer: false, other: false, zeropay: false, voucher: false,
});

const won = (value) => Number(value || 0).toLocaleString("ko-KR");
const options = parseArgs(process.argv.slice(2));
const firestore = await openFirestore({ key: typeof options.key === "string" ? options.key : undefined });

const organizationIds = typeof options.organization === "string"
  ? [options.organization]
  : (await firestore.collection("organizations").get()).docs.map((document) => document.id);

const lines = [];
const say = (text = "") => { lines.push(text); console.log(text); };

for (const organizationId of organizationIds) {
  say(`센터: ${organizationId}`);
  say("=".repeat(60));

  const members = new Map();
  const membershipSnapshot = await firestore.collection("memberships")
    .where("organizationId", "==", organizationId).get();
  for (const document of membershipSnapshot.docs) {
    const data = document.data() || {};
    members.set(String(data.userId || document.id), {
      name: String(data.displayName || data.userId || document.id),
      deputy: data.isDeputyDirector === true,
    });
  }
  const deputies = [...members.entries()].filter(([, member]) => member.deputy);
  say(`소속 ${membershipSnapshot.size}명 · 부원장 ${deputies.length}명` +
    (deputies.length ? ` (${deputies.map(([, member]) => member.name).join(", ")})` : ""));

  const clients = new Map();
  const clientSnapshot = await firestore.collection(`organizations/${organizationId}/clients`).get();
  for (const document of clientSnapshot.docs) {
    clients.set(document.id, String(document.data()?.name || document.id));
  }

  const passSnapshot = await firestore.collection(`organizations/${organizationId}/passes`).get();
  say(`회원권 ${passSnapshot.size}건`);
  say("");

  /* ── 결제수단별 분포 ─────────────────────────────────────────────── */
  const byMethod = new Map();
  const legacyRows = [];
  const movedRows = [];
  const legacyMethods = new Set(Object.values(LEGACY_PAYMENT_METHOD));

  for (const document of passSnapshot.docs) {
    const pass = document.data() || {};
    const method = String(pass.paymentMethod || "(없음)");
    const status = String(pass.status || "");
    const bucket = byMethod.get(method) || { total: 0, active: 0 };
    bucket.total += 1;
    if (status === "active") bucket.active += 1;
    byMethod.set(method, bucket);

    const clientName = clients.get(String(pass.clientId || "")) || String(pass.clientId || "");
    const instructor = members.get(String(pass.instructorId || ""));

    if (legacyMethods.has(method)) {
      legacyRows.push({
        passId: document.id, clientName, method, status,
        contractPrice: Number(pass.contractPrice || 0),
        note: String(pass.paymentNote || ""),
      });
    }

    /* ① 공급가액이 달라지는가. 두 표의 답이 다르면 달라진다. */
    const was = BEFORE[method];
    const now = PAYMENT_INCLUDES_VAT[method];
    if (was === undefined || now === undefined || was === now) continue;
    /* 부원장이 아닌 것도 담는다. **지금은 급여가 안 움직여도** 담당이 나중에
       부원장이 되면 그때부터 이 회원권의 남은 회차가 5:5 로 가고, 박혀 있는
       값이 그 분자가 된다. 대표가 "지금 0건" 과 "앞으로 0건" 을 구별할 수
       있어야 한다. */

    const contractPrice = Number(pass.contractPrice || 0);
    if (!Number.isInteger(contractPrice) || contractPrice <= 0) continue;
    const stored = Number.isInteger(pass.netContractPrice) ? pass.netContractPrice : null;
    let recomputed = null;
    try { recomputed = netContractPriceFor(contractPrice, method); } catch { recomputed = null; }
    const totalSessions = Number(pass.totalSessions || 0);
    const unitOf = (net) => (totalSessions > 0 && net !== null
      ? Math.round(net / totalSessions / 2) : null);
    movedRows.push({
      passId: document.id,
      clientName,
      instructorName: instructor?.name || String(pass.instructorId || "(없음)"),
      deputy: instructor?.deputy === true,
      method,
      status,
      remainingCount: Number(pass.remainingCount || 0),
      totalSessions,
      contractPrice,
      stored,
      recomputed,
      storedUnit: unitOf(stored),
      recomputedUnit: unitOf(recomputed),
    });
  }

  say("── 결제수단 분포 ──────────────────────────────────────────");
  for (const [method, bucket] of [...byMethod.entries()].sort((a, b) => b[1].total - a[1].total)) {
    say(`  ${method.padEnd(10)} ${String(bucket.total).padStart(5)}건 (활성 ${bucket.active})`);
  }
  say("");

  say("── ② 제로페이 · 바우처 → 기타결제 변환 대상 ───────────────");
  say(`  모두 ${legacyRows.length}건`);
  for (const row of legacyRows) {
    say(`  ${row.passId} · ${row.clientName} · ${row.method} · ${row.status} · ${won(row.contractPrice)}원`);
  }
  say("");

  say("── ① 부가세 기준 정정으로 공급가액이 달라지는 회원권 ──");
  const deputyRows = movedRows.filter((row) => row.deputy);
  say(`  모두 ${movedRows.length}건 · 그중 담당이 부원장인 것 ${deputyRows.length}건`);
  say("  (부원장이 아니면 지금 급여는 움직이지 않는다. 담당이 나중에 부원장이");
  say("   되면 그때부터 박혀 있는 값이 5:5 의 분자가 된다.)");
  let storedSum = 0;
  let recomputedSum = 0;
  for (const row of movedRows) {
    storedSum += row.stored ?? 0;
    recomputedSum += row.recomputed ?? 0;
    say(`  ${row.passId} · ${row.clientName} · 담당 ${row.instructorName}${row.deputy ? " (부원장)" : ""} · ${row.method} · ${row.status}`);
    say(`      계약 ${won(row.contractPrice)} · 총 ${row.totalSessions}회 · 잔여 ${row.remainingCount}회`);
    say(`      기준금액 ${won(row.stored)} → ${won(row.recomputed)}` +
      ` (차이 ${won((row.recomputed ?? 0) - (row.stored ?? 0))})`);
    say(`      부원장 회당 ${won(row.storedUnit)} → ${won(row.recomputedUnit)}`);
  }
  if (movedRows.length > 0) {
    say(`  기준금액 합계 ${won(storedSum)} → ${won(recomputedSum)} (차이 ${won(recomputedSum - storedSum)})`);
  }
  say("");
}

if (typeof options.out === "string") {
  writeFileSync(options.out, `${lines.join("\n")}\n`, "utf8");
  console.log(`파일: ${options.out}`);
}
