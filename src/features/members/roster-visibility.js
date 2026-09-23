/**
 * 강사가 명부에서 무엇을 보는가.
 *
 * ── 이것은 경계가 아니다 ──
 * 규칙은 지금도 강사에게 센터 전체 명부를 열어 준다 (`clients` list 가
 * owner·manager·instructor·staff). 그래서 여기서 하는 일은 **화면이 먼저
 * 보여 주지 않는 것**이고, 마음먹은 사람을 막지는 못한다.
 *
 * 그것을 알고도 화면부터 고치는 이유가 둘이다. 하나, 강사가 일상적으로 120명의
 * 연락처를 스크롤하며 지나갈 이유가 없다 -- 대부분의 노출은 악의가 아니라
 * 그냥 거기 있어서 일어난다. 둘, 규칙으로 막으려면 회원 문서에 담당 강사를
 * 적고(지금은 회원권에만 있다) 대타 경로를 먼저 설계해야 하는데, 그 설계
 * 없이 규칙부터 조이면 대타 강사가 차감을 못 한다.
 *
 * 규칙 차단은 대타 경로가 정해진 뒤다 (docs/handoff.md).
 */

const text = (value) => String(value ?? "").trim();

/** 연락처 전체를 보는 역할. 등록·연락·정산을 하는 사람들이다. */
const FULL_CONTACT_ROLES = Object.freeze(["owner", "manager", "staff"]);

/** 명부 전체를 훑을 수 있는 역할. 강사는 자기 회원부터 본다. */
const BROWSE_ALL_ROLES = Object.freeze(["owner", "manager", "staff"]);

/** 이 역할이 연락처 전체를 보는가. */
export const showsFullPhone = (role) => FULL_CONTACT_ROLES.includes(text(role));

/** 이 역할이 명부를 목록으로 훑을 수 있는가. */
export const canBrowseAllClients = (role) => BROWSE_ALL_ROLES.includes(text(role));

/**
 * 이 역할에게 보여 줄 연락처.
 *
 * 강사에게는 뒤 4자리만. 동명이인을 가르는 데는 그것으로 충분하고 -- 발급
 * 화면의 중복 안내가 이미 뒷자리로 말한다 -- 전화를 거는 일은 센터가 한다.
 *
 * @param {unknown} phone @param {string} role
 * @param {{ full?: (digits: string) => string }} [options]
 *   full 전체를 보는 역할에게 쓸 서식. 없으면 숫자 그대로.
 */
export function phoneForViewer(phone, role, options = {}) {
  const digits = text(phone).replace(/\D/g, "");
  if (!digits) return "";
  if (showsFullPhone(role)) {
    return typeof options.full === "function" ? options.full(digits) : digits;
  }
  /* 4자리가 안 되는 값은 자를 것이 없다. 있는 그대로 두면 그것이 곧 전체라
     가리는 의미가 없으므로, 번호가 있다는 사실만 말한다. */
  return digits.length >= 4 ? `···${digits.slice(-4)}` : "···";
}

/**
 * 내가 맡은 회원인가. 회원권의 담당 강사로 판정한다.
 *
 * 회원 문서에는 담당 강사가 없다. 명부를 읽는 쪽이 회원권에서 끌어와야 하고,
 * 그래서 이 함수는 회원이 아니라 **회원권 목록**을 받는다.
 *
 * @param {Array<any>} passes @param {string} clientId @param {string} instructorId
 */
export function isMyClient(passes, clientId, instructorId) {
  const client = text(clientId);
  const instructor = text(instructorId);
  if (!client || !instructor) return false;
  return (Array.isArray(passes) ? passes : []).some((pass) => (
    text(pass?.instructorId) === instructor
    && (text(pass?.clientId) === client
      || (Array.isArray(pass?.clientIds) && pass.clientIds.map(text).includes(client)))
  ));
}

/**
 * 대타 경로. **이름을 전부 입력해야 남의 회원이 나온다.**
 *
 * 강사가 대타로 들어가는 일은 실제로 있고, 그때 차감을 못 하면 그 회차는
 * 아무에게도 지급되지 않는다. 그래서 길을 닫지는 않는다.
 *
 * 다만 목록으로 훑지는 못하게 한다 -- 한 글자로 스무 명이 나오면 그것은
 * 명부를 여는 것과 같다. 이름을 정확히 아는 사람만 그 한 명을 찾는다.
 *
 * @param {Array<any>} clients @param {string} query
 */
export function exactNameMatches(clients, query) {
  const wanted = text(query);
  if (!wanted) return [];
  return (Array.isArray(clients) ? clients : [])
    .filter((client) => text(client?.name) === wanted);
}

/**
 * 강사가 검색으로 볼 수 있는 회원.
 *
 * 내 회원은 부분 일치로 찾고, 남의 회원은 이름 전체가 같아야 한다. 결과에
 * 같은 사람이 두 번 들어가지 않는다.
 *
 * @param {{ clients: Array<any>, passes: Array<any>, instructorId: string,
 *   query: string, browseAll?: boolean, matches?: (client: any, query: string) => boolean }} input
 */
export function visibleClients(input = {}) {
  const clients = Array.isArray(input.clients) ? input.clients : [];
  const query = text(input.query);
  const matches = typeof input.matches === "function"
    ? input.matches
    : (client, wanted) => text(client?.name).includes(wanted);

  // 대표·FC매니저는 지금과 같다. 좁히는 것은 강사뿐이다.
  if (input.browseAll) return clients.filter((client) => !query || matches(client, query));

  const mine = clients.filter((client) => (
    isMyClient(input.passes, text(client?.id), input.instructorId)
  ));
  const shown = mine.filter((client) => !query || matches(client, query));
  if (!query) return shown;

  /* 이름을 전부 친 경우에만 남의 회원이 더해진다. */
  const seen = new Set(shown.map((client) => text(client?.id)));
  const others = exactNameMatches(clients, query)
    .filter((client) => !seen.has(text(client?.id)));
  return [...shown, ...others];
}
