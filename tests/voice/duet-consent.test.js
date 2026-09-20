import assert from "node:assert/strict";
import test from "node:test";
import {
  consentTargetsFor, ensureEveryConsent, missingConsentMessage,
} from "../../src/features/voice/duet-consent.js";

const granted = async () => ({ ok: true });
const refused = async () => ({ ok: false, code: "consent_required" });

const duet = {
  memberId: "m-1", memberName: "김하나",
  duetPartner: { id: "m-2", name: "박두리" },
};

/* ── 누구에게 물어야 하는가 ───────────────────────────────────────────── */

test("a 1:1 lesson asks one person", () => {
  const targets = consentTargetsFor({ memberId: "m-1", memberName: "김하나" });
  assert.deepEqual(targets, [{ id: "m-1", name: "김하나" }]);
});

test("a duet lesson asks both, the anchor first", () => {
  /* 순서가 늘 같아야 강사가 두 번째 이름이 짝이라는 것을 따로 배우지 않는다. */
  assert.deepEqual(consentTargetsFor(duet), [
    { id: "m-1", name: "김하나" },
    { id: "m-2", name: "박두리" },
  ]);
});

test("a partner that is really the same person is not asked twice", () => {
  /* 한 번 거절하면 두 번 거절한 것으로 세어져 "김하나 님, 김하나 님" 이 된다. */
  const targets = consentTargetsFor({ memberId: "m-1", memberName: "김하나", duetPartner: { id: "m-1" } });
  assert.equal(targets.length, 1);
});

test("a nameless member still gets asked, under a word the screen can print", () => {
  assert.equal(consentTargetsFor({ memberId: "m-1" })[0].name, "회원");
  assert.equal(consentTargetsFor({ memberId: "m-1", duetPartner: { id: "m-2" } })[1].name, "듀엣 상대");
  // 회원이 없으면 물을 사람이 없다.
  assert.deepEqual(consentTargetsFor({}), []);
});

/* ── 한 명이라도 없으면 막는다 ────────────────────────────────────────── */

test("both consented means the recording may start", async () => {
  const result = await ensureEveryConsent(consentTargetsFor(duet), granted);
  assert.equal(result.ok, true);
  assert.deepEqual(result.missing, []);
});

test("one consent is not enough for a duet", async () => {
  /* 수업기록에 두 사람 이야기가 같이 들어간다. 대표가 동의했다는 사실은 짝에
     대해 아무것도 말해 주지 않는다. */
  const result = await ensureEveryConsent(
    consentTargetsFor(duet),
    async (id) => (id === "m-1" ? { ok: true } : { ok: false, code: "consent_required" }),
  );
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing.map((item) => item.id), ["m-2"]);
});

test("the screen is told who has not consented, by name", async () => {
  // "동의가 필요합니다" 한 줄이면 강사는 둘 중 누구에게 물어야 하는지 모른다.
  const result = await ensureEveryConsent(
    consentTargetsFor(duet),
    async (id) => (id === "m-1" ? { ok: true } : { ok: false }),
  );
  assert.match(result.message, /박두리/);
  assert.doesNotMatch(result.message, /김하나/, "동의한 사람의 이름을 부르지 않는다");
});

test("when neither consented the message says so in one go", async () => {
  /* 한 명씩 알려 주면 첫 번째를 받아 온 뒤 두 번째에서 또 막히고, 그때는 이미
     회원 둘이 매트에 누워 있다. */
  const result = await ensureEveryConsent(consentTargetsFor(duet), refused);
  assert.deepEqual(result.missing.map((item) => item.id), ["m-1", "m-2"]);
  assert.match(result.message, /김하나/);
  assert.match(result.message, /박두리/);
  assert.match(result.message, /두 분 모두/);
});

test("everyone is checked, so one refusal does not hide the next", async () => {
  const asked = [];
  await ensureEveryConsent(consentTargetsFor(duet), async (id) => { asked.push(id); return { ok: false }; });
  assert.deepEqual(asked, ["m-1", "m-2"]);
});

/* ── 모르는 것은 있는 것으로 세지 않는다 ──────────────────────────────── */

test("a consent check that threw counts as no consent, keeping its own code", async () => {
  /* 확인하지 못한 것을 동의한 것으로 세면 동의 없는 기록이 올라간다. 그리고
     로그인이 끊긴 것과 동의가 없는 것은 강사가 할 일이 다르다. */
  const result = await ensureEveryConsent(consentTargetsFor(duet), async (id) => {
    if (id === "m-1") throw Object.assign(new Error("gone"), { code: "auth/unauthenticated" });
    return { ok: true };
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "auth/unauthenticated");
});

test("no one to ask is refused rather than waved through", async () => {
  const result = await ensureEveryConsent([], granted);
  assert.equal(result.ok, false);
  assert.match(result.message, /회원을 먼저 선택/);
});

/* ── 문구 ─────────────────────────────────────────────────────────────── */

test("the wording tells a duet apart from a single member", () => {
  assert.match(missingConsentMessage([{ name: "김하나" }], 1), /^김하나 님의/);
  assert.match(missingConsentMessage([{ name: "박두리" }], 2), /듀엣 수업은 두 분 모두/);
  assert.match(missingConsentMessage([], 1), /동의가 필요합니다/);
});
