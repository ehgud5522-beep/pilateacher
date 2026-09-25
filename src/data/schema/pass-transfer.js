/**
 * 회원권 양도 — 누가 줄 수 있고, 받는 회원권의 금액은 얼마인가.
 *
 * 순수 함수만 있다. 읽지도 쓰지도 않으므로 경계값을 전부 테스트로 고정할 수
 * 있고, 저장소(pass-repository.js)는 이 판정을 부르기만 한다.
 *
 * ── 양도는 발급이 아니다 ──
 * 돈이 새로 들어오지 않는다. 원본에서 회차가 빠져 나가고 그만큼이 받는 회원의
 * 새 회원권이 된다. 그래서 두 가지를 동시에 지켜야 한다.
 *
 *   1. 센터가 받은 돈의 총합이 변하지 않는다
 *   2. **부원장의 회당 단가가 변하지 않는다**
 *
 * 2번이 까다롭다. 부원장 급여는 `round(공급가액 / 총회차 / 2)` 인데
 * (deduction-pricing.js), 회차를 쪼개면 분자와 분모가 각각 반올림되면서 그
 * 값이 1원씩 어긋난다. 회차마다 1원이면 한 계약에서 수십 원이고, 원장은
 * append-only 라 나중에 고칠 수 없다.
 *
 * ── 그래서 비례식에 보정을 얹는다 (2026-09-24 대표 확정) ──
 * 계약 금액을 회차 비례로 나눈 뒤, 받는 회원권의 부원장 단가가 원본과 **정확히
 * 같아질 때까지** 금액을 1원씩 움직인다. 움직이는 폭은 2원까지다.
 *
 * 비례식만 쓰면 98.66% 는 그대로 맞고 나머지가 1원 어긋난다. 그 1.34% 를 위해
 * 2원을 움직이는 것이고, 총액은 사실상 그대로이면서 급여는 정확해진다.
 */

import { PAYMENT_METHOD } from "./constants.js";
import { deputyDirectorUnitPrice, netContractPriceFor, netContractPriceOf } from "./deduction-pricing.js";
import { passClientIds } from "./pass-clients.js";

/**
 * 보정으로 움직일 수 있는 최대 금액.
 *
 * 2원이다. 비례식이 만드는 오차는 반올림에서만 오므로 1~2원이면 닿고, 더
 * 열어 두면 "계약 금액을 맞춰 쓰는 자리" 가 되어 버린다 -- 여기서 조정할 수
 * 있는 것은 반올림이 만든 오차뿐이어야 한다.
 */
export const MAX_TRANSFER_NUDGE = 2;

/** 양도를 막는 이유. 화면이 이 코드로 문구를 고른다. */
export const TRANSFER_BLOCK = Object.freeze({
  /** 듀엣 회원권. 계약서가 둘의 것이라 한쪽이 혼자 넘길 수 없다. */
  DUET: "transfer_duet",
  /** 이미 끝난 회원권. */
  NOT_ACTIVE: "transfer_not_active",
  /** 넘길 유료 회차가 없다. 서비스 회차는 대상이 아니다. */
  NO_PAID_SESSIONS: "transfer_no_paid_sessions",
  /** 같은 회원에게 넘긴다. */
  SAME_CLIENT: "transfer_same_client",
  /** 요청한 회차가 남은 유료 회차보다 많다. */
  TOO_MANY: "transfer_too_many",
  /** 회차가 1보다 작다. */
  TOO_FEW: "transfer_too_few",
  /** 금액을 읽을 수 없어 급여 근거를 만들 수 없다. */
  NO_PRICE: "transfer_no_price",
});

const count = (value) => (Number.isInteger(Number(value)) && Number(value) >= 0 ? Number(value) : 0);

/**
 * 이 회원권에서 넘길 수 있는 회차.
 *
 * 서비스 회차는 뺀다 (확정 5번). 센터가 얹어 준 것이라 회원 사이에서 오갈
 * 물건이 아니고, 무엇보다 급여가 다르다 -- 서비스 차감은 회원권당 한 번만
 * 돈이 나가고 그 판단은 원본 회원권에 붙어 있다(serviceUsed).
 *
 * 서비스를 먼저 쓰므로(deduction-pricing.js 의 spendsServiceSession), 아직
 * 안 쓴 서비스가 잔여 안에 그대로 들어 있다. 그만큼을 덜어 낸 것이 유료
 * 잔여다.
 *
 * @param {any} pass
 * @returns {number}
 */
export function transferableSessions(pass) {
  const remaining = count(pass?.remainingCount);
  const serviceLeft = Math.max(0, count(pass?.serviceSessions) - count(pass?.serviceUsed));
  return Math.max(0, remaining - serviceLeft);
}

/**
 * 이 양도가 가능한가. 막히면 이유를 돌려준다.
 *
 * 돌려주는 모양을 한 덩어리로 둔다. 갈래 둘로 나누면 호출부가 좁히기 전에는
 * code 를 읽지 못하고, 이 함수를 부르는 곳의 대부분은 "막혔으면 왜" 하나만
 * 본다 -- 타입 때문에 코드가 길어지면 그 코드가 틀린다.
 *
 * @param {{ pass: any, toClientId?: string, sessions?: number | string }} input
 * @returns {{ ok: boolean, code?: string, sessions?: number, limit?: number }}
 */
export function checkTransfer(input) {
  const pass = input?.pass || null;
  const sessions = Number(input?.sessions);
  const toClientId = String(input?.toClientId ?? "").trim();

  /* 듀엣은 넘기지 못한다 (확정 6번). 계약서 하나에 회원이 둘이고, 한쪽이
     제 몫이라 여기는 회차가 따로 없다 -- 30회 계약이면 둘이 함께 쓰는 30회다.
     쪼개려면 회원권을 취소하고 다시 발급하는 길이 이미 있다. */
  if (passClientIds(pass).length > 1) return { ok: false, code: TRANSFER_BLOCK.DUET };
  if (String(pass?.status ?? "") !== "active") return { ok: false, code: TRANSFER_BLOCK.NOT_ACTIVE };

  const limit = transferableSessions(pass);
  if (limit <= 0) return { ok: false, code: TRANSFER_BLOCK.NO_PAID_SESSIONS };

  if (!toClientId) return { ok: false, code: TRANSFER_BLOCK.SAME_CLIENT };
  if (toClientId === String(pass?.clientId ?? "")) return { ok: false, code: TRANSFER_BLOCK.SAME_CLIENT };

  if (!Number.isInteger(sessions) || sessions < 1) return { ok: false, code: TRANSFER_BLOCK.TOO_FEW };
  if (sessions > limit) return { ok: false, code: TRANSFER_BLOCK.TOO_MANY, limit };

  if (netContractPriceOf(pass) === null) return { ok: false, code: TRANSFER_BLOCK.NO_PRICE };
  return { ok: true, sessions };
}

/**
 * 받는 회원권이 들고 갈 금액.
 *
 * 회차 비례로 나눈 뒤, **부원장 회당 단가가 원본과 같아질 때까지** 1원씩
 * 움직인다. 0 → +1 → -1 → +2 → -2 순으로 본다: 비례식이 이미 맞으면 한 발도
 * 움직이지 않고, 움직여야 하면 가장 적게 움직인 쪽을 고른다.
 *
 * 분모가 totalSessions 인 것에 주의한다. 원본의 단가는 계약한 총 회차로
 * 나눈 값이고, 남은 회차로 나눈 값이 아니다 -- 이미 쓴 회차도 그 단가로
 * 급여가 나갔다.
 *
 * @param {{ pass: any, sessions: number | string }} input
 * @returns {{
 *   contractPrice: number, netContractPrice: number, paymentMethod: string,
 *   deputyUnitPrice: number, sourceDeputyUnitPrice: number,
 *   nudge: number, exact: boolean,
 * }}
 */
export function transferPricing(input) {
  const pass = input?.pass || null;
  const sessions = Number(input?.sessions);
  if (!Number.isInteger(sessions) || sessions < 1) throw new Error("Invalid sessions");
  const totalSessions = count(pass?.totalSessions);
  if (totalSessions < 1) throw new Error("Invalid totalSessions");

  const sourceNet = netContractPriceOf(pass);
  if (sourceNet === null) throw new Error("Invalid netContractPrice");
  const paymentMethod = String(pass?.paymentMethod ?? PAYMENT_METHOD.CARD).trim() || PAYMENT_METHOD.CARD;
  const sourcePrice = count(pass?.contractPrice);

  /* 원본의 부원장 회당 단가. 받는 회원권이 맞춰야 할 값이고, 여기서 벗어나면
     같은 계약의 회차가 사람에 따라 다른 급여가 된다. */
  const sourceDeputyUnitPrice = deputyDirectorUnitPrice({
    netContractPrice: sourceNet, totalSessions,
  });

  const base = Math.round((sourcePrice * sessions) / totalSessions);
  /* 0 을 먼저 본다 -- 비례식이 맞는 98.66% 는 한 발도 움직이지 않는다. */
  const steps = [0];
  for (let step = 1; step <= MAX_TRANSFER_NUDGE; step += 1) steps.push(step, -step);

  for (const nudge of steps) {
    const contractPrice = base + nudge;
    if (contractPrice < 0) continue;
    const netContractPrice = netContractPriceFor(contractPrice, paymentMethod);
    const deputyUnitPrice = deputyDirectorUnitPrice({ netContractPrice, totalSessions: sessions });
    if (deputyUnitPrice === sourceDeputyUnitPrice) {
      return {
        contractPrice, netContractPrice, paymentMethod,
        deputyUnitPrice, sourceDeputyUnitPrice, nudge, exact: true,
      };
    }
  }

  /* 2원 안에서 못 맞췄다. 비례식 그대로 두고 **맞추지 못했다는 사실을 함께
     돌려준다** -- 조용히 비슷한 값을 쓰면 그 차이가 원장에 박히고, 원장은
     고칠 수 없다. 저장소가 이 값을 보고 멈춘다. */
  const contractPrice = base;
  const netContractPrice = netContractPriceFor(contractPrice, paymentMethod);
  return {
    contractPrice, netContractPrice, paymentMethod,
    deputyUnitPrice: deputyDirectorUnitPrice({ netContractPrice, totalSessions: sessions }),
    sourceDeputyUnitPrice, nudge: 0, exact: false,
  };
}

/**
 * 막힌 이유를 사람 말로.
 *
 * 코드 옆에 둔다. 화면이 제 문구를 따로 만들면 코드가 하나 늘 때 그 문구가
 * 빠지고, 대표는 "처리하지 못했어요" 만 보게 된다 -- 테스트가 두 목록이 같은
 * 집합인지 견준다.
 *
 * TOO_MANY 는 숫자를 채워야 하므로 함수다 (transferBlockLabel).
 */
export const TRANSFER_BLOCK_LABEL = Object.freeze({
  [TRANSFER_BLOCK.DUET]: "듀엣 회원권은 양도할 수 없습니다. 계약이 두 분의 것이라 한쪽만 넘길 수 없어요.",
  [TRANSFER_BLOCK.NOT_ACTIVE]: "이미 끝난 회원권입니다.",
  [TRANSFER_BLOCK.NO_PAID_SESSIONS]: "넘길 수 있는 유료 회차가 없습니다. 서비스 회차는 양도 대상이 아닙니다.",
  [TRANSFER_BLOCK.SAME_CLIENT]: "받는 회원을 골라 주세요.",
  [TRANSFER_BLOCK.TOO_MANY]: "남은 유료 회차보다 많이 넘길 수 없습니다.",
  [TRANSFER_BLOCK.TOO_FEW]: "1회 이상을 넣어 주세요.",
  [TRANSFER_BLOCK.NO_PRICE]: "이 회원권의 금액을 읽지 못해 급여 근거를 만들 수 없습니다. 센터에 문의해 주세요.",
});

/**
 * 화면에 적을 한 줄. 모르는 코드도 숨기지 않는다.
 *
 * @param {{ code?: string, limit?: number }} blocked
 */
export function transferBlockLabel(blocked) {
  const code = String(blocked?.code || "");
  if (code === TRANSFER_BLOCK.TOO_MANY && Number.isInteger(blocked?.limit)) {
    return `최대 ${blocked.limit}회까지 넘길 수 있습니다.`;
  }
  // 코드 없는 "오류가 발생했습니다" 는 금지다.
  return TRANSFER_BLOCK_LABEL[code] || `양도하지 못했어요 (코드 ${code || "unknown"})`;
}
