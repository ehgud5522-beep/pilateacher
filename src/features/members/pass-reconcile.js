/**
 * 잔여 점검 — 원장의 합과 회원권의 잔여가 같은가.
 *
 * ── 왜 필요한가 ──
 * 잔여(`passes.remainingCount`)와 원장은 **따로 산다.** 잔여는 회원권 문서의
 * 숫자 하나이고, 원장은 그 숫자가 왜 그렇게 되었는지를 적은 줄들이다. 둘은
 * 늘 같은 배치에서 함께 쓰이지만, 배치가 아닌 길로 한쪽만 바뀌면 어긋난다 --
 * 그리고 원장은 덧붙이기만 하므로 그 어긋남은 **고칠 수 없다.**
 *
 * 어긋난 회원권은 두 가지를 동시에 망가뜨린다. 회원은 화면에서 틀린 잔여를
 * 보고, 대표는 급여를 원장으로 계산한다. 둘이 다른 숫자를 믿는다.
 *
 * ── 고치지 않는다 ──
 * 여기는 세기만 한다. 자동으로 맞추면 **어느 쪽이 참인지 모른 채** 한쪽을
 * 덮어쓰게 된다. 잔여가 맞고 원장이 빠진 것일 수도, 그 반대일 수도 있다.
 * 사람이 보고 `adjust` 로 맞춘다 -- 그러면 맞춘 사실도 원장에 남는다.
 *
 * ── 부호 ──
 * `delta` 는 이미 부호가 실려 있다. 그래서 식은 단순한 합이다.
 *
 *   issue      +N   발급한 회차
 *   deduct     -1   수업 한 번
 *   correction +1   잘못 누른 차감을 되돌림
 *   handover   -N   양도로 나감
 *   cancel     -N   남은 회차를 거둠
 *   transfer    0   담당 강사만 바뀜
 *   adjust     ±N   숫자 맞추기
 *   expiry      0   만료일만 옮김
 *
 * 종류별로 더하고 빼는 표를 따로 두지 않는다. 종류가 하나 늘 때마다 그 표를
 * 같이 고쳐야 하고, 안 고치면 새 종류가 **조용히 0 으로 세어진다.**
 */

/** 셀 수 없는 회원권. "안 맞는다" 와 다르다. */
export const RECONCILE_STATE = Object.freeze({
  MATCHED: "matched",
  MISMATCHED: "mismatched",
  UNKNOWN: "unknown",
});

/** 왜 셀 수 없었는가. 코드 없는 "확인 불가" 를 남기지 않는다. */
export const RECONCILE_UNKNOWN = Object.freeze({
  NO_LEDGER: "no_ledger",
  UNREADABLE_DELTA: "unreadable_delta",
  UNREADABLE_REMAINING: "unreadable_remaining",
});

const text = (value) => String(value ?? "").trim();
const isCount = (value) => typeof value === "number" && Number.isInteger(value);

/**
 * 원장의 합. 하나라도 읽을 수 없으면 `null` 이다.
 *
 * 읽을 수 없는 줄을 0 으로 치고 넘어가면 합이 조용히 틀리고, 그 회원권은
 * "안 맞는다" 로 보고된다 -- 실제로는 우리가 못 읽은 것뿐인데 대표는 장부가
 * 깨진 줄 알고 찾아 나선다.
 */
export function ledgerTotal(entries) {
  if (!Array.isArray(entries) || !entries.length) return null;
  let total = 0;
  for (const entry of entries) {
    const delta = entry?.delta;
    if (!isCount(delta)) return null;
    total += delta;
  }
  return total;
}

/**
 * 회원권 하나를 견준다.
 *
 * @param {any} pass 회원권 문서
 * @param {Array<any>} entries 그 회원권의 원장 항목 전부
 */
export function reconcilePass(pass, entries) {
  const passId = text(pass?.id || pass?.passId);
  const remaining = pass?.remainingCount;
  const row = {
    passId,
    clientId: text(pass?.clientId),
    remainingCount: isCount(remaining) ? remaining : null,
    ledgerTotal: ledgerTotal(entries),
    entryCount: Array.isArray(entries) ? entries.length : 0,
  };

  if (!isCount(remaining)) {
    return { ...row, state: RECONCILE_STATE.UNKNOWN, unknownReason: RECONCILE_UNKNOWN.UNREADABLE_REMAINING, difference: null };
  }
  if (!Array.isArray(entries) || !entries.length) {
    /* 원장이 없는 회원권이 있다. 이 앱이 생기기 전에 만들어진 것들이고,
       없는 것을 "합계 0" 으로 치면 전부 안 맞는 것으로 보고된다. */
    return { ...row, state: RECONCILE_STATE.UNKNOWN, unknownReason: RECONCILE_UNKNOWN.NO_LEDGER, difference: null };
  }
  if (row.ledgerTotal === null) {
    return { ...row, state: RECONCILE_STATE.UNKNOWN, unknownReason: RECONCILE_UNKNOWN.UNREADABLE_DELTA, difference: null };
  }

  const difference = remaining - row.ledgerTotal;
  return {
    ...row,
    difference,
    state: difference === 0 ? RECONCILE_STATE.MATCHED : RECONCILE_STATE.MISMATCHED,
    unknownReason: "",
  };
}

/**
 * 센터 전체. 안 맞는 것이 위로 온다 -- 대표가 보는 순간 할 일이 먼저 보여야
 * 한다.
 *
 * @param {Array<{ pass: any, entries: Array<any> }>} rows
 * @param {{ nameOf?: (clientId: string) => string }} [options]
 */
export function reconcileReport(rows, options = {}) {
  const nameOf = options.nameOf || (() => "");
  const checked = (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const result = reconcilePass(row?.pass, row?.entries);
      return { ...result, clientName: text(nameOf(result.clientId)) };
    })
    .filter((row) => row.passId);

  const order = { [RECONCILE_STATE.MISMATCHED]: 0, [RECONCILE_STATE.UNKNOWN]: 1, [RECONCILE_STATE.MATCHED]: 2 };
  checked.sort((a, b) => {
    if (order[a.state] !== order[b.state]) return order[a.state] - order[b.state];
    /* 차이가 큰 것부터. 1회 어긋난 것과 20회 어긋난 것은 급한 정도가 다르다. */
    return Math.abs(b.difference ?? 0) - Math.abs(a.difference ?? 0);
  });

  return {
    total: checked.length,
    matched: checked.filter((row) => row.state === RECONCILE_STATE.MATCHED).length,
    mismatched: checked.filter((row) => row.state === RECONCILE_STATE.MISMATCHED).length,
    unknown: checked.filter((row) => row.state === RECONCILE_STATE.UNKNOWN).length,
    rows: checked,
  };
}

/** 대표 화면에 보일 한 줄. 숫자를 감추지 않는다. */
export function reconcileMessage(report) {
  const total = Number(report?.total) || 0;
  if (!total) return "점검할 회원권이 없습니다.";
  const mismatched = Number(report?.mismatched) || 0;
  const unknown = Number(report?.unknown) || 0;
  if (!mismatched && !unknown) return `회원권 ${total}건 모두 원장과 맞습니다.`;
  const parts = [];
  if (mismatched) parts.push(`안 맞음 ${mismatched}건`);
  if (unknown) parts.push(`확인 불가 ${unknown}건`);
  return `회원권 ${total}건 중 ${parts.join(" · ")}.`;
}

/**
 * 많이 틀렸으면 **우리를 먼저 의심한다.**
 *
 * 회원권마다 따로 어긋나는 일은 드물다. 어긋남은 한 번에 하나씩 생기고,
 * 그것이 수십 건이라면 장부가 아니라 세는 쪽이 틀렸을 가능성이 훨씬 크다 --
 * 종류 하나의 부호를 놓쳤거나, 이관처럼 우리가 모르는 규칙이 있는 것이다.
 *
 * 이 문장이 없으면 대표는 첫 점검에서 빨간 목록을 보고 회원 수십 명에게
 * 전화를 걸게 된다. 그 전화는 되돌릴 수 없다.
 */
export const SUSPECT_RATIO = 0.2;
export const SUSPECT_MINIMUM = 5;

export function looksLikeOurBug(report) {
  const total = Number(report?.total) || 0;
  const mismatched = Number(report?.mismatched) || 0;
  if (total <= 0 || mismatched < SUSPECT_MINIMUM) return false;
  return mismatched / total >= SUSPECT_RATIO;
}

/** 점검 결과 아래에 붙는 말. 할 일을 순서대로 말한다. */
export function reconcileAdvice(report) {
  if (looksLikeOurBug(report)) {
    return "이만큼 한꺼번에 어긋나는 일은 드뭅니다. 회원에게 연락하기 전에 "
      + "점검 식부터 의심해 주세요 — 원장 종류 하나의 부호를 놓쳤거나, "
      + "아직 모르는 규칙이 있을 수 있습니다. 개발자에게 이 화면을 보여 주세요.";
  }
  if ((Number(report?.mismatched) || 0) > 0) {
    return "안 맞는 회원권은 자동으로 고치지 않습니다. 어느 쪽이 참인지 확인한 뒤 "
      + "[잔여 조정] 으로 맞추면 맞춘 사실도 원장에 남습니다.";
  }
  return "";
}

/** 확인 불가의 사유를 사람 말로. */
export function unknownLabel(reason) {
  return {
    [RECONCILE_UNKNOWN.NO_LEDGER]: "원장 없음 (앱 이전에 만들어진 회원권)",
    [RECONCILE_UNKNOWN.UNREADABLE_DELTA]: "원장에 읽을 수 없는 줄이 있음",
    [RECONCILE_UNKNOWN.UNREADABLE_REMAINING]: "잔여를 읽을 수 없음",
  }[text(reason)] || "확인하지 못함";
}

/**
 * 차이를 읽는 말. **어느 쪽이 참인지 말하지 않는다** -- 모르기 때문이다.
 */
export function differenceLabel(difference) {
  const value = Number(difference) || 0;
  if (!value) return "";
  return value > 0
    ? `잔여가 원장보다 ${value}회 많음`
    : `잔여가 원장보다 ${Math.abs(value)}회 적음`;
}
