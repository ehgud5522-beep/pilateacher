/**
 * 확정을 누르기 전에 이 회차가 얼마인지 보여준다.
 *
 * ── 왜 미리 보여주는가 ──
 * 같은 회원권 안에서도 회차마다 단가가 다르다. 19회째와 21회째가 다르고,
 * 서비스 회차는 또 다르다. 강사가 확정을 누른 뒤에 금액을 처음 보면 "왜 이
 * 금액이지" 를 나중에 묻게 되고, 그때는 원장이 append-only 라 고칠 수도 없다.
 *
 * ── 실제 차감과 같은 값이어야 한다 ──
 * 그래서 계산을 다시 쓰지 않는다. 회원권을 고르는 것(pickPassForClient),
 * 서비스 회차를 먼저 쓰는 것(spendsServiceSession), 단가를 정하는 것
 * (resolveDeductionUnitPrice) 모두 차감이 쓰는 그 함수를 그대로 부른다.
 * 여기서 한 줄이라도 다시 구현하면 두 숫자가 갈라지는 날이 오고, 그날 강사는
 * 화면을 믿지 않게 된다.
 *
 * 하나만 다르다. 차감은 누적 횟수를 그 순간에 서버에서 읽고, 미리보기는 화면이
 * 이미 읽어 둔 목록에서 본다. 그래서 20회째 근처에서 한 칸 어긋날 수 있다 --
 * 같은 회원을 다른 강사가 방금 차감했을 때다. 미리보기가 그럴 수 있다는 것을
 * 화면이 말하도록 approximate 를 함께 돌려준다.
 */

import { PAY_CATEGORY } from "../../data/schema/constants.js";
import {
  netContractPriceOf, resolveDeductionUnitPrice, spendsServiceSession,
} from "../../data/schema/deduction-pricing.js";
import { defaultUnitPriceFor } from "../../data/schema/pay-rates.js";
import { remainingCountOf } from "../../data/repositories/pass-repository.js";
import { isDuetPass } from "../../data/schema/pass-clients.js";
import { SETTLEMENT_SKIP, pickSoloPass, planPassSelection } from "./lesson-settlement.js";

const text = (value) => String(value ?? "").trim();

/** 강사-회원 누적을 id 쌍으로 찾는다. 문서 id 가 곧 그 쌍이다. */
export function instructorClientSessionsOf(totals, instructorId, clientId) {
  const instructor = text(instructorId);
  const client = text(clientId);
  if (!instructor || !client) return 0;
  const found = (Array.isArray(totals) ? totals : []).find((item) => (
    text(item?.id) === `${instructor}_${client}`
    || (text(item?.instructorId) === instructor && text(item?.clientId) === client)
  ));
  const sessions = found?.sessions;
  return Number.isInteger(sessions) && sessions >= 0 ? sessions : 0;
}

/**
 * 회원 한 명의 다음 회차 단가.
 *
 * @param {{
 *   member?: any, passes?: Array<any>, totals?: Array<any>,
 *   instructorId?: string, isDeputyDirector?: boolean, now?: Date,
 *   chosen?: any, skip?: string, shared?: boolean, deducts?: boolean,
 * }} input
 *   chosen 수업 단위로 이미 고른 회원권 (planPassSelection). 없으면 혼자 온
 *          것으로 보고 1:1 회원권에서 고른다.
 * @returns {{ unitPrice: number, rule: string } | { skip: string }}
 */
export function previewMemberRate(input = {}) {
  const clientId = text(input?.member?.orgClientId);
  // 센터에 없는 회원은 차감할 회원권이 없다. 금액을 지어내지 않는다.
  if (!clientId) return { skip: SETTLEMENT_SKIP.NO_CLIENT };
  if (input.skip) return { skip: input.skip };

  const passes = Array.isArray(input.passes) ? input.passes : [];
  const pass = input.chosen
    || pickSoloPass(passes, clientId, input.now instanceof Date ? input.now : new Date());
  if (!pass) {
    /* 회원권이 아예 없는 것과 다 쓴 것은 고칠 방법이 다르다 -- 앞은 발급이고
       뒤는 재등록이다. 한 문구로 뭉개지 않는다. 듀엣 회원권만 있는 것은 또
       달라서, 짝과 함께 오면 풀린다. */
    const mine = passes.filter((item) => item?.clientId === clientId);
    if (mine.length === 0) return { skip: SETTLEMENT_SKIP.NO_PASS };
    return { skip: mine.every((item) => isDuetPass(item)) ? SETTLEMENT_SKIP.SOLO_PASS_MISSING : SETTLEMENT_SKIP.SPENT };
  }

  const category = text(pass.category);
  /* 개명 전에 발급된 회원권은 기준값을 unitPrice 라는 이름으로 들고 있다.
     deductPass 와 같은 자리에서 같은 이름 둘을 본다. */
  const baseUnitPrice = Number.isInteger(pass.baseUnitPrice) ? pass.baseUnitPrice : pass.unitPrice;
  const spendsService = spendsServiceSession({
    category, serviceSessions: pass.serviceSessions, serviceUsed: pass.serviceUsed,
  });
  const pricingCategory = spendsService ? PAY_CATEGORY.SERVICE : category;
  const pricingBaseUnitPrice = pricingCategory === category
    ? baseUnitPrice
    : defaultUnitPriceFor(PAY_CATEGORY.SERVICE);

  try {
    const { unitPrice, rule } = resolveDeductionUnitPrice({
      category: pricingCategory,
      baseUnitPrice: pricingBaseUnitPrice,
      netContractPrice: netContractPriceOf(pass),
      totalSessions: pass.totalSessions,
      isDeputyDirector: input.isDeputyDirector === true,
      handedOver: pass.handedOver === true,
      priorSessions: instructorClientSessionsOf(input.totals, input.instructorId, clientId),
      serviceUsedCount: pass.serviceUsed,
    });
    return {
      unitPrice, rule, passId: text(pass.id), remaining: remainingCountOf(pass),
      /* 함께 쓰는 회원권이면 두 줄에 같은 금액이 서는데, 실제로 나가는 것은
         한 번이다. 화면이 그 말을 할 수 있어야 강사가 2회로 읽지 않는다. */
      shared: input.shared === true,
      deducts: input.deducts !== false,
    };
  } catch (error) {
    /* 판정이 멈추는 경우가 있다 -- 부원장인데 공급가액을 읽을 수 없거나, 기준값이
       없는 옛 회원권이다. 지어낸 숫자를 보여주느니 확정이 실패할 것이라고 미리
       말한다. 원본 코드를 함께 남긴다: 없으면 무엇을 고쳐야 하는지 알 수 없다. */
    return { skip: SETTLEMENT_SKIP.WRITE_FAILED, code: String(error?.message || "unknown") };
  }
}

/**
 * 수업 한 건의 참석자별 예상 단가.
 *
 * 출석 상태를 보지 않는다. 확정 전에 보여주는 것이 목적이라, 아직 아무도 출석을
 * 누르지 않은 수업에서도 서야 한다.
 *
 * @param {{
 *   lesson?: any, members?: Array<any>, passes?: Array<any>, totals?: Array<any>,
 *   instructorId?: string, isDeputyDirector?: boolean, now?: Date,
 * }} input
 * @returns {Map<string, object>} memberId → 위 previewMemberRate 의 결과
 */
export function previewLessonRates(input = {}) {
  const members = Array.isArray(input.members) ? input.members : [];
  const byId = new Map(members.map((member) => [text(member?.id), member]));
  const attendees = Array.isArray(input?.lesson?.attendees) ? input.lesson.attendees : [];
  const ids = attendees.length
    ? attendees.map((attendee) => text(attendee?.memberId))
    : [text(input?.lesson?.memberId)];

  /* 확정이 쓰는 그 선택을 그대로 쓴다. 여기서 한 줄이라도 다시 고르면 두
     화면이 갈라지는 날이 오고, 그날 강사는 화면을 믿지 않게 된다.
     출석 상태는 보지 않는다 -- 아직 아무도 누르지 않은 수업에서도 서야 한다. */
  const plan = planPassSelection({ ...input, requireAttendance: false });
  const chosen = new Map();
  for (const item of plan.deductions) {
    item.memberIds.forEach((memberId, index) => chosen.set(text(memberId), {
      chosen: item.pass, shared: item.shared === true, deducts: index === 0,
    }));
  }
  const skipped = new Map(plan.skips.map((item) => [text(item.memberId), item.reason]));

  const out = new Map();
  for (const memberId of ids) {
    if (!memberId || out.has(memberId)) continue;
    const member = byId.get(memberId);
    if (!member) continue;
    out.set(memberId, previewMemberRate({
      ...input, member, skip: skipped.get(memberId) || "", ...(chosen.get(memberId) || {}),
    }));
  }
  return out;
}
