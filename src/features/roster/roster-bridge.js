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

/** 조직 회원권에서 오는 값. 쓸 수 있는 회차만 센다 -- 만료·취소분은 빼고. */
function passFactsFor(clientId, passes, now) {
  let remaining = 0;
  const instructorIds = new Set();
  for (const pass of passes) {
    if (pass?.clientId !== clientId) continue;
    /* 담당 강사는 만료된 회원권에서도 읽는다. 지난주에 만료됐다고 그 회원이
       내 회원이 아니게 되는 것은 아니고, "내 회원" 필터가 그 사람을 잃으면
       강사는 목록을 다시 만들기 시작한다. */
    if (pass.instructorId) instructorIds.add(pass.instructorId);
    if (!isDeductablePass(pass, now)) continue;
    remaining += remainingCountOf(pass);
  }
  return { remaining, instructorIds: [...instructorIds] };
}

/* 조직 회원의 상태를 레거시 화면이 읽는 값으로 옮긴다. 레거시는 active/hold/
   ended 를 보고 구역을 나눈다. */
const STATUS_BY_CLIENT_STATUS = { active: "active", hold: "hold", ended: "ended", deleted: "ended", inactive: "ended" };

/**
 * 화면이 쓸 회원 목록 하나를 만든다. 읽지도 쓰지도 않는다.
 *
 * @param {{
 *   clients?: Array<any>, members?: Array<any>, passes?: Array<any>, now?: Date,
 * }} input
 *   clients 조직 회원 (organizations/{org}/clients)
 *   members 기기에 저장된 레거시 회원 (db.members)
 *   passes  조직 회원권. 잔여와 담당 강사가 여기서 온다
 */
export function mergeRoster(input = {}) {
  const clients = Array.isArray(input.clients) ? input.clients : [];
  const members = Array.isArray(input.members) ? input.members : [];
  const passes = Array.isArray(input.passes) ? input.passes : [];
  const now = input.now instanceof Date ? input.now : new Date();

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
      total: 0,
      name: text(client.name) || text(match?.name),
      phone: text(client.phone) || text(match?.phone),
      status: STATUS_BY_CLIENT_STATUS[text(client.status)] || "active",
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

  return {
    roster: [...roster, ...leftovers],
    unlinkedLocal: leftovers,
  };
}

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
