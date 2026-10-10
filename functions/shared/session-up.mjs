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

const text = (value) => String(value ?? "").trim();
const count = (value) => (Number.isInteger(Number(value)) && Number(value) >= 0 ? Number(value) : 0);

/** 세션업을 막아야 하는 이유. 코드 없는 "할 수 없습니다" 를 남기지 않는다. */
export const SESSION_UP_ERROR = Object.freeze({
  NOT_ACTIVE: "pass_not_active",
  SESSIONS_REQUIRED: "sessions_required",
  PRICE_INVALID: "price_invalid",
  SERVICE_INVALID: "service_invalid",
  EXPIRES_INVALID: "expires_invalid",
});

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
 * @param {{
 *   pass?: any, addSessions?: unknown, addPrice?: unknown, addService?: unknown,
 * }} [input]
 * @returns {string} 빈 문자열이면 통과
 */
export function sessionUpError({ pass, addSessions, addPrice, addService } = {}) {
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

/** 막힌 이유를 사람 말로. 고칠 방법까지 말한다. */
export const SESSION_UP_ERROR_LABEL = Object.freeze({
  [SESSION_UP_ERROR.NOT_ACTIVE]: "끝난 회원권은 늘릴 수 없습니다. 새로 발급해 주세요.",
  [SESSION_UP_ERROR.SESSIONS_REQUIRED]: "추가할 횟수를 1회 이상으로 입력해 주세요.",
  [SESSION_UP_ERROR.PRICE_INVALID]: "추가 금액을 0원 이상의 정수로 입력해 주세요.",
  [SESSION_UP_ERROR.SERVICE_INVALID]: "추가 서비스를 0회 이상의 정수로 입력해 주세요.",
  [SESSION_UP_ERROR.EXPIRES_INVALID]: "새 만료일을 확인해 주세요.",
});

/** 이력 한 줄. "세션업 33→100회" 처럼 무엇이 얼마나 늘었는지 말한다. */
export function sessionUpLabel(entry) {
  const sessions = count(entry?.addedSessions);
  const from = count(entry?.fromTotalSessions);
  const to = from + sessions;
  if (from > 0 && sessions > 0) return `세션업 ${from}→${to}회`;
  return sessions > 0 ? `세션업 +${sessions}회` : "세션업";
}
