"use strict";

/**
 * 2026-10 이관분 보정 — **한 번 쓰고 지울 통로다.**
 *
 * ── 무엇이 틀어졌나 ──
 * 엑셀의 총세션 칸에 서비스 회차가 섞여 들어왔다. "깍두기 40회e" 를 43회로
 * 적고 서비스세션에 3을 또 적은 식이다. 그래서 두 가지가 틀어졌다.
 *
 *   회당 금액   계약금액 ÷ 총세션 이라 43으로 나눠 낮게 박혔다
 *   서비스      상품 횟수 안에 한 번, 서비스세션 칸에 또 한 번 세어졌다
 *
 * 그리고 이관은 serviceUsed 를 0 으로 넣었다. 이관 전에 서비스를 이미 쓰신
 * 분은 **이관 후 첫 수업이 다시 서비스로 빠진다** -- 센터가 같은 회차를 두 번
 * 지원하고 강사는 그만큼 받는다.
 *
 * ── 대상을 이름으로 적지 않는다 ──
 * 고칠 회원권 목록을 코드에 박지 않는다. 이름도 연락처도 적지 않고(§7),
 * **조건으로 찾는다**: 상품명의 숫자 + 서비스세션 = 총세션인 회원권.
 *
 * 그 조건이 곧 증상이다. 목록을 박아 두면 열 건이 맞는지 아무도 다시 세지
 * 못하고, 열한 번째가 있어도 영영 모른다. 조건으로 찾으면 미리보기 숫자가
 * 그 자체로 답이 된다.
 *
 * serviceUsed 도 같은 자리에서 나온다. 서비스부터 쓰는 규칙이라
 * (deduction-pricing 의 spendsServiceSession) 쓴 횟수에서 정해진다:
 *
 *   쓴 횟수     = (새 총세션 + 서비스세션) - 남은횟수
 *   serviceUsed = min(서비스세션, 쓴 횟수)
 *
 * 이관 전에 다 쓰신 분은 자연히 서비스 개수와 같아지고, 한 번도 안 쓰신 분은
 * 0 이 된다. 지점으로 가르지 않아도 데이터가 그렇게 말한다.
 *
 * ── 왜 서버인가 ──
 * passes 의 update 규칙은 totalSessions 와 serviceSessions 를 못 건드린다.
 * 한 번 쓰는 보정을 위해 그 문을 여는 것은 그 문이 영원히 열려 있게 되는
 * 일이다. Admin SDK 는 규칙을 우회하므로 규칙은 계속 닫아 두고 예외를 통로로
 * 둔다 -- migration-reset.js 와 같은 판단이다.
 *
 * ── 원장을 지우지 않는다 ──
 * 이미 나간 차감은 그대로 둔다. append-only 이고 그 회차는 실제로 일어난
 * 수업이다. 바꾸는 것은 회원권 문서의 숫자뿐이고, 바꾼 사실은 감사 로그에
 * 남는다. 잘못 지급된 급여는 대표가 보정 항목으로 처리한다 -- 이 함수는 그
 * 판단을 대신하지 않는다.
 *
 * ── 남은횟수를 건드리지 않는다 ──
 * 회원이 몇 회 남았는지는 센터와 회원이 합의한 숫자다. 총세션이 틀렸다고 그
 * 숫자까지 흔들면 회원에게 "원래 몇 회였는지" 를 다시 설명해야 한다.
 */

const MIGRATED_PREFIX = "csv_";

const text = (value) => String(value ?? "").trim();
const count = (value) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Math.floor(Number(value)) : 0);

/** 엑셀 이관으로 만들어진 회원권인가. */
const isMigrated = (passId) => text(passId).startsWith(MIGRATED_PREFIX);

/**
 * 상품명에 적힌 횟수. 숫자가 여럿이면 맨 뒤의 것이다 -- "2:1 PT 33회 ->100회
 * 세션업" 은 100회를 판 것이다. 없으면 null 이고, 그때는 고치지 않는다.
 */
function sessionsInName(productName) {
  const found = [...String(productName ?? "").matchAll(/(\d+)\s*회/g)].map((match) => Number(match[1]));
  return found.length ? found[found.length - 1] : null;
}

/**
 * 이 회원권의 총세션에 서비스가 섞여 있는가. **이것이 대상 판정이다.**
 *
 * migration-repository 의 totalLooksLikeItIncludesService 와 같은 규칙이다.
 * 거기서는 다음 이관을 막고, 여기서는 이미 들어온 것을 고친다.
 */
function needsFix(pass) {
  const service = count(pass?.serviceSessions);
  const total = count(pass?.totalSessions);
  const sold = sessionsInName(pass?.productId);
  if (service <= 0 || total <= 0 || sold === null) return false;
  return sold + service === total;
}

/**
 * 회당 금액을 다시 센다. **총세션이 바뀌면 분모가 바뀐다.**
 *
 * 계약 금액은 그대로다 -- 회원이 낸 돈은 변하지 않는다. 바뀌는 것은 그 돈을
 * 몇 회로 나누는가이고, 서비스 회차는 분모에서 빠진다 (낸 돈이 아니다).
 */
function unitPriceFor(contractPrice, totalSessions) {
  /* Number(null) 은 0 이다. 그대로 두면 "계약 금액을 못 읽었다" 가 "0원에
     팔았다" 가 되고, 그 회원권의 모든 수업이 무보수로 기록된다. */
  if (contractPrice === null || contractPrice === undefined || contractPrice === "") return null;
  const price = Number(contractPrice);
  const total = Number(totalSessions);
  if (!Number.isFinite(price) || !Number.isFinite(total) || total <= 0) return null;
  return Math.round(price / total);
}

/** 이관 전에 이미 쓴 서비스. 서비스부터 쓰는 규칙에서 정해진다. */
function serviceUsedFor({ totalSessions, serviceSessions, remainingCount }) {
  const spent = count(totalSessions) + count(serviceSessions) - count(remainingCount);
  return Math.max(0, Math.min(count(serviceSessions), spent));
}

/**
 * 무엇이 어떻게 바뀌는가. **아무것도 쓰지 않는다.**
 *
 * @param {any} firestore
 * @param {{ organizationId: string }} input
 */
async function planServiceSessionFix(firestore, { organizationId }) {
  const org = firestore.collection("organizations").doc(text(organizationId));
  const passes = await org.collection("passes").get();
  const rows = [];

  for (const snapshot of passes.docs) {
    if (!isMigrated(snapshot.id)) continue;
    const before = snapshot.data() || {};
    if (!needsFix(before)) continue;

    const totalSessions = sessionsInName(before.productId);
    const serviceSessions = count(before.serviceSessions);
    const remainingCount = count(before.remainingCount);
    const after = {
      totalSessions,
      serviceSessions,
      serviceUsed: serviceUsedFor({ totalSessions, serviceSessions, remainingCount }),
      baseUnitPrice: unitPriceFor(before.contractPrice, totalSessions),
      /* 남은횟수는 건드리지 않는다. 회원과 합의한 숫자다. */
      remainingCount,
    };
    /* 이미 고쳐진 것은 목록에 올리지 않는다. 두 번 돌려도 같은 결과여야
       한다 -- 대표가 버튼을 두 번 누를 수 있다. */
    if (count(before.totalSessions) === after.totalSessions
      && count(before.serviceUsed) === after.serviceUsed
      && count(before.baseUnitPrice) === count(after.baseUnitPrice)) continue;

    rows.push({
      passId: snapshot.id,
      /* id 만 올린다. 이름은 화면이 자기 목록에서 붙인다 -- 서버 로그에
         이름이 남으면 안 된다 (§7). */
      clientId: text(before.clientId),
      locationId: text(before.locationId),
      instructorId: text(before.instructorId),
      productId: text(before.productId),
      before: {
        totalSessions: count(before.totalSessions),
        serviceSessions: count(before.serviceSessions),
        serviceUsed: count(before.serviceUsed),
        baseUnitPrice: count(before.baseUnitPrice),
        remainingCount,
      },
      after,
    });
  }
  return { organizationId: text(organizationId), rows, counts: { passes: rows.length } };
}

/**
 * 이 회원권들에서 서비스로 확정된 수업. **보고만 한다.**
 *
 * serviceUsed 가 0 이었던 탓에 이관 후 첫 수업이 다시 서비스로 빠졌을 수
 * 있다. 센터가 같은 회차를 두 번 지원한 것이다.
 *
 * 되돌리지 않는다 -- 원장은 append-only 이고 그 수업은 실제로 일어났다.
 * 보정 항목을 넣을지는 대표가 정한다.
 */
async function findServiceDeductions(firestore, { organizationId, passIds, since = null }) {
  const org = firestore.collection("organizations").doc(text(organizationId));
  const found = [];
  for (const passId of passIds) {
    const entries = await org.collection("passes").doc(passId).collection("ledger").get();
    for (const entry of entries.docs) {
      const data = entry.data() || {};
      if (text(data.type) !== "deduct" || text(data.category) !== "service") continue;
      const raw = data.occurredAt;
      const at = raw?.toDate ? raw.toDate() : new Date(String(raw || ""));
      const readable = Number.isFinite(at?.getTime());
      /* 읽지 못한 날짜는 빼지 않는다. 날짜를 모른다고 없던 일이 되지는
         않으므로, 대표가 보고 판단하게 올린다. */
      if (since && readable && at < since) continue;
      found.push({
        passId,
        entryId: entry.id,
        occurredAt: readable ? at.toISOString() : "",
        unitPrice: count(data.unitPrice),
        instructorId: text(data.instructorId),
      });
    }
  }
  return found;
}

/**
 * 실제로 고친다. 미리보기와 **같은 계획**을 쓴다.
 *
 * @param {any} firestore
 * @param {{ organizationId: string, actorId: string, now?: () => Date }} input
 */
async function runServiceSessionFix(firestore, { organizationId, actorId, now = () => new Date() }) {
  const at = now();
  const plan = await planServiceSessionFix(firestore, { organizationId });
  const org = `organizations/${plan.organizationId}`;

  if (plan.rows.length) {
    const batch = firestore.batch();
    for (const row of plan.rows) {
      batch.update(firestore.doc(`${org}/passes/${row.passId}`), {
        totalSessions: row.after.totalSessions,
        serviceSessions: row.after.serviceSessions,
        serviceUsed: row.after.serviceUsed,
        /* 계약 금액을 못 읽으면 단가를 건드리지 않는다. 0 으로 박으면 그
           회원권의 모든 수업이 무보수로 기록된다. */
        ...(row.after.baseUnitPrice === null ? {} : { baseUnitPrice: row.after.baseUnitPrice }),
      });
    }
    await batch.commit();
  }

  /* 감사 로그 한 줄. 규칙이 막는 칸을 서버가 고친 유일한 경우라 그 사실이
     남아야 한다. 이름은 적지 않는다 (§7). */
  await firestore.collection("auditLogs").doc().set({
    organizationId: plan.organizationId,
    actorId: text(actorId),
    actorRole: "owner",
    action: "service_session_fix",
    createdAt: at,
    clientId: "",
    targetId: plan.rows.map((row) => row.passId).join(","),
  });

  return { fixed: plan.rows.length, rows: plan.rows };
}

module.exports = {
  findServiceDeductions,
  needsFix,
  planServiceSessionFix,
  runServiceSessionFix,
  serviceUsedFor,
  sessionsInName,
  unitPriceFor,
};
