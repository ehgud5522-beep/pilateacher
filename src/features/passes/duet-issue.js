/**
 * 듀엣 회원권을 발급할 때의 판정. 화면은 이 결과를 그리기만 한다.
 *
 * ── 왜 앱에서 팔아야 하는가 ──
 * 이관으로만 듀엣을 만들 수 있으면 10월에 나올 새 계약은 앱에서 팔 수 없고,
 * 듀엣만 다시 종이로 돌아간다. 한 가지 방식이어야 한다는 것이 이 작업 전체의
 * 전제다.
 *
 * ── 세 가지 무게 ──
 * 막는 것과 알리는 것을 섞지 않는다. 전부 막으면 대표가 정당한 계약을 못 팔고,
 * 전부 통과시키면 틀린 계약이 원장에 박힌다 -- 원장은 append-only 라 고칠 수
 * 없다.
 *
 *   block    누를 수 없다. 그대로 두면 데이터가 깨진다
 *   confirm  누를 수 있지만 대표가 보고 넘어가야 한다. 어긋나면 급여가 틀린다
 *   warn     누를 수 있다. 사실만 알린다
 *
 * ── 이미 회원권이 있는 경우를 막지 않는 이유 ──
 * 재등록은 만료 전에 미리 하는 일이 잦고, 남은 회차와 새 회원권이 함께 있는
 * 것은 정상이다. 막으면 그 정당한 계약을 팔 수 없다. 다만 잘못 고른 회원일
 * 수도 있으니 대표가 알고 누르게 한다.
 */

import { PAY_CATEGORY, SESSION_TYPE } from "../../data/schema/constants.js";
import { isDeductablePass, remainingCountOf } from "../../data/repositories/pass-repository.js";
import { passBelongsTo } from "../../data/schema/pass-clients.js";

const text = (value) => String(value ?? "").trim();

/** 2:1 로 팔리는 카테고리. 상품이 둘 중 무엇으로 말하든 같은 뜻으로 읽는다. */
const DUET_CATEGORIES = new Set([PAY_CATEGORY.PT_2_1_NEW, PAY_CATEGORY.PT_2_1_REPURCHASE]);

/**
 * 이 상품이 2:1 인가. 급여 카테고리가 먼저이고, 없으면 상품의 수업 형태를 본다.
 *
 * 둘 다 보는 이유: 2:1 상품을 서비스나 기타 카테고리로 파는 경우가 있고, 그때도
 * 회원은 둘이다. 카테고리만 보면 그 계약에서 듀엣 경고가 사라진다.
 */
export function productLooksDuet(product) {
  if (!product) return false;
  if (DUET_CATEGORIES.has(text(product.payCategory))) return true;
  return text(product.sessionType) === SESSION_TYPE.PT_2_1;
}

/** 이 회원이 지금 쓸 수 있는 회원권을 들고 있는가. */
const activePassesOf = (passes, clientId, now) => (Array.isArray(passes) ? passes : [])
  .filter((pass) => passBelongsTo(pass, clientId) && isDeductablePass(pass, now));

/**
 * 발급 화면이 보여 줄 것 전부. 순서가 곧 화면에 서는 순서다.
 *
 * @param {{
 *   duet?: boolean,
 *   client?: any,
 *   partner?: any,
 *   product?: any,
 *   passes?: Array<any>,
 *   now?: Date,
 * }} input
 * @returns {Array<{ level: "block" | "confirm" | "warn", code: string, message: string }>}
 */
export function duetIssueNotices(input = {}) {
  const duet = input.duet === true;
  const client = input.client || null;
  const partner = input.partner || null;
  const now = input.now instanceof Date ? input.now : new Date();
  const notices = [];

  if (duet) {
    if (!partner) {
      notices.push({
        level: "block", code: "partner_missing",
        message: "듀엣 상대를 골라 주세요.",
      });
    } else if (client && text(partner.id) === text(client.id)) {
      /* 회차는 하나인데 누적이 둘 올라간다. 20회 판정이 실제의 두 배 속도로
         지나가고, 그 시점부터 단가가 조용히 틀린다. */
      notices.push({
        level: "block", code: "partner_is_self",
        message: "같은 회원을 두 번 고를 수 없습니다.",
      });
    }
  }

  /* 상품과 듀엣 여부가 어긋나면 급여가 틀린다. 막지는 않는다 -- 2:1 상품을
     혼자 쓰는 계약도, 1:1 상품을 둘이 쓰기로 한 계약도 실제로 있다. 다만
     둘 중 하나는 실수이므로 대표가 보고 넘어가야 한다. */
  const looksDuet = productLooksDuet(input.product);
  if (input.product && looksDuet && !duet) {
    notices.push({
      level: "confirm", code: "category_duet_without_partner",
      message: "2:1 상품인데 듀엣으로 발급하지 않습니다. 이대로 두면 회원 한 명의 회원권이 됩니다.",
    });
  }
  if (input.product && !looksDuet && duet) {
    notices.push({
      level: "confirm", code: "category_not_duet",
      message: "듀엣으로 발급하는데 2:1 상품이 아닙니다. 급여가 이 상품의 카테고리로 계산됩니다.",
    });
  }

  /* 이미 쓸 수 있는 회원권이 있는 회원. 재등록이면 정상이고, 회원을 잘못
     골랐으면 여기서 드러난다. */
  for (const person of duet ? [client, partner] : [client]) {
    if (!person) continue;
    const active = activePassesOf(input.passes, person.id, now);
    if (!active.length) continue;
    const remaining = active.reduce((sum, pass) => sum + remainingCountOf(pass), 0);
    notices.push({
      level: "warn", code: "already_has_pass",
      message: `${text(person.name) || "이 회원"}님에게 이미 쓸 수 있는 회원권이 있습니다 (잔여 ${remaining}회).`,
    });
  }

  return notices;
}

/** 누를 수 없게 만드는 것이 있는가. 있으면 첫 번째 문구를 화면이 쓴다. */
export const blockingNotice = (notices) => (Array.isArray(notices) ? notices : [])
  .find((notice) => notice.level === "block") || null;

/** 확인 화면에 서야 하는 것들. 막지는 않지만 대표가 보고 넘어가야 한다. */
export const reviewNotices = (notices) => (Array.isArray(notices) ? notices : [])
  .filter((notice) => notice.level !== "block");

/**
 * 계약이 무엇인지 한 줄로. 확인 화면이 그대로 쓴다.
 *
 * 대표가 각자 30회로 오해하면 계약 자체가 틀어진다 -- 두 사람이 같은 30회를
 * 나눠 쓴다는 사실이 숫자 옆에 있어야 한다.
 */
export const duetSummaryLine = (totalCount) => (
  `${totalCount}회를 두 분이 함께 씁니다 · 수업 한 번에 1회 차감`
);
