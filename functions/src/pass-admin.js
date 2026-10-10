"use strict";

/**
 * 세션업과 회원 간 양도 — **대표와 FC매니저가 쓰는 통로다.**
 *
 * ── 왜 서버인가 ──
 * 규칙은 양도(handover 항목)를 대표에게만 연다. FC매니저에게도 열려면 규칙을
 * 고쳐야 하는데, 규칙은 한 번 나가면 그 사이의 모든 쓰기에 적용된다. 세션업은
 * passes 의 totalSessions 를 바꾸는데 그 칸은 아예 막혀 있다.
 *
 * Admin SDK 는 규칙을 우회한다. 그래서 규칙은 계속 "대표만" 이라고 말하고,
 * 그 예외는 여기 두 함수뿐이다 -- migration-reset · service-session-fix 와 같은
 * 판단이다. 예외를 문이 아니라 통로로 둔다.
 *
 * ── 판정은 앱과 같은 파일이 한다 ──
 * 금액도 막는 이유도 functions/shared 의 모듈이 정한다. 앱이 미리보기에 띄운
 * 숫자와 서버가 박는 숫자가 같아야 하고, 두 벌로 두면 언젠가 한쪽만 고쳐진다.
 * 그때 어긋나는 것이 금액이면 원장은 append-only 라 되돌릴 수 없다.
 *
 * **앱이 보낸 금액은 받지 않는다.** 회차와 받는 사람만 받고 금액은 서버가 다시
 * 센다 -- 앱이 보낸 값을 믿으면 그것은 잠긴 문이 아니다.
 *
 * ── 권한은 여기서 본다 ──
 * 화면이 버튼을 감추는 것은 안내이고, 막는 것은 여기다. 화면만 믿으면 호출
 * 한 번으로 지나간다.
 */

/**
 * 서버 센티넬(`increment` · `serverTimestamp`). **모듈을 읽을 때 부르지 않는다.**
 *
 * firebase-admin 은 `functions/node_modules` 에만 있다. CI 는 저장소 루트에서만
 * `npm install` 하므로 그 폴더가 **아예 없고**, 루트에서 도는 테스트가 이 파일을
 * 읽는 순간 `MODULE_NOT_FOUND` 로 죽는다 -- TAP 줄도 못 내고 죽어서 "not ok" 로는
 * 잡히지도 않는다. 2026-10-03 Codemagic 이 그렇게 멈췄다.
 *
 * service-session-fix.js 는 같은 이유로 FieldValue 를 아예 안 쓴다. 여기는
 * 증감 센티넬이 꼭 필요하다 -- 같은 회원권에 차감과 양도가 겹치면 읽어서 뺀 쪽이
 * 다른 쪽을 지운다. 그래서 없애는 대신 **쓰는 순간에** 부른다.
 *
 * 테스트는 자기 것을 넣는다. 가짜 저장소가 "읽어서 빼지 않았다" 를 실제로 볼 수
 * 있어야 하기 때문이다.
 */
const sentinels = (input) => input?.fieldValue
  || require("firebase-admin/firestore").FieldValue;

/* functions/ 는 CommonJS 이고 shared/ 는 ESM 이다. 핸들러 안에서 한 번 읽고
   들고 있는다 -- src/data/schema/constants.js 머리말과 같은 이유다. */
let sharedModules = null;
async function shared() {
  if (!sharedModules) {
    const [sessionUp, transfer, payRates, constants] = await Promise.all([
      import("../shared/session-up.mjs"),
      import("../shared/pass-transfer.mjs"),
      import("../shared/pay-rates.mjs"),
      import("../shared/constants.mjs"),
    ]);
    sharedModules = { ...sessionUp, ...transfer, ...payRates, ...constants };
  }
  return sharedModules;
}

const text = (value) => String(value ?? "").trim();
const count = (value) => (Number.isInteger(Number(value)) && Number(value) >= 0 ? Number(value) : 0);

/** 운영하는 역할만 쓴다. 강사는 어느 쪽도 못 한다.
    총괄매니저는 대표와 같은 자리다 (규칙의 ownerLevel). */
const PASS_ADMIN_ROLES = Object.freeze(["owner", "area_manager", "manager"]);

/** 센터를 운영하는 사람인가. 퇴사한 사람은 역할이 남아 있어도 아니다. */
const isPassAdmin = (membership) => Boolean(membership)
  && membership.status === "active"
  && PASS_ADMIN_ROLES.includes(text(membership.role));

/** 왜 거부됐는가. 코드 없는 "할 수 없습니다" 를 남기지 않는다. */
const ADMIN_ERROR = Object.freeze({
  NOT_FOUND: "pass_not_found",
  TARGET_NOT_FOUND: "transfer_target_not_found",
  INSTRUCTOR_REQUIRED: "transfer_instructor_required",
  EXPIRES_INVALID: "transfer_expires_invalid",
});

/** Firestore Timestamp 든 ISO 문자열이든 Date 로. 못 읽으면 Invalid Date 다. */
const asDate = (value) => {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  return value instanceof Date ? value : new Date(value);
};

/**
 * 세션업. 같은 회원권의 회차와 계약 금액을 함께 늘린다.
 *
 * 숫자는 planSessionUp 하나가 센다 -- 화면의 전/후 표도 같은 함수를 쓴다.
 * 둘이 갈라지면 대표가 본 숫자와 박히는 숫자가 다르고, 그때는 원장이 이미
 * 쌓인 뒤다.
 *
 * @param {any} firestore
 * @param {{
 *   organizationId: string, passId: string, actorId: string,
 *   addSessions: number, addPrice: number, addService?: number,
 *   expiresAt?: Date | null, paymentMethod?: string, now?: () => Date,
 * }} input
 */
async function runSessionUp(firestore, input) {
  const { planSessionUp, sessionUpError } = await shared();
  const FieldValue = sentinels(input);
  const organizationId = text(input?.organizationId);
  const passId = text(input?.passId);
  const at = (input?.now || (() => new Date()))();
  const org = firestore.collection("organizations").doc(organizationId);
  const reference = org.collection("passes").doc(passId);

  const snapshot = await reference.get();
  if (!snapshot.exists) throw new Error(ADMIN_ERROR.NOT_FOUND);
  const pass = snapshot.data() || {};

  const refused = sessionUpError({ pass, ...input });
  if (refused) throw new Error(refused);

  const { before, after } = planSessionUp({ pass, ...input });

  /* 회원권과 원장이 한 배치다. 하나라도 빠지면 회차가 근거 없이 생기거나
     늘어난 사실이 어디에도 남지 않는다. */
  const batch = firestore.batch();
  batch.update(reference, {
    totalSessions: after.totalSessions,
    serviceSessions: after.serviceSessions,
    remainingCount: after.remainingCount,
    contractPrice: after.contractPrice,
    ...(after.baseUnitPrice === null ? {} : { baseUnitPrice: after.baseUnitPrice }),
    ...(after.expiresAt ? { expiresAt: after.expiresAt } : {}),
  });

  /* 원장 항목. 돈이 오가고 회차가 늘어난 사실이 남아야 한다 -- 반년 뒤
     "왜 150회가 됐나" 에 답할 것이 이것뿐이다.

     delta 는 늘어난 잔여다. 급여에는 잡히지 않는다 (PAYROLL_ENTRY_TYPES 가
     허용 목록이라 애초에 질의에 걸리지 않는다). */
  const entryId = `${passId}_sessionup_${at.getTime()}`;
  batch.set(reference.collection("ledger").doc(entryId), {
    organizationId,
    passId,
    clientId: text(pass.clientId),
    locationId: text(pass.locationId),
    type: "sessionup",
    delta: after.remainingCount - before.remainingCount,
    addedSessions: count(input?.addSessions),
    addedService: count(input?.addService),
    addedPrice: count(input?.addPrice),
    fromTotalSessions: before.totalSessions,
    ...(text(input?.paymentMethod) ? { paymentMethod: text(input.paymentMethod) } : {}),
    instructorId: text(pass.instructorId),
    occurredAt: at,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: text(input?.actorId),
  });
  await batch.commit();
  return { passId, before, after, entryId };
}

/**
 * 회원 간 양도. **남은 회차 일부가 다른 회원의 새 회원권이 된다.**
 *
 * 하는 일은 pass-repository 의 transferPass 와 같다 -- 같은 판정 모듈을 쓰고
 * 같은 네 문서를 한 배치로 쓴다. 바뀐 것은 누가 부를 수 있는가뿐이다.
 *
 * 테스트가 두 경로의 결과를 견준다. 갈라지면 같은 버튼이 누가 눌렀느냐에 따라
 * 다른 금액을 박는다는 뜻이고, 원장은 append-only 라 고칠 수 없다.
 */
async function runHandover(firestore, input) {
  const {
    PASS_STATUS, PAY_CATEGORY, LEDGER_ENTRY_TYPE,
    checkTransfer, transferPricing, resolveUnitPrice, TRANSFER_BLOCK,
  } = await shared();

  const FieldValue = sentinels(input);
  const organizationId = text(input?.organizationId);
  const passId = text(input?.passId);
  const toClientId = text(input?.toClientId);
  const at = (input?.now || (() => new Date()))();
  const org = firestore.collection("organizations").doc(organizationId);
  const source = org.collection("passes").doc(passId);

  const snapshot = await source.get();
  if (!snapshot.exists) throw new Error(ADMIN_ERROR.NOT_FOUND);
  const pass = { id: passId, ...(snapshot.data() || {}) };

  /* 받는 회원이 이 센터에 있는가. 앱이 명부에서 골라 보내지만 id 는 그냥
     문자열이라, 없는 회원에게 넘기면 회차가 아무도 못 보는 자리로 간다. */
  const target = await org.collection("clients").doc(toClientId).get();
  if (!target.exists) throw new Error(ADMIN_ERROR.TARGET_NOT_FOUND);

  /* 막히는 이유는 코드로 나간다. 화면이 "듀엣이라 안 된다" 와 "회차가
     모자란다" 를 다른 문구로 말할 수 있어야 한다. */
  const allowed = checkTransfer({ pass, toClientId, sessions: input?.sessions });
  if (!allowed.ok) throw new Error(allowed.code);
  const sessions = Number(allowed.sessions);

  /* 부원장 단가가 원본과 정확히 같아지지 않으면 쓰지 않는다. 비슷한 값으로
     넘기면 그 차이가 원장에 박히고, 원장은 고칠 수 없다. */
  const priced = transferPricing({ pass, sessions });
  if (!priced.exact) throw new Error(TRANSFER_BLOCK.NO_PRICE);

  const instructorId = text(input?.instructorId) || text(pass.instructorId);
  if (!instructorId) throw new Error(ADMIN_ERROR.INSTRUCTOR_REQUIRED);

  /* 만료일은 원본 그대로다. 넘겼다고 기한이 늘어나지 않는다. 읽히지 않는
     값은 여기서 멈춘다 -- 그대로 쓰면 받는 회원권의 만료일이 비고, 그것이
     회원이 가장 자주 묻는 값이다. */
  const expiresAt = asDate(pass.expiresAt);
  if (!Number.isFinite(expiresAt?.getTime?.())) throw new Error(ADMIN_ERROR.EXPIRES_INVALID);

  const baseUnitPrice = resolveUnitPrice(PAY_CATEGORY.PT_1_1_NEW, {
    unitPrice: input?.unitPrice,
    fullRoomRate: input?.fullRoomRate,
  });

  const newPassId = text(input?.newPassId) || `pass-${at.getTime()}`;
  const issueEntryId = `${newPassId}_issue`;
  /* 받는 회원권의 id 를 붙여 두면 같은 원본에서 두 번 양도해도 서로 다른
     자리로 간다. */
  const handoverEntryId = `${newPassId}_handover`;

  /* 새 회원권의 필드 집합은 발급과 같아야 한다 -- 규칙의 hasAll 목록이 둘을
     같이 보기 때문이다. 이 통로는 규칙을 우회하지만, 우회한 문서가 규칙을
     지나온 문서와 모양이 다르면 나중에 그 회원권만 못 고친다. */
  const newPass = {
    organizationId,
    clientId: toClientId,
    clientIds: [toClientId],
    locationId: text(pass.locationId),
    productId: text(pass.productId),
    category: PAY_CATEGORY.PT_1_1_NEW,
    totalSessions: sessions,
    // 서비스 회차는 넘기지 않는다. 센터가 얹어 준 것이라 회원 사이에서 오가지 않는다.
    serviceSessions: 0,
    contractPrice: priced.contractPrice,
    netContractPrice: priced.netContractPrice,
    paymentMethod: priced.paymentMethod,
    purchaseRound: count(input?.purchaseRound) || 1,
    remainingCount: sessions,
    expiresAt,
    handedOver: false,
    baseUnitPrice,
    serviceUsed: 0,
    instructorId,
    status: PASS_STATUS.ACTIVE,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: text(input?.actorId),
  };

  const batch = firestore.batch();
  /* 읽어서 빼지 않는다. 서버가 더한다 -- 같은 회원권에 차감과 양도가 겹쳐도
     한쪽이 다른 쪽을 덮어쓰지 않는다. */
  batch.update(source, { remainingCount: FieldValue.increment(-sessions) });
  batch.set(source.collection("ledger").doc(handoverEntryId), {
    organizationId,
    passId,
    clientId: text(pass.clientId),
    locationId: text(pass.locationId),
    type: LEDGER_ENTRY_TYPE.HANDOVER,
    delta: -sessions,
    /* 어디로 갔는가. 이것이 없으면 회차가 줄어든 사실만 남고 그 회차가
       어디로 갔는지는 아무도 모른다. */
    toPassId: newPassId,
    toClientId,
    instructorId: text(pass.instructorId) || instructorId,
    occurredAt: at,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: text(input?.actorId),
  });

  const newPassRef = org.collection("passes").doc(newPassId);
  batch.set(newPassRef, newPass);
  batch.set(newPassRef.collection("ledger").doc(issueEntryId), {
    organizationId,
    passId: newPassId,
    clientId: toClientId,
    locationId: text(pass.locationId),
    type: LEDGER_ENTRY_TYPE.ISSUE,
    delta: sessions,
    category: PAY_CATEGORY.PT_1_1_NEW,
    unitPrice: baseUnitPrice,
    instructorId,
    occurredAt: at,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: text(input?.actorId),
  });

  await batch.commit();
  return { passId: newPassId, issueEntryId, handoverEntryId, sessions, pass: newPass, pricing: priced };
}

module.exports = {
  ADMIN_ERROR,
  PASS_ADMIN_ROLES,
  isPassAdmin,
  runHandover,
  runSessionUp,
};
