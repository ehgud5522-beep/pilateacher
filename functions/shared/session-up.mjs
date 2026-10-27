/**
 * 세션업 — **같은 회원권을 늘린다. 새로 발급하지 않는다.**
 *
 * ── 왜 새 회원권이 아닌가 ──
 * 33회를 쓰다가 100회로 올리는 것은 **같은 계약을 키운 것**이다. 새 회원권을
 * 발급하면 그 회원에게 회원권이 둘이 되고, 차감이 둘로 갈리고, 누적 20회
 * 판정도 갈린다. 회원은 하나로 알고 있는데 장부만 둘이 된다.
 *
 * ── 회당 금액은 합쳐서 다시 센다 ──
 * 계약 금액도 회차도 함께 늘어난다. 그래서 단가는 둘을 합쳐 나눈 값이다:
 *
 *   회당 금액 = (기존 계약금액 + 추가 금액) ÷ (기존 총회차 + 추가 회차)
 *
 * 서비스는 분모에서 빠진다 -- 회원이 낸 돈이 아니다.
 *
 * **이미 확정된 차감은 그대로다.** 원장은 append-only 이고, 그 회차는 그때의
 * 단가로 팔렸다. 새 단가는 앞으로의 차감부터다.
 *
 * ── 남은 회차도 같이 는다 ──
 * 추가한 회차는 아직 쓰지 않은 것이다. 총회차만 늘리고 잔여를 두면 회원이 산
 * 회차가 사라진다.
 *
 * ── 서비스를 더해도 첫 1회 규칙은 그대로 ──
 * serviceUsed 는 건드리지 않는다. 이미 센터가 한 번 지원했으면 추가분은 0원이고
 * (deduction-pricing 의 판정 0), 아직이면 추가분의 첫 회가 지원 대상이다.
 * 세션업이 그 권리를 새로 주지 않는다 -- 회원권당 한 번이 규칙이다.
 */

import { isOwnerLevelRole } from "./constants.mjs";

const text = (value) => String(value ?? "").trim();
const count = (value) => (Number.isInteger(Number(value)) && Number(value) >= 0 ? Number(value) : 0);

/** 세션업을 막아야 하는 이유. 코드 없는 "할 수 없습니다" 를 남기지 않는다. */
export const SESSION_UP_ERROR = Object.freeze({
  NOT_ACTIVE: "pass_not_active",
  SESSIONS_REQUIRED: "sessions_required",
  PRICE_INVALID: "price_invalid",
  SERVICE_INVALID: "service_invalid",
  EXPIRES_INVALID: "expires_invalid",
  /* 기간이 지났다. **FC매니저에게는 여기서 끝난다** -- 대표·총괄매니저만
     사유를 적고 예외로 연다. */
  WINDOW_CLOSED: "session_up_window_closed",
  OVERRIDE_REASON_REQUIRED: "session_up_override_reason_required",
  OVERRIDE_REASON_TOO_LONG: "session_up_override_reason_too_long",
});

/**
 * ── 세션업 기간 ─────────────────────────────────────────────────────────
 *
 * **회원권을 얼마나 썼는가로 정한다. 날짜가 아니다.**
 *
 * 세션업은 "더 다녀 보니 좋아서 늘린다" 는 자리다. 거의 다 쓰고 나서 늘리면
 * 그것은 사실상 재등록인데, 세션업으로 하면 회당 금액이 **옛 회차까지 합쳐**
 * 다시 나뉜다 (sessionUpUnitPrice). 이미 확정된 차감은 그때 단가 그대로라,
 * 늘린 뒤의 단가만 낮아진 채로 남는다 -- 강사의 남은 회차가 전부 그 단가다.
 *
 * 작은 회원권은 기간도 짧다. 10회권의 6회차는 이미 절반이 넘는다.
 *
 *   총회차(서비스 제외) 10회 미만 → 3회차까지
 *   총회차(서비스 제외) 10회 이상 → 6회차까지
 *
 * 2026-10-27 대표 결정.
 */
export const SESSION_UP_WINDOW = Object.freeze({
  /** 이 회차 이상이면 큰 회원권이다 (서비스 제외). */
  LARGE_FROM: 10,
  SMALL_LIMIT: 3,
  LARGE_LIMIT: 6,
});

/** 예외 세션업의 사유. 원장 항목의 reason 과 같은 한도다. */
export const SESSION_UP_REASON_MAX = 200;

/** 이 회원권은 몇 회차까지 세션업할 수 있는가. */
export function sessionUpLimitOf(pass) {
  return count(pass?.totalSessions) >= SESSION_UP_WINDOW.LARGE_FROM
    ? SESSION_UP_WINDOW.LARGE_LIMIT
    : SESSION_UP_WINDOW.SMALL_LIMIT;
}

/**
 * 결제 회차 중 차감된 수. **서비스 회차는 빼고 센다.**
 *
 * 서비스는 센터가 얹어 준 것이라 "몇 회차까지 늘릴 수 있는가" 를 당길 이유가
 * 없다. 서비스 2회를 먼저 쓴 10회권이 4회차에서 막히면, 회원이 돈 주고 산
 * 회차는 아직 2회밖에 안 썼는데 기간이 끝난 것이 된다.
 *
 * ── 왜 원장을 세지 않는가 ──
 * 차감 항목을 세려면 하위 컬렉션을 훑어야 한다. 화면은 그 목록을 들고 있지
 * 않고(회원권 카드는 passes 문서만 본다), 규칙은 아예 훑지 못한다. 회원권
 * 문서의 네 숫자로 정해지는 값이라 그것으로 센다 -- pass-cards.js 의
 * remainingSplit 과 **같은 식**이고, 갈라지면 카드의 "정규 잔여" 와 여기의
 * "사용" 이 더해서 총회차가 안 된다.
 *
 *   서비스 사용 = serviceUsed (없으면 (총+서비스−잔여) 를 서비스로 자른 값)
 *   서비스 잔여 = 서비스 − 서비스 사용, 잔여를 넘지 않게
 *   정규 잔여   = 잔여 − 서비스 잔여
 *   **사용      = 총회차 − 정규 잔여**
 *
 * 대표가 [잔여 조정]으로 잔여를 올리면 사용이 그만큼 줄어든다. 그것이 맞다 --
 * 조정은 "이 회원권은 사실 이만큼 남아 있다" 고 선언하는 일이고, 그 선언을
 * 세션업 기간만 따로 무시할 이유가 없다.
 */
export function paidUsedOf(pass) {
  const total = count(pass?.totalSessions);
  const service = count(pass?.serviceSessions);
  const remaining = count(pass?.remainingCount);
  const serviceUsed = Number.isInteger(pass?.serviceUsed) && pass.serviceUsed >= 0
    ? Math.min(pass.serviceUsed, service)
    : Math.min(Math.max(0, total + service - remaining), service);
  const serviceLeft = Math.min(Math.max(0, service - serviceUsed), remaining);
  const paidLeft = Math.max(0, remaining - serviceLeft);
  /* 이관분은 총회차와 잔여가 따로 적혀 와서 둘이 어긋난 행이 있다. 음수로
     나오면 화면에 "-3회 사용" 이 뜨고, 총회차를 넘으면 기간이 없던 것이 된다. */
  return Math.max(0, Math.min(total, total - paidLeft));
}

/**
 * 이 회원권의 세션업 기간이 지금 어떤 상태인가.
 *
 * `left` 는 **지금을 포함해 앞으로 몇 번의 수업 시점에서 세션업할 수 있는가**다.
 * 사용이 한도와 같으면 1 -- 지금이 마지막이고, 수업 한 번 더 들어가면 닫힌다.
 * 그래서 화면은 1 일 때 강조한다. 0 은 곧 "끝났다" 이고, 그 둘을 한 숫자로
 * 말할 수 있어야 화면이 조건을 다시 쓰지 않는다.
 *
 * @returns {{ limit: number, used: number, left: number, open: boolean }}
 */
export function sessionUpWindowOf(pass) {
  const limit = sessionUpLimitOf(pass);
  const used = paidUsedOf(pass);
  const open = used <= limit;
  return { limit, used, left: open ? limit - used + 1 : 0, open };
}

/** 기간이 지난 뒤에도 여는 사람. 대표·총괄매니저뿐이다 (FC매니저는 아니다). */
export function canOverrideSessionUpWindow(role) {
  return isOwnerLevelRole(role);
}

/**
 * 회당 금액. **정규 유료 회차로만 나눈다.**
 *
 * 계약 금액을 못 읽으면 null 이다 -- 0 으로 두면 그 회원권의 모든 수업이
 * 무보수로 기록된다. Number(null) 이 0 이라 그 함정이 가깝다.
 */
export function sessionUpUnitPrice(contractPrice, totalSessions) {
  if (contractPrice === null || contractPrice === undefined || contractPrice === "") return null;
  const price = Number(contractPrice);
  const total = Number(totalSessions);
  if (!Number.isFinite(price) || !Number.isFinite(total) || total <= 0) return null;
  return Math.round(price / total);
}

/**
 * 세션업 뒤의 회원권. **쓰지 않는다 -- 숫자만 센다.**
 *
 * 화면의 전/후 표와 서버의 쓰기가 같은 식을 써야 한다. 둘이 갈라지면 대표가
 * 본 숫자와 박히는 숫자가 다르고, 그때는 원장이 이미 쌓인 뒤다.
 *
 * @param {{
 *   pass?: any,
 *   addSessions?: unknown, addPrice?: unknown, addService?: unknown, expiresAt?: unknown,
 * }} input
 * @typedef {{
 *   totalSessions: number, serviceSessions: number, remainingCount: number,
 *   contractPrice: number, baseUnitPrice: number | null, expiresAt: any,
 * }} SessionUpState
 *
 * @returns {{ before: SessionUpState, after: SessionUpState }}
 */
export function planSessionUp({ pass, addSessions, addPrice, addService, expiresAt } = {}) {
  const sessions = count(addSessions);
  const price = count(addPrice);
  const service = count(addService);

  const beforeTotal = count(pass?.totalSessions);
  const beforeService = count(pass?.serviceSessions);
  const beforePrice = count(pass?.contractPrice);
  const beforeRemaining = count(pass?.remainingCount);

  const afterTotal = beforeTotal + sessions;
  const afterPrice = beforePrice + price;
  return {
    before: {
      totalSessions: beforeTotal,
      serviceSessions: beforeService,
      remainingCount: beforeRemaining,
      contractPrice: beforePrice,
      baseUnitPrice: count(pass?.baseUnitPrice),
      expiresAt: pass?.expiresAt ?? null,
    },
    after: {
      totalSessions: afterTotal,
      serviceSessions: beforeService + service,
      /* 추가한 회차는 아직 쓰지 않은 것이다. 서비스도 함께 는다. */
      remainingCount: beforeRemaining + sessions + service,
      contractPrice: afterPrice,
      baseUnitPrice: sessionUpUnitPrice(afterPrice, afterTotal),
      /* 새 만료일을 안 주면 기존 날짜 그대로다 -- 늘린 회차를 쓸 기간이
         없으면 늘린 뜻이 없지만, 그 판단은 사람이 한다. */
      expiresAt: expiresAt ?? pass?.expiresAt ?? null,
    },
  };
}

/**
 * 이 세션업이 성립하는가. **서버가 쓰기 전에 이것을 먼저 본다.**
 *
 * 화면도 같은 함수를 쓴다 -- 화면이 막는 것과 서버가 막는 것이 다르면, 화면을
 * 지나간 입력이 서버에서 거부되고 대표는 왜인지 알 수 없다.
 *
 * ── 기간은 마지막에 본다 ──
 * 숫자가 틀린 입력에는 숫자 이야기를 먼저 한다. 기간부터 말하면 대표는 횟수를
 * 0 으로 둔 채 사유만 적고 또 막힌다.
 *
 * 숫자 판정만 따로 부를 수 있다 (`sessionUpNumbersError`). 화면의 전/후 표가
 * 그것을 쓴다 -- **기간이 지난 회원권에서도 무엇이 일어날지는 보여야 한다.**
 * 사유를 적기 전에는 표가 안 보이면, 대표는 얼마가 되는지 모르는 채로 사유를
 * 적게 된다.
 *
 * @param {{
 *   pass?: any, addSessions?: unknown, addPrice?: unknown, addService?: unknown,
 *   actorRole?: unknown, overrideReason?: unknown,
 * }} [input]
 *   actorRole       누르는 사람의 역할. **없으면 기간을 못 넘는다** -- 모르는
 *                   사람에게 예외를 열어 주는 기본값을 두지 않는다.
 *   overrideReason  기간이 지난 뒤 대표·총괄매니저가 적는 사유. 원장에 남는다.
 * @returns {string} 빈 문자열이면 통과
 */
export function sessionUpNumbersError({ pass, addSessions, addPrice, addService } = {}) {
  /* 끝난 회원권은 늘리지 않는다. 늘리려면 새로 발급하는 것이 맞고, 끝난
     계약을 되살리면 그 사이의 만료·소진이 없던 일이 된다. */
  const status = text(pass?.status);
  if (status && status !== "active") return SESSION_UP_ERROR.NOT_ACTIVE;

  const sessions = Number(addSessions);
  if (!Number.isInteger(sessions) || sessions <= 0) return SESSION_UP_ERROR.SESSIONS_REQUIRED;

  const price = Number(addPrice);
  if (!Number.isInteger(price) || price < 0) return SESSION_UP_ERROR.PRICE_INVALID;

  const service = addService === undefined || addService === "" ? 0 : Number(addService);
  if (!Number.isInteger(service) || service < 0) return SESSION_UP_ERROR.SERVICE_INVALID;

  return "";
}

export function sessionUpError(input = {}) {
  const numbers = sessionUpNumbersError(input);
  if (numbers) return numbers;

  /* 기간. 지났으면 FC매니저는 여기서 끝이고, 대표·총괄매니저는 사유를 적는다.
     사유는 원장에 남는다 -- 예외를 연 기록이 없으면 기간이 있으나 마나다. */
  if (!sessionUpWindowOf(input?.pass).open) {
    if (!canOverrideSessionUpWindow(input?.actorRole)) return SESSION_UP_ERROR.WINDOW_CLOSED;
    const reason = text(input?.overrideReason);
    if (!reason) return SESSION_UP_ERROR.OVERRIDE_REASON_REQUIRED;
    if (reason.length > SESSION_UP_REASON_MAX) return SESSION_UP_ERROR.OVERRIDE_REASON_TOO_LONG;
  }

  return "";
}

/** 막힌 이유를 사람 말로. 고칠 방법까지 말한다. */
export const SESSION_UP_ERROR_LABEL = Object.freeze({
  [SESSION_UP_ERROR.NOT_ACTIVE]: "끝난 회원권은 늘릴 수 없습니다. 새로 발급해 주세요.",
  [SESSION_UP_ERROR.SESSIONS_REQUIRED]: "추가할 횟수를 1회 이상으로 입력해 주세요.",
  [SESSION_UP_ERROR.PRICE_INVALID]: "추가 금액을 0원 이상의 정수로 입력해 주세요.",
  [SESSION_UP_ERROR.SERVICE_INVALID]: "추가 서비스를 0회 이상의 정수로 입력해 주세요.",
  [SESSION_UP_ERROR.EXPIRES_INVALID]: "새 만료일을 확인해 주세요.",
  [SESSION_UP_ERROR.WINDOW_CLOSED]:
    "세션업 기간이 지났습니다. 대표·총괄매니저만 사유를 적고 진행할 수 있습니다.",
  [SESSION_UP_ERROR.OVERRIDE_REASON_REQUIRED]:
    "기간이 지난 세션업입니다. 사유를 적어 주세요.",
  [SESSION_UP_ERROR.OVERRIDE_REASON_TOO_LONG]:
    `사유는 ${SESSION_UP_REASON_MAX}자까지 적을 수 있습니다.`,
});

/**
 * 화면 한 줄. 카드에도 수업 확정 화면에도 **같은 문구**가 서야 한다.
 *
 * 회원권이 아니라 `sessionUpWindowOf` 의 결과를 받는다 -- 수업 확정 화면은
 * 회원권을 들고 있지 않고 미리보기가 이미 센 값을 들고 있다 (lesson-rate-
 * preview.js). 거기서 다시 세게 하면 같은 회원권이 두 화면에서 다른 숫자가
 * 될 길이 생긴다.
 *
 * @param {{ left?: number, open?: boolean } | null | undefined} window
 */
export function sessionUpWindowLabel(window) {
  return window?.open
    ? `세션업 가능 ${count(window?.left)}회 남음`
    : "세션업 기간 종료";
}

/** 이력 한 줄. "세션업 33→100회" 처럼 무엇이 얼마나 늘었는지 말한다. */
export function sessionUpLabel(entry) {
  const sessions = count(entry?.addedSessions);
  const from = count(entry?.fromTotalSessions);
  const to = from + sessions;
  if (from > 0 && sessions > 0) return `세션업 ${from}→${to}회`;
  return sessions > 0 ? `세션업 +${sessions}회` : "세션업";
}
