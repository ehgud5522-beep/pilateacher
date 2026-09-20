/**
 * 소속 강사가 보는 회원 목록. 조직 회원을 원본으로 두고, 기기에 있던 레거시
 * 회원을 그 위에 이어 붙인다.
 *
 * ── 왜 필요한가 ──
 * 일정 탭과 회원 탭이 기기 저장 회원(db.members)을 읽고 있었다. FC매니저가
 * 등록한 조직 회원이 강사에게 보이지 않으면 강사는 그 회원을 다시 등록하고,
 * 그것이 이 작업 전체가 없애려는 이중 관리다.
 *
 * ── 저장소를 옮기지 않는다 ──
 * 수업 기록은 레거시 회원 객체 안(member.notes)에 있고, 사진과 체형분석은
 * 회원 id 를 키로 하는 별도 저장소(photos[id])에 있다. id 를 조직 것으로 바꾸려면
 * 세 저장소를 한 트랜잭션으로 다시 써야 하는데 로컬에는 그런 것이 없다. 실패하면
 * 강사 기기에서 사진이 사라진다.
 *
 * 그래서 옮기지 않고 목록을 만들 때만 이어 붙인다. 맞물린 회원은 레거시 객체를
 * 그대로 내보내므로 id 가 바뀌지 않고, 기록·사진·체형분석 코드는 한 줄도 고칠
 * 필요가 없다.
 *
 * ── 세 가지 줄이 나온다 ──
 *   org_linked  조직 회원 = 레거시 회원. 레거시 객체를 쓰고 이름·연락처만 조직
 *               쪽으로 덮는다. 기록이 그대로 이어진다.
 *   org         조직에만 있는 회원. id 를 조직 clientId 로 둔다 -- 앞으로의
 *               기록이 그 id 로 쌓이므로, 나중에 조직으로 옮길 때 이미 맞는
 *               id 다.
 *   local_only  기기에만 있는 회원. 숨기지 않는다 -- 숨기면 강사 화면에서 자기
 *               기록이 사라진다. 대신 "센터에 등록되지 않음"으로 표시한다.
 *
 * ── 잔여는 조직 회원권에서만 온다 ──
 * 레거시 regular/service 를 0 으로 눌러 내보낸다. 두 숫자가 한 화면에 함께 있으면
 * 어느 것이 맞는지 아무도 모르고, 일정 탭의 옛 차감 흐름이 그중 하나를 줄인다.
 * 화면이 쓰는 left() 는 orgRemaining 을 더하므로, 이 한 번의 0 이 그 경로를
 * 함께 끊는다.
 */

import { normalizePhone } from "../../data/repositories/client-repository.js";
import { isDeductablePass, remainingCountOf } from "../../data/repositories/pass-repository.js";
import { PAY_CATEGORY_LABELS } from "../../data/schema/display-names.js";
import { partnerClientId, passBelongsTo } from "../../data/schema/pass-clients.js";

/** 이 줄이 어디서 왔는가. 화면이 이 값으로 무엇을 말할지 정한다. */
export const ROSTER_SOURCE = Object.freeze({
  ORG_LINKED: "org_linked",
  ORG: "org",
  LOCAL_ONLY: "local_only",
});

const text = (value) => String(value ?? "").trim();

/**
 * 레거시 회원을 찾는 열쇠.
 *
 * 연락처가 먼저다 -- 이름은 동명이인이 있고 개명도 된다. 연락처가 없는 옛
 * 회원이 실제로 있어 그때만 이름으로 맞춘다. 이름까지 없으면 맞추지 않는다:
 * 빈 열쇠로 맞추면 이름 없는 회원 여럿이 한 조직 회원에 달라붙는다.
 */
const keysOf = (item) => {
  const phone = normalizePhone(item?.phone);
  const name = text(item?.name);
  return { phone: phone || "", name: name || "" };
};

const count = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

/** 조직 회원권에서 오는 값. 쓸 수 있는 회차만 센다 -- 만료·취소분은 빼고. */
function passFactsFor(clientId, passes, now) {
  let remaining = 0;
  /* 이용권 카드가 묻는 세 가지. 회원권에 다 있는데 아무도 옮겨 오지 않아
     "미등록 · 미설정 · 결제 내역 없음" 으로 비어 있었다 -- 잔여만 29회라고
     적혀 있는 옆에서. 값이 없는 것이 아니라 여기서 끊겨 있었다. */
  let registeredTotal = 0;
  let paidSessions = 0;
  let paidAmount = 0;
  let nextPass = null;
  let lastPass = null;
  const instructorIds = new Set();
  for (const pass of passes) {
    /* 듀엣은 짝의 카드에서도 같은 회원권이 읽혀야 한다. 대표만 보면 짝에게만
       잔여도 만료일도 회당 금액도 0 이 된다 -- 한 회원권을 둘이 쓰는데 한
       사람에게만 보이는 상태다. */
    if (!passBelongsTo(pass, clientId)) continue;
    /* 담당 강사는 만료된 회원권에서도 읽는다. 지난주에 만료됐다고 그 회원이
       내 회원이 아니게 되는 것은 아니고, "내 회원" 필터가 그 사람을 잃으면
       강사는 목록을 다시 만들기 시작한다. */
    if (pass.instructorId) instructorIds.add(pass.instructorId);

    /* 누적 등록과 회당 금액은 만료·소진된 회원권도 센다. "누적" 이 그런 뜻이고,
       회당 금액은 레거시 paidAvg 와 같은 계산이다 -- 총 결제액 ÷ 정규 유료 횟수.
       서비스 회차는 분모에서 뺀다. 공짜로 받은 회차까지 나누면 회원이 실제로
       낸 단가보다 낮게 나온다. */
    registeredTotal += count(pass.totalSessions) + count(pass.serviceSessions);
    paidSessions += count(pass.totalSessions);
    paidAmount += count(pass.contractPrice);
    if (!lastPass || toDate(pass.expiresAt) > toDate(lastPass.expiresAt)) lastPass = pass;

    if (!isDeductablePass(pass, now)) continue;
    remaining += remainingCountOf(pass);
    /* 만료일은 다음에 쓰일 회원권의 것이다 -- 만료가 이른 것부터 쓰므로
       (lesson-settlement.js 의 pickPassForClient) 회원이 물어볼 날짜도 그것이다. */
    if (!nextPass || toDate(pass.expiresAt) < toDate(nextPass.expiresAt)) nextPass = pass;
  }
  /* 쓸 수 있는 것이 하나도 없으면 마지막 만료일을 보여준다. "미설정" 은 날짜를
     정하지 않았다는 뜻인데, 실제로는 지난 것이다. */
  const expiryPass = nextPass || lastPass;
  return {
    remaining,
    registeredTotal,
    unitPrice: paidSessions > 0 ? Math.round(paidAmount / paidSessions) : 0,
    expiresAt: expiryPass ? expiryPass.expiresAt : null,
    category: expiryPass ? text(expiryPass.category) : "",
    /* 지금 쓰이는 회원권의 짝. 만료일·카테고리와 같은 회원권에서 읽는다 --
       화면이 한 카드 안에서 서로 다른 회원권을 말하지 않게. */
    partnerClientId: expiryPass ? partnerClientId(expiryPass, clientId) : "",
    instructorIds: [...instructorIds],
  };
}

/** Firestore Timestamp 도 Date 도 문자열도 온다. 못 읽으면 맨 뒤로 보낸다. */
function toDate(value) {
  if (value && typeof value.toDate === "function") return value.toDate();
  const at = value instanceof Date ? value : new Date(String(value ?? ""));
  return Number.isFinite(at.getTime()) ? at : new Date(8640000000000000);
}

/** 화면이 쓰는 날짜 형식(YYYY-MM-DD). 읽지 못하면 빈 문자열이다. */
function isoDay(value) {
  if (value === null || value === undefined || value === "") return "";
  const at = toDate(value);
  if (at.getTime() === 8640000000000000) return "";
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
}

/* 조직 회원의 상태를 레거시 화면이 읽는 값으로 옮긴다. 레거시는 active/hold/
   ended 를 보고 구역을 나눈다. */
const STATUS_BY_CLIENT_STATUS = { active: "active", hold: "hold", ended: "ended", deleted: "ended", inactive: "ended" };

/**
 * 화면이 쓸 회원 목록 하나를 만든다. 읽지도 쓰지도 않는다.
 *
 * @param {{
 *   clients?: Array<any>, members?: Array<any>, passes?: Array<any>, now?: Date,
 *   hiddenClientIds?: Array<string>,
 * }} input
 *   clients 조직 회원 (organizations/{org}/clients)
 *   members 기기에 저장된 레거시 회원 (db.members)
 *   passes  조직 회원권. 잔여와 담당 강사가 여기서 온다
 *   hiddenClientIds 이 기기에서만 숨긴 조직 회원
 */
export function mergeRoster(input = {}) {
  const clients = Array.isArray(input.clients) ? input.clients : [];
  const members = Array.isArray(input.members) ? input.members : [];
  const passes = Array.isArray(input.passes) ? input.passes : [];
  const now = input.now instanceof Date ? input.now : new Date();
  /* 숨김은 이 기기의 화면 설정이다. 조직 회원은 강사가 지울 대상이 아니고 --
     지우면 그 회원의 기록과 사진이 함께 사라진다 -- 목록이 길다는 문제는
     안 보이게 하는 것으로 풀린다. 데이터는 그대로 남고, 다른 강사에게도
     대표에게도 영향이 없다.

     status 로 숨기지 않는 이유: 아래 merge 가 조직 회원의 status 를 client
     문서에서 다시 읽어 덮어쓴다. 기기에 적어 둔 상태는 다음 병합에서 사라진다. */
  const hidden = new Set((Array.isArray(input.hiddenClientIds) ? input.hiddenClientIds : []).map(text).filter(Boolean));

  const byPhone = new Map();
  const byName = new Map();
  for (const member of members) {
    const key = keysOf(member);
    if (key.phone && !byPhone.has(key.phone)) byPhone.set(key.phone, member);
    if (key.name && !byName.has(key.name)) byName.set(key.name, member);
  }

  const linked = new Set();
  const roster = clients.map((client) => {
    const key = keysOf(client);
    /* 연락처로 먼저, 없으면 이름으로. 한 레거시 회원이 두 조직 회원에 달라붙지
       않도록 이미 쓴 것은 건너뛴다 -- 그러면 기록이 둘로 보인다. */
    let match = key.phone ? byPhone.get(key.phone) : null;
    if (match && linked.has(match.id)) match = null;
    if (!match && key.name) {
      const candidate = byName.get(key.name);
      if (candidate && !linked.has(candidate.id)) match = candidate;
    }
    const facts = passFactsFor(client.id, passes, now);
    const shared = {
      orgClientId: client.id,
      orgRemaining: facts.remaining,
      orgInstructorIds: facts.instructorIds,
      /* 레거시 잔여를 눌러 내린다. 화면의 left() 가 orgRemaining 을 더하므로
         표시는 조직 값 하나로 정해지고, 옛 차감 경로는 줄일 것을 잃는다. */
      regular: 0,
      service: 0,
      /* 누적 등록·만료일·회당 금액은 조직 회원권에서 온다. 레거시 값을 그대로
         두면 이 세 칸이 기기에 남은 옛 숫자를 보여주고, 잔여만 조직 값이라
         한 카드 안에서 두 출처가 섞인다. */
      total: facts.registeredTotal,
      contractEnd: isoDay(facts.expiresAt),
      orgUnitPrice: facts.unitPrice,
      /* 상품 이름은 회원권에 없다(productId 뿐이다). 카테고리라도 적어 두지
         않으면 잔여 29회 옆에 "이용권 없음" 이 선다. */
      passName: facts.category ? PAY_CATEGORY_LABELS[facts.category] || facts.category : "",
      name: text(client.name) || text(match?.name),
      phone: text(client.phone) || text(match?.phone),
      status: STATUS_BY_CLIENT_STATUS[text(client.status)] || "active",
      /* 짝의 clientId. 화면이 쓰는 duetWith 는 회원 id 라, 목록이 다 만들어진
         뒤에 한 번 더 돌면서 옮긴다 -- 맞물린 회원은 둘이 다르다. */
      orgPartnerClientId: facts.partnerClientId,
    };
    if (match) {
      linked.add(match.id);
      /* id 를 바꾸지 않는다. 바꾸면 notes 와 photos[id] 가 가리킬 곳을 잃는다 --
         이 모듈이 저장소를 옮기지 않는다는 말의 실제 내용이 이 한 줄이다. */
      return { ...match, ...shared, rosterSource: ROSTER_SOURCE.ORG_LINKED };
    }
    return {
      id: client.id,
      instructor: "",
      goal: "",
      passName: "",
      duetWith: "",
      startDate: "",
      contractEnd: "",
      focus: [],
      notes: [],
      inbody: [],
      payments: [],
      perf: [],
      ...shared,
      rosterSource: ROSTER_SOURCE.ORG,
    };
  });

  /* 어느 조직 회원과도 맞지 않은 레거시 회원. 이관 직후에는 연락처가 달라
     못 맞춘 같은 사람이 여기 섞인다 -- 화면이 그 가능성을 말한다.

     잔여는 여기서도 보여주지 않는다. 조직 회원권이 없으니 쓸 수 있는 회차를
     아는 방법이 없고, 레거시 숫자를 보여주면 강사가 그것으로 수업을 센다. */
  const leftovers = members
    .filter((member) => !linked.has(member.id))
    .map((member) => ({
      ...member,
      orgClientId: "",
      orgRemaining: 0,
      orgInstructorIds: [],
      regular: 0,
      service: 0,
      total: 0,
      rosterSource: ROSTER_SOURCE.LOCAL_ONLY,
    }));

  /* ── duetWith 를 회원권에서 유도한다 ──────────────────────────────────
     레거시의 duetWith 는 대표가 손으로 고르던 값이고 회차·급여에는 닿지 않는
     표시용 포인터였다 -- 목록에서 짝을 붙여 보이고, 뱃지를 달고, 개인/듀엣
     필터를 가른다.

     이제 그 값이 회원권에서 나온다. 손으로 고르던 것을 그대로 두면 회원권은
     듀엣인데 화면은 개인이라고 말하는 회원이 생긴다 -- 둘이 어긋날 수 있는
     한, 어긋난 쪽을 믿는 사람이 반드시 나온다.

     덕분에 화면 코드는 한 줄도 바뀌지 않는다. pairUp 도 뱃지도 필터도 이
     필드 하나만 본다. */
  const byClientId = new Map(roster.map((member) => [text(member.orgClientId), member]));
  const paired = roster.map((member) => {
    const partner = byClientId.get(text(member.orgPartnerClientId));
    /* 짝을 목록에서 못 찾으면(숨겨졌거나 아직 안 올라왔거나) 레거시 값을
       그대로 둔다. 빈 값으로 덮으면 뱃지가 이유 없이 사라진다. */
    if (!partner) return member;
    /* 이름도 함께 싣는다. 동의 화면이 "누가 동의하지 않았는지" 를 말해야 하는데
       (듀엣은 두 사람 모두 동의해야 한다), 그 화면은 회원 하나만 들고 있어서
       id 만으로는 이름을 찾을 수 없다. */
    return { ...member, duetWith: text(partner.id), duetWithName: text(partner.name) };
  });

  const all = [...paired, ...leftovers];
  /* 숨긴 회원은 목록에서 빼되 세어서 돌려준다. 몇 명을 숨겼는지 모르면 되돌릴
     길이 없고, 되돌릴 수 없는 숨김은 삭제와 다를 바가 없다. */
  const visible = hidden.size === 0
    ? all
    : all.filter((member) => !hidden.has(text(member.orgClientId)) && !hidden.has(text(member.id)));
  return {
    roster: visible,
    unlinkedLocal: leftovers.filter((member) => !hidden.has(text(member.id))),
    hiddenCount: all.length - visible.length,
  };
}

/** 숨김 목록에 쓸 값. 조직 회원은 clientId 로, 기기 회원은 그 id 로 숨긴다. */
export const rosterHideKey = (member) => text(member?.orgClientId) || text(member?.id);

/** 이 줄이 조직 목록을 거쳐 왔는가. 옛 차감 경로를 막는 판정이다. */
export const isRosterMember = (member) => Boolean(member?.rosterSource);

/** 센터에 등록되지 않은 회원인가. 화면이 구역을 나누는 데 쓴다. */
export const isUnlinkedLocalMember = (member) => member?.rosterSource === ROSTER_SOURCE.LOCAL_ONLY;

/** 이 강사의 회원인가. "내 회원" 필터의 기준이다. */
export const isMyRosterMember = (member, instructorId) => {
  const id = text(instructorId);
  if (!id) return false;
  return (member?.orgInstructorIds || []).includes(id);
};
