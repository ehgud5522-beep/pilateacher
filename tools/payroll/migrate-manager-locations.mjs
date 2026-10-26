/**
 * FC매니저 소속 문서에 `locationIds` 를 심는다. **기본은 dry-run 이다.**
 *
 *   node tools/payroll/migrate-manager-locations.mjs --organization bonita
 *   node tools/payroll/migrate-manager-locations.mjs --organization bonita --write
 *
 * ── 무엇을 하는가 ──
 * role 이 manager 인 소속 문서만 본다. `locationIds` 가 이미 있으면 건드리지
 * 않고, 없으면 `locationIds = [locationId]` 한 줄을 더한다. **옛 필드는 지우지
 * 않는다** -- 업데이트하지 않은 폰이 아직 그것만 읽고, 지우면 그 폰에서 그
 * 사람의 지점이 통째로 사라진다.
 *
 * ── 둘 다 비어 있으면 건드리지 않는다 ──
 * 어느 지점인지 모르는 것을 짐작해서 심으면 그 FC매니저는 **남의 지점**을
 * 보게 된다. 그런 문서는 목록으로만 뽑고 사람이 먼저 지정한다 (대표 결정 8항).
 *
 * ── 지우는 길은 없다 ──
 * --write 는 더하기만 한다. 되돌릴 일이 생기면 강사 관리 화면에서 고친다.
 */

import { openFirestore } from "./admin-sdk.mjs";

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

const options = parseArgs(process.argv.slice(2));
const organizationId = String(options.organization || "").trim();
if (!organizationId) {
  console.error("--organization 이 필요합니다. 예: --organization bonita");
  process.exit(1);
}
const write = options.write === true;

const firestore = await openFirestore({ key: typeof options.key === "string" ? options.key : undefined });

console.log(`센터  : ${organizationId}`);
console.log(`모드  : ${write ? "**쓰기**" : "dry-run (아무것도 바꾸지 않습니다)"}`);
console.log("");

const locationSnapshot = await firestore.collection(`organizations/${organizationId}/locations`).get();
const locationNames = new Map(locationSnapshot.docs.map((document) => [
  document.id, String(document.data()?.name || document.id),
]));
const nameOf = (id) => locationNames.get(String(id || "")) || String(id || "");

const snapshot = await firestore.collection("memberships")
  .where("organizationId", "==", organizationId)
  .where("role", "==", "manager")
  .get();

const rows = snapshot.docs.map((document) => {
  const data = document.data() || {};
  const many = Array.isArray(data.locationIds)
    ? data.locationIds.map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];
  const one = String(data.locationId ?? "").trim();
  return {
    id: document.id,
    displayName: String(data.displayName || ""),
    status: String(data.status || ""),
    before: many,
    locationId: one,
    /* 이미 있으면 건드리지 않는다. 사람이 손으로 고친 값일 수 있고, 덮으면
       그 수정이 조용히 사라진다. */
    plan: many.length > 0 ? "그대로" : (one ? "심는다" : "**지점 없음 -- 사람이 먼저 지정**"),
    after: many.length > 0 ? many : (one ? [one] : []),
  };
});

console.log(`FC매니저 소속 ${rows.length}건.`);
console.log("");
console.log("이름        상태      전                        →  후                        판정");
console.log("".padEnd(104, "-"));
for (const row of rows) {
  const before = row.before.length ? row.before.map(nameOf).join(" · ") : (row.locationId ? `(한 칸) ${nameOf(row.locationId)}` : "(없음)");
  const after = row.after.length ? row.after.map(nameOf).join(" · ") : "(없음)";
  console.log([
    (row.displayName || row.id).padEnd(10).slice(0, 10),
    row.status.padEnd(8).slice(0, 8),
    before.padEnd(24).slice(0, 24),
    "→ ",
    after.padEnd(24).slice(0, 24),
    row.plan,
  ].join(" "));
}

const toWrite = rows.filter((row) => row.plan === "심는다");
const blocked = rows.filter((row) => row.plan.startsWith("**"));

console.log("");
if (blocked.length) {
  console.log("── 지점이 없어 건너뛴 FC매니저 ──");
  console.log("짐작해서 심으면 그 사람은 **남의 지점**을 보게 됩니다. 강사 관리 화면에서");
  console.log("먼저 지점을 지정한 뒤 이 스크립트를 다시 돌리세요.");
  for (const row of blocked) console.log(`  ${row.displayName || row.id}`);
  console.log("");
}

if (!write) {
  console.log(`dry-run 입니다. 심을 것 ${toWrite.length}건 -- 실제로 쓰려면 --write 를 붙이세요.`);
} else if (toWrite.length === 0) {
  console.log("심을 것이 없습니다.");
} else {
  for (const row of toWrite) {
    await firestore.doc(`memberships/${row.id}`).update({ locationIds: row.after });
    console.log(`  심음: ${row.displayName || row.id} → ${row.after.map(nameOf).join(" · ")}`);
  }
  console.log("");
  console.log(`${toWrite.length}건에 locationIds 를 심었습니다. 옛 locationId 는 그대로 둡니다.`);
}

console.log("");
console.log(JSON.stringify({
  managers: rows.length,
  alreadyHad: rows.filter((row) => row.plan === "그대로").length,
  planted: write ? toWrite.length : 0,
  wouldPlant: write ? 0 : toWrite.length,
  skippedNoLocation: blocked.length,
}, null, 2));
