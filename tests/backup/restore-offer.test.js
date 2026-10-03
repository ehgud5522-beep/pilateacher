import assert from "node:assert/strict";
import test from "node:test";

import {
  RESTORE_OFFER, backupPaused, canOverwriteBackup, isCentreAccount,
  restoreOfferDecision, restorePreview,
} from "../../src/features/backup/restore-offer.js";
import { mergeRoster } from "../../src/features/roster/roster-bridge.js";

/**
 * "이 계정의 기록을 불러올까요?" 를 누구에게 띄우는가.
 *
 * 이 파일이 지키는 것은 둘이다.
 *
 * 하나. **센터 소속 강사에게는 묻지 않는다.** 그 기기가 비어 있는 것은 사고가
 * 아니다 -- 회원도 회원권도 원장도 서버에 있다.
 *
 * 둘. **묻지 않는다고 백업이 멈추면 안 된다.** 그러면 그 강사는 백업되는 줄
 * 알고 쓰는데 아무것도 안 올라간다. 수업기록 원문과 체형사진은 이 백업 말고
 * 사본이 없다.
 */

const centre = { ready: true, organizationId: "bonita", role: "instructor", isLegacy: false, status: "active" };
const personal = { ready: true, organizationId: "", role: "", isLegacy: true, status: "" };
const unresolved = { ready: false, organizationId: "", isLegacy: false, status: "" };
const lookupFailed = { ready: true, organizationId: "", isLegacy: false, status: "unknown" };

const newPhone = { hasCloudData: true, hasLocalData: false, decisionMade: false };

/* ── 누가 센터 소속인가 ──────────────────────────────────────────────────── */

test("only a resolved centre membership counts as a centre account", () => {
  assert.equal(isCentreAccount(centre), true);
  assert.equal(isCentreAccount(personal), false);
  /* 아직 모르는 것과 센터가 아닌 것은 다르다. 이 둘을 같이 다루면 조회가
     끝나기 전에 개인 모드로 단정하게 되고, 그것이 2026-10-04 에 난 일이다. */
  assert.equal(isCentreAccount(unresolved), false);
  assert.equal(isCentreAccount(lookupFailed), false);
  assert.equal(isCentreAccount(null), false);
  assert.equal(isCentreAccount({ ready: true, organizationId: "   " }), false);
});

/* ── 띄울 것인가 ─────────────────────────────────────────────────────────── */

test("a centre instructor on a new phone is never asked", () => {
  /* 정확히 대표가 본 상황이다: 센터 소속 + 옛 개인 백업 있음 + 새 폰. */
  assert.equal(restoreOfferDecision({ organization: centre, ...newPhone }), RESTORE_OFFER.SKIP);
});

test("a personal instructor on a new phone is still asked", () => {
  /* 개인 모드에서는 이 백업이 유일한 안전망이다. 묻지 않으면 복구할 길이 없다. */
  assert.equal(restoreOfferDecision({ organization: personal, ...newPhone }), RESTORE_OFFER.SHOW);
});

test("nothing is asked while the membership is still being read", () => {
  /* 계정을 읽는 것이 소속 조회보다 먼저 끝난다. 그 틈에 물으면 센터 소속인지
     모르는 채로 묻는 것이다. */
  assert.equal(restoreOfferDecision({ organization: unresolved, ...newPhone }), RESTORE_OFFER.WAIT);
});

test("a failed membership lookup asks nothing either", () => {
  /* 모르면 묻지 않는다. 틀리게 묻는 쪽이 안 묻는 쪽보다 나쁘다 -- 옛 기록은
     지워지지 않고 메뉴에 남아 있어서, 안 물어서 잃는 것이 없다. */
  assert.equal(restoreOfferDecision({ organization: lookupFailed, ...newPhone }), RESTORE_OFFER.SKIP);
});

test("there is nothing to ask when the cloud is empty or the phone is not", () => {
  assert.equal(
    restoreOfferDecision({ organization: personal, ...newPhone, hasCloudData: false }),
    RESTORE_OFFER.SKIP,
  );
  assert.equal(
    restoreOfferDecision({ organization: personal, ...newPhone, hasLocalData: true }),
    RESTORE_OFFER.SKIP,
  );
});

test("a decision already made is not asked again", () => {
  assert.equal(
    restoreOfferDecision({ organization: personal, ...newPhone, decisionMade: true }),
    RESTORE_OFFER.SKIP,
  );
});

test("an empty cloud never waits on the membership", () => {
  /* 물을 것이 없으면 소속을 기다릴 이유도 없다. 기다리면 그동안 백업이 멈춘다. */
  assert.equal(
    restoreOfferDecision({ organization: unresolved, ...newPhone, hasCloudData: false }),
    RESTORE_OFFER.SKIP,
  );
});

/* ── 백업이 멈추는가 ─────────────────────────────────────────────────────── */

test("the backup pauses while something is still being asked", () => {
  for (const organization of [centre, personal]) {
    assert.equal(backupPaused({ decision: RESTORE_OFFER.SHOW, organization, ...newPhone }), true);
    assert.equal(backupPaused({ decision: RESTORE_OFFER.WAIT, organization, ...newPhone }), true);
  }
});

test("a centre instructor on a new phone keeps backing up", () => {
  /* 이것이 이 변경의 핵심이다. 묻지 않기로 한 계정에서 백업이 멈춘 채 남으면
     화면만 조용해지고 데이터는 그대로 위험하다 -- 수업기록 원문과 체형사진은
     이 백업 말고 사본이 없다. */
  const decision = restoreOfferDecision({ organization: centre, ...newPhone });
  assert.equal(decision, RESTORE_OFFER.SKIP);
  assert.equal(backupPaused({ decision, organization: centre, ...newPhone }), false);
});

test("a personal instructor who chose to start fresh stays paused", () => {
  /* 올리면 16명짜리 기록 위에 빈 기기를 덮는다. 거기서는 기기가 원본이라
     이 판단이 맞다 -- 센터 소속과 가르는 지점이다. */
  const input = { organization: personal, ...newPhone, decisionMade: true };
  const decision = restoreOfferDecision(input);
  assert.equal(decision, RESTORE_OFFER.SKIP, "다시 묻지는 않는다");
  assert.equal(backupPaused({ decision, ...input }), true, "그래도 올리지는 않는다");
});

test("a personal instructor with data on the phone backs up normally", () => {
  const input = { organization: personal, hasCloudData: true, hasLocalData: true, decisionMade: true };
  const decision = restoreOfferDecision(input);
  assert.equal(backupPaused({ decision, ...input }), false);
});

test("a failed lookup does not leave the backup paused forever", () => {
  /* 조회 실패는 끝난 상태다 -- 다시 읽기 전까지 바뀌지 않는다. 여기서 멈추면
     영영 멈춘다. 다만 기기가 비었으면 개인 모드일 가능성이 남아 있어 올리지
     않는다. 기기에 쓰기 시작하면 그때부터 올라간다. */
  const decision = restoreOfferDecision({ organization: lookupFailed, ...newPhone });
  assert.equal(decision, RESTORE_OFFER.SKIP);
  assert.equal(backupPaused({ decision, organization: lookupFailed, ...newPhone }), true);
  assert.equal(
    backupPaused({ decision, organization: lookupFailed, hasCloudData: true, hasLocalData: true }),
    false,
  );
});

/* ── 덮어쓰기 보호 ───────────────────────────────────────────────────────── */

test("only a centre account may push past the mass-decrease guard", () => {
  /* 보호 장치는 "기기 회원이 갑자기 줄었다" 를 사고로 본다. 센터 소속에서는
     명부 원본이 서버라 신호가 아니다 -- 새 폰이면 당연히 적다.

     개인 모드에서는 그대로 막아야 한다. 거기서는 기기가 원본이고, 줄어든 것은
     실제로 잃은 것이다. */
  assert.equal(canOverwriteBackup(centre), true);
  assert.equal(canOverwriteBackup(personal), false);
  assert.equal(canOverwriteBackup(unresolved), false, "모르면 밀어붙이지 않는다");
  assert.equal(canOverwriteBackup(lookupFailed), false);
});

/* ── 불러오기 전에 보여 줄 것 ────────────────────────────────────────────── */

test("the preview counts what the restore will replace", () => {
  /* 메뉴에서 찾아온 길이라도 묻지 않고 덮으면 안 된다. 불러오기는 병합이
     아니라 통째 교체다. */
  const preview = restorePreview({
    local: {
      members: [{ id: "a", notes: [{ id: "n1" }] }],
      schedule: [{ id: "s1" }, { id: "s2" }],
    },
    cloud: {
      members: [
        { id: "a", notes: [{ id: "n1" }, { id: "n2" }] },
        { id: "b", notes: [] },
      ],
      schedule: [{ id: "s9" }],
    },
    photoCount: 12,
  });

  assert.deepEqual(preview.members, { before: 1, after: 2 });
  assert.deepEqual(preview.sessions, { before: 2, after: 1 }, "줄어드는 것도 그대로 보여준다");
  assert.deepEqual(preview.notes, { before: 1, after: 2 });
  assert.equal(preview.photos.after, 12);
});

test("the preview survives a backup with nothing readable in it", () => {
  /* 옛 백업은 스키마가 지금과 다를 수 있다. 미리보기가 거기서 죽으면 복구할
     길 자체가 닫힌다. */
  const preview = restorePreview({});
  assert.deepEqual(preview.members, { before: 0, after: 0 });
  assert.deepEqual(preview.sessions, { before: 0, after: 0 });
  assert.deepEqual(preview.notes, { before: 0, after: 0 });
  assert.equal(preview.photos.after, 0);

  const broken = restorePreview({ cloud: { members: "열여섯명", schedule: null }, photoCount: "많음" });
  assert.deepEqual(broken.members, { before: 0, after: 0 });
  assert.equal(broken.photos.after, 0);
});

/* ── 대표가 본 그 상황 ───────────────────────────────────────────────────
   센터 소속 강사 + 옛 개인 백업 있음 + 새 폰. 세 가지가 한 번에 맞아야 한다 --
   따로 통과하고 합쳐서 틀리는 자리이기 때문이다. */

test("a centre instructor on a new phone: no dialog, backup runs, no name mixing", () => {
  const organization = centre;
  const shape = { hasCloudData: true, hasLocalData: false };

  // 1. 묻지 않는다.
  const decision = restoreOfferDecision({ organization, ...shape, decisionMade: false });
  assert.equal(decision, RESTORE_OFFER.SKIP, "센터 소속에게는 창을 띄우지 않는다");

  // 2. 그런데 백업은 돈다. 이 둘이 갈라지면 조용히 사본 없는 폰이 된다.
  assert.equal(backupPaused({ decision, organization, ...shape }), false);

  /* 3. 덮어쓰기 보호에 걸려도 창이 다시 뜨지 않는다 -- 밀고 지나간다.
        그 전에 옛 백업을 옮겨 두는 것은 App 이 한다 (fbPreservePreviousBackup). */
  assert.equal(canOverwriteBackup(organization), true);

  /* 4. 옛 백업을 불러오더라도 동명이인이 섞이지 않는다. 연락처가 다르면
        남남이다 -- 기기에만 있는 수업기록과 사진이 엉뚱한 센터 회원에게
        붙으면 되돌릴 방법이 없다. */
  const { roster, unlinkedLocal } = mergeRoster({
    clients: [{ id: "c-real", name: "김하나", phone: "01011112222", status: "active" }],
    members: [{ id: "m-old", name: "김하나", phone: "01099998888", notes: [{ id: "n1" }] }],
    passes: [],
    hideUnlinked: true,
    now: new Date(2026, 9, 4),
  });
  assert.deepEqual(roster.map((item) => item.id), ["c-real"], "옛 기기 회원은 명부에 끼지 않는다");
  assert.equal(roster[0].notes.length, 0, "남의 수업기록이 붙지 않는다");
  assert.deepEqual(unlinkedLocal.map((item) => item.id), ["m-old"], "그래도 지워지지는 않는다");
});

test("the same person with the same phone still comes back together", () => {
  /* 섞이지 않게 하는 것과 되살리지 못하게 하는 것은 다르다. 연락처가 같으면
     같은 사람이고, 옛 폰의 수업기록이 그 회원에게 다시 붙어야 한다 -- 폰을
     바꾼 강사가 불러오기를 누르는 이유가 그것이다. */
  const { roster } = mergeRoster({
    clients: [{ id: "c-real", name: "김하나", phone: "01011112222", status: "active" }],
    members: [{ id: "m-old", name: "김하나", phone: "01011112222", notes: [{ id: "n1" }, { id: "n2" }] }],
    passes: [],
    hideUnlinked: true,
    now: new Date(2026, 9, 4),
  });
  assert.equal(roster.length, 1);
  assert.equal(roster[0].id, "m-old", "기기 쪽 id 로 이어진다 -- 노트와 사진이 그 id 에 달려 있다");
  assert.equal(roster[0].orgClientId, "c-real");
  assert.equal(roster[0].notes.length, 2);
});
