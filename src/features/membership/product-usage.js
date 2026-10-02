/**
 * 이 상품으로 몇 명이 발급받았나. **지우기 전에 묻는 질문이다.**
 *
 * ── 왜 세는가 ──
 * 상품을 지우면(archived) 목록과 발급 화면에서 사라진다. 그 상품으로 팔린
 * 회원권은 남아서 계속 그 상품을 가리키므로 데이터가 깨지지는 않지만, **몇
 * 명이 쓰고 있는지 모른 채 지우면** 나중에 "이 회원권이 무슨 상품이었지" 를
 * 되짚을 사람이 목록에서 그것을 못 찾는다.
 *
 * ── 두 가지 가리키는 법 ──
 * 앱에서 발급한 회원권은 productId 가 **상품 문서의 id** 다. 그것은 확실하다.
 *
 * 이관분은 다르다. migration-repository 가 productId 에 **CSV 의 상품명**을
 * 그대로 넣는다 (`requireText(record, "상품명")`). 엑셀에 적힌 이름이라 상품
 * 문서와 이어 주는 키가 없다 -- 센터가 쓰던 이름과 앱에 만든 상품 이름이 같을
 * 이유도 없다.
 *
 * 그래서 **맞혀 본다**: 횟수가 같고, CSV 이름 안에 상품 이름이 들어 있으면
 * 같은 상품일 가능성이 높다. 다만 **확실하지 않다는 것을 화면에 적는다** --
 * 추정을 확정처럼 보여주면 대표가 그 숫자를 믿고 지운다.
 *
 * ── 세지 않는 것 ──
 * 끝난 회원권도 센다. "지금 몇 명이 쓰는가" 와 "이 상품으로 몇 장이 팔렸나" 는
 * 다른 질문이고, 지울지 정할 때 필요한 것은 둘 다다. 화면이 나눠 보여준다.
 */

import { isUsablePass } from "./pass-cards.js";

const text = (value) => String(value ?? "").trim();
const count = (value) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Math.floor(Number(value)) : 0);

/** 엑셀 이관으로 만들어진 회원권인가. id 접두가 그 표시다. */
export const isMigratedPass = (pass) => text(pass?.id || pass?.passId).startsWith("csv_");

/** 어떻게 이어 붙였는가. 화면이 이 값으로 "추정" 을 말할지 정한다. */
export const USAGE_MATCH = Object.freeze({
  /** productId 가 상품 문서의 id 다. 의심할 것이 없다. */
  EXACT: "exact",
  /** 이관분을 이름과 횟수로 맞혔다. 틀릴 수 있다. */
  GUESSED: "guessed",
});

/* 띄어쓰기와 대소문자를 지운다. "1:1 PT 50회" 와 "1:1PT50회" 를 다른 이름으로
   보면 이관분이 하나도 안 붙는다 -- 엑셀은 사람이 손으로 적은 글이다. */
const squashed = (value) => text(value).replace(/\s+/g, "").toLowerCase();

/**
 * 이 이관 회원권이 이 상품의 것으로 보이는가.
 *
 * 둘 다 맞아야 한다 -- 횟수만 같으면 10회짜리 상품 전부에 붙고, 이름만 같으면
 * 같은 이름의 10회와 20회가 서로 섞인다.
 *
 * @param {any} pass @param {any} product
 */
export function looksLikeProduct(pass, product) {
  const name = squashed(product?.name);
  if (!name) return false;
  if (count(pass?.totalSessions) !== count(product?.defaultSessions)) return false;
  return squashed(pass?.productId).includes(name);
}

/**
 * 상품마다 누가 쓰고 있는가.
 *
 * @param {{ products?: Array<any>, passes?: Array<any>, now?: Date }} input
 * @returns {Map<string, { exact: number, guessed: number, active: number, ended: number, total: number }>}
 */
export function productUsage({ products, passes, now = new Date() } = {}) {
  const list = Array.isArray(products) ? products : [];
  const all = Array.isArray(passes) ? passes : [];
  const out = new Map(list.map((product) => [text(product.id), {
    exact: 0, guessed: 0, active: 0, ended: 0, total: 0,
  }]));

  for (const pass of all) {
    if (!pass) continue;
    const productId = text(pass.productId);
    /* 정확히 가리키는 것이 먼저다. 이관분이라도 productId 가 상품 문서의
       id 면 그것이 맞다 -- 맞혀 볼 이유가 없다. */
    let matched = out.has(productId) ? { id: productId, how: USAGE_MATCH.EXACT } : null;
    if (!matched && isMigratedPass(pass)) {
      const candidates = list.filter((product) => looksLikeProduct(pass, product));
      /* 후보가 둘 이상이면 고르지 않는다. 아무 쪽에나 붙이면 그 상품의 발급
         인원이 거짓이 되고, 대표는 그 숫자를 보고 지울지 정한다. */
      if (candidates.length === 1) matched = { id: text(candidates[0].id), how: USAGE_MATCH.GUESSED };
    }
    if (!matched) continue;

    const tally = out.get(matched.id);
    if (!tally) continue;
    tally[matched.how] += 1;
    tally.total += 1;
    if (isUsablePass(pass, now)) tally.active += 1;
    else tally.ended += 1;
  }
  return out;
}

/**
 * 이 상품으로 발급된 회원권 줄. 상세 시트가 쓴다.
 *
 * @param {{
 *   product?: any, passes?: Array<any>, products?: Array<any>,
 *   clientName?: (clientId: string) => string,
 *   locationName?: (locationId: string) => string,
 *   instructorName?: (userId: string) => string,
 *   now?: Date,
 * }} input
 * @returns {{ active: Array<object>, ended: Array<object> }}
 */
export function productMemberRows(input = {}) {
  const product = input.product;
  const productId = text(product?.id);
  if (!productId) return { active: [], ended: [] };
  const now = input.now instanceof Date ? input.now : new Date();
  const list = Array.isArray(input.products) ? input.products : [product];
  const nameOf = (fn) => (typeof fn === "function" ? fn : () => "");
  const clientName = nameOf(input.clientName);
  const locationName = nameOf(input.locationName);
  const instructorName = nameOf(input.instructorName);

  const rows = [];
  for (const pass of Array.isArray(input.passes) ? input.passes : []) {
    if (!pass) continue;
    let how = "";
    if (text(pass.productId) === productId) how = USAGE_MATCH.EXACT;
    else if (isMigratedPass(pass) && looksLikeProduct(pass, product)) {
      /* 전체 목록으로 다시 본다 -- 다른 상품에도 들어맞으면 애매한 것이고,
         애매한 것을 이 상품의 회원으로 세면 안 된다. */
      if (list.filter((item) => looksLikeProduct(pass, item)).length === 1) how = USAGE_MATCH.GUESSED;
    }
    if (!how) continue;

    const clientId = text(pass.clientId);
    rows.push({
      passId: text(pass.id || pass.passId),
      clientId,
      clientName: clientName(clientId),
      locationName: locationName(text(pass.locationId)),
      instructorName: instructorName(text(pass.instructorId)),
      remaining: count(pass.remainingCount),
      issued: count(pass.totalSessions) + count(pass.serviceSessions),
      expiresAt: pass.expiresAt || null,
      guessed: how === USAGE_MATCH.GUESSED,
      usable: isUsablePass(pass, now),
    });
  }

  /* 이름순. 대표가 찾는 것은 "누가 쓰고 있나" 라 사람 이름이 기준이다. */
  const byName = (left, right) => String(left.clientName || left.clientId)
    .localeCompare(String(right.clientName || right.clientId), "ko");
  return {
    active: rows.filter((row) => row.usable).sort(byName),
    ended: rows.filter((row) => !row.usable).sort(byName),
  };
}

/**
 * 한 행 안에서 급여카테고리가 갈리는가. **표가 노란 표시를 다는 자리다.**
 *
 * 같은 이름으로 파는 상품인데 10회는 신규, 20회는 재등록이면 급여가 회차마다
 * 달라진다. 의도한 것일 수도 있지만, 모르고 그렇게 된 것이면 그 상품으로
 * 팔린 회원권의 급여가 전부 틀린다 -- 원장은 되돌릴 수 없다.
 *
 * @param {Array<any>} items 같은 이름의 상품들
 */
export const mixedCategories = (items) => new Set(
  (Array.isArray(items) ? items : []).map((item) => text(item?.payCategory)).filter(Boolean),
).size > 1;
