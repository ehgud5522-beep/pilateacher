"use strict";

/* 강사 개인매출 인센 확정 (2026-11-21 대표: "강사 입력 + FC · 대표 입력이 같아야 확정"). 두 쪽이 같을 때만 · 자기 매출 확정 금지 · FC 는 맡은 지점. */
const assert = require("node:assert/strict");
const test = require("node:test");
const { createSalesConfirmService } = require("../src/sales-confirm");

function fake(seed) {
  const docs = new Map(Object.entries(seed));
  const writes = [];
  const snap = (path) => ({ id: path.split("/").pop(), exists: docs.has(path), data: () => docs.get(path) });
  const query = (path, filters) => ({
    where: (field, _op, value) => query(path, [...filters, [field, value]]),
    get: async () => ({ docs: [...docs.keys()]
      .filter((key) => key.startsWith(`${path}/`) && key.split("/").length === path.split("/").length + 1)
      .map(snap).filter((row) => filters.every(([field, value]) => row.data()[field] === value)) }),
  });
  const collectionRef = (path) => ({ doc: (id) => docRef(`${path}/${id}`), where: (field, op, value) => query(path, []).where(field, op, value) });
  const docRef = (path) => ({
    get: async () => snap(path),
    set: async (data, options) => {
      if (failPrefix && path.startsWith(failPrefix)) throw Object.assign(new Error("boom"), { code: "unavailable" });
      writes.push({ path, data }); docs.set(path, options?.merge ? { ...(docs.get(path) || {}), ...data } : data);
    },
    collection: (name) => collectionRef(`${path}/${name}`),
  });
  let failPrefix = "";
  return {
    writes, docs, failWritesTo: (prefix) => { failPrefix = prefix; },
    doc: docRef,
    collection: collectionRef,
  };
}

const ORG = "o1";
const entry = (id, side, extra = {}) => [`organizations/${ORG}/salesEntries/${id}`, {
  organizationId: ORG, instructorId: "t1", month: "2026-11", paidOn: "2026-11-05", side,
  kind: "repurchase", amount: 4200000, share: 1, ot: false, clientId: "c1", memberLabel: "", recordId: "p1_issue", refundOfMonth: "", ...extra,
}];
const member = (userId, role, extra = {}) => ({ organizationId: ORG, userId, role, status: "active", ...extra });
const base = (extra = {}) => ({
  "memberships/o1_owner": member("owner", "owner", { displayName: "대표" }),
  "memberships/o1_area": member("area", "area_manager", { displayName: "총괄" }),
  "memberships/o1_fc": member("fc", "manager", { locationId: "yulha", displayName: "박에프씨" }),
  "memberships/o1_fc2": member("fc2", "manager", { locationId: "jwadong" }),
  "memberships/o1_t1": member("t1", "instructor", { locationId: "yulha", displayName: "정예진" }),
  ...extra,
});
const service = (store) => createSalesConfirmService({
  firestore: store, membershipId: (org, uid) => `${org}_${uid}`, isOwnerLevel: (membership) => ["owner", "area_manager"].includes(membership?.role),
  now: () => new Date("2026-12-02T01:00:00Z"),
});
const confirm = (store, callerUid, extra = {}) => service(store).confirm({ callerUid, organizationId: ORG, instructorId: "t1", month: "2026-11", ...extra });

test("두 쪽이 같으면 확정하고 그때의 숫자를 남긴다", async () => {
  const store = fake(base(Object.fromEntries([entry("a", "instructor"), entry("b", "office")])));
  const result = await confirm(store, "owner");
  assert.equal(result.status, "confirmed");
  assert.deepEqual(result.snapshot, { total: 4200000, otBonus: 0, groupBase: 0, groupBonus: 0, bracketAmount: 160000, incentive: 160000, clawbackTotal: 0, payout: 160000, entryCount: 1 });
  const month = store.docs.get(`organizations/${ORG}/salesMonths/t1_2026-11`);
  assert.equal(month.status, "confirmed");
  assert.equal(month.confirmedBy, "owner");
});

test("금액이 다르거나 한쪽만 넣었으면 거절하고, 어긋난 줄을 그 달 문서에 남긴다", async () => {
  const store = fake(base(Object.fromEntries([
    entry("a", "instructor"), entry("b", "office", { amount: 4000000 }),
    entry("c", "instructor", { clientId: "c2", recordId: "p2_issue" }),
  ])));
  await assert.rejects(confirm(store, "owner"), (error) => error.reason === "sides_differ" && error.details.differs === 1 && error.details.instructor_only === 1);
  const month = store.docs.get(`organizations/${ORG}/salesMonths/t1_2026-11`);
  assert.notEqual(month.status, "confirmed");
  assert.deepEqual(month.lastCheck.instructorEntryIds.sort(), ["a", "c"]);
  assert.deepEqual(month.lastCheck.officeEntryIds, ["b"]);
});

test("아무도 안 넣은 달도 확정할 수 있다 (매출 0 확인)", async () => {
  const result = await confirm(fake(base()), "owner");
  assert.equal(result.snapshot.total, 0);
});

test("자기 매출은 자기가 확정 못 함 · 강사 · 남의 지점 FC 거절 · 맡은 지점 FC 는 됨", async () => {
  const pairOf = () => Object.fromEntries([entry("a", "instructor"), entry("b", "office")]);
  await assert.rejects(confirm(fake(base(pairOf())), "t1"), (error) => error.reason === "own_sales");
  await assert.rejects(confirm(fake(base({ ...pairOf(), "memberships/o1_t2": { role: "instructor", status: "active" } })), "t2"), (error) => error.reason === "not_confirmer");
  await assert.rejects(confirm(fake(base(pairOf())), "fc2"), (error) => error.reason === "out_of_scope");
  assert.equal((await confirm(fake(base(pairOf())), "fc")).status, "confirmed");
});

test("이미 확정된 달은 다시 확정하지 않는다 · 잘못된 달은 거절", async () => {
  const store = fake(base({ [`organizations/${ORG}/salesMonths/t1_2026-11`]: { status: "confirmed" } }));
  await assert.rejects(confirm(store, "owner"), (error) => error.reason === "already_confirmed");
  await assert.rejects(confirm(fake(base()), "owner", { month: "11월" }), (error) => error.reason === "target_required");
});

test("지난달 결제 환불은 그 달 줄로 환수를 계산해 숫자에 넣는다", async () => {
  const october = (id, side, extra) => entry(id, side, { month: "2026-10", paidOn: "2026-10-10", recordId: `${id}_r`, ...extra });
  const store = fake(base(Object.fromEntries([
    october("o1", "instructor", { amount: 6700000, recordId: "oct" }), october("o2", "office", { amount: 6700000, recordId: "oct" }),
    entry("r1", "instructor", { kind: "refund", amount: 1500000, refundOfMonth: "2026-10", recordId: "" }),
    entry("r2", "office", { kind: "refund", amount: 1500000, refundOfMonth: "2026-10", recordId: "" }),
  ])));
  const result = await confirm(store, "owner");
  /* 10월 670만 → 36만, 환불 뒤 520만 → 25만: 환수 11만. 11월 자체 매출 0 → payout -11만 (다음 달로 넘겨 뺄 금액) */
  assert.equal(result.snapshot.clawbackTotal, 110000);
  assert.equal(result.snapshot.payout, -110000);
});

test("그룹 회원(명부에 없음)도 두 장부 이름이 맞으면 확정, 0.5% 가 숫자에 남는다", async () => {
  const group = (id, side, label) => entry(id, side, { kind: "group", amount: 2000000, clientId: "", memberLabel: label, recordId: "" });
  const store = fake(base(Object.fromEntries([group("g1", "instructor", "김민지 회원"), group("g2", "office", "김민지")])));
  const result = await confirm(store, "owner");
  assert.equal(result.snapshot.groupBonus, 10000);
  assert.equal(result.snapshot.total, 0, "그룹은 개인 구간 합계에 안 든다");
});

test("FC 단독 확정 + 대표 · 총괄 알림함에 한 줄 (확정한 본인 · 강사에게는 안 감, 회원 이름 없음)", async () => {
  const store = fake(base(Object.fromEntries([entry("a", "instructor", { ot: true }), entry("b", "office", { ot: true })])));
  const result = await confirm(store, "fc");
  assert.equal(result.status, "confirmed");
  assert.deepEqual(result.notified, { sent: 2, errorCode: "" });
  const inbox = store.writes.filter((write) => write.path.includes("/inbox/"));
  assert.deepEqual(inbox.map((write) => write.path.split("/")[1]).sort(), ["area", "owner"]);
  const notice = inbox[0].data;
  assert.equal(notice.kind, "sales_confirmed");
  assert.equal(notice.title, "[매출 인센 확정]");
  assert.equal(notice.body, "박에프씨 님이 정예진 강사의 2026년 11월 매출 인센을 확정했어요 · 지급 580,000원 (개인 160,000원 · OT 420,000원) · 매출 4,200,000원");
  assert.doesNotMatch(JSON.stringify(inbox), /c1|김/, "회원 id · 이름 없음");
});

test("대표가 확정하면 총괄에게만 알림 · 알림을 못 보내도 확정은 그대로", async () => {
  const pairOf = () => Object.fromEntries([entry("a", "instructor"), entry("b", "office")]);
  const store = fake(base(pairOf()));
  const result = await confirm(store, "owner");
  assert.deepEqual(store.writes.filter((write) => write.path.includes("/inbox/")).map((write) => write.path.split("/")[1]), ["area"]);
  assert.equal(result.notified.sent, 1);

  const broken = fake(base(pairOf()));
  broken.failWritesTo("users/");
  const logs = [];
  const quiet = createSalesConfirmService({
    firestore: broken, membershipId: (org, uid) => `${org}_${uid}`, isOwnerLevel: (membership) => ["owner", "area_manager"].includes(membership?.role),
    now: () => new Date("2026-12-02T01:00:00Z"), log: (level, event, fields) => logs.push({ level, event, fields }),
  });
  const kept = await quiet.confirm({ callerUid: "fc", organizationId: ORG, instructorId: "t1", month: "2026-11" });
  assert.equal(kept.status, "confirmed");
  assert.deepEqual(kept.notified, { sent: 0, errorCode: "unavailable" });
  assert.equal(broken.docs.get(`organizations/${ORG}/salesMonths/t1_2026-11`).status, "confirmed");
  assert.equal(logs[0].event, "sales_confirm_notice_failed");
  assert.equal(logs[0].fields.errorCode, "unavailable");
});
