/**
 * 연락처 수정 — 화면이 보여 줄지, 그리고 실패를 뭐라고 말할지.
 *
 * 판정의 원본은 서버다 (functions/src/client-phone.js). 여기가 하는 일은
 * **버튼을 보여 줄지 정하는 것**뿐이고, 그것은 보안이 아니라 친절이다 --
 * 눌러도 거부될 버튼을 두지 않으려는 것이다. 서버가 같은 것을 다시 본다.
 *
 * 두 곳에서 판단하는 것이 위험한 것은 한쪽만 고쳐질 때다. 그래서 이 파일은
 * 서버가 쓰는 코드 문자열을 그대로 받아 문구만 고른다 -- 판정을 흉내 내지
 * 않는다.
 */

import { isMyClient } from "./roster-visibility.js";

/**
 * 회원을 가리지 않고 고칠 수 있는 역할. 서버의 FULL_EDIT_ROLES 와 같아야 한다
 * (functions/src/client-phone.js) -- 테스트가 두 목록을 견준다.
 *
 * staff 는 번호를 **볼** 수는 있어도(roster-visibility 의 showsFullPhone)
 * 고치지는 못한다. 보는 것과 고치는 것은 다른 일이고, 보는 쪽 목록을 그대로
 * 쓰면 눌러도 서버가 거부하는 버튼이 생긴다.
 */
export const FULL_EDIT_ROLES = Object.freeze(["owner", "manager"]);

/** 서버가 돌려주는 코드. functions/src/client-phone.js 의 PHONE_EDIT 와 같다. */
export const PHONE_EDIT_CODE = Object.freeze({
  INVALID: "phone_invalid",
  SAME: "phone_same",
  NOT_ALLOWED: "phone_not_allowed",
  NOT_MY_CLIENT: "phone_not_my_client",
  DAILY_LIMIT: "phone_daily_limit",
  DUPLICATE: "phone_duplicate",
  NO_CLIENT: "phone_no_client",
});

/**
 * 이 사람이 이 회원의 연락처를 고칠 수 있는가.
 *
 * 대표·FC매니저는 전부, 강사는 자기 회원만. 강사 판정은 담당 회원권으로
 * 하고(roster-visibility 의 isMyClient), 듀엣의 짝도 자기 회원이다.
 *
 * @param {{ role?: string, clientId?: string, instructorId?: string, passes?: Array<any> }} input
 */
export function canEditPhone(input) {
  const role = String(input?.role ?? "").trim();
  if (FULL_EDIT_ROLES.includes(role)) return true;
  if (role !== "instructor") return false;
  return isMyClient(input?.passes, input?.clientId, input?.instructorId);
}

/**
 * 실패를 뭐라고 말할 것인가.
 *
 * **중복일 때 강사에게는 회원 이름을 주지 않는다.** 서버가 애초에 이름을
 * 실어 보내지 않지만(duplicateAnswer), 화면도 이름이 없을 때를 제대로
 * 말해야 한다 -- 빈 이름으로 "이미  회원 번호예요" 가 나가면 그게 더 나쁘다.
 *
 * @param {{ code?: string, clientName?: string, limit?: number }} failure
 */
export function phoneEditMessage(failure) {
  const code = String(failure?.code ?? "").trim();
  const name = String(failure?.clientName ?? "").trim();
  switch (code) {
    case PHONE_EDIT_CODE.INVALID:
      return "010으로 시작하는 11자리를 입력해 주세요.";
    case PHONE_EDIT_CODE.SAME:
      return "지금 번호와 같습니다.";
    case PHONE_EDIT_CODE.DUPLICATE:
      return name
        ? `이미 ${name} 회원 번호예요 — 같은 분이면 회원 합치기가 필요합니다.`
        : "이미 등록된 번호예요. 대표님께 문의해 주세요.";
    case PHONE_EDIT_CODE.DAILY_LIMIT:
      return "오늘은 더 바꿀 수 없어요. 대표님께 문의해 주세요.";
    case PHONE_EDIT_CODE.NOT_MY_CLIENT:
      return "담당 회원만 바꿀 수 있어요.";
    case PHONE_EDIT_CODE.NOT_ALLOWED:
      return "이 계정은 연락처를 바꿀 수 없어요.";
    case PHONE_EDIT_CODE.NO_CLIENT:
      return "그 회원을 찾지 못했어요.";
    default:
      // 코드 없는 "오류가 발생했습니다" 는 금지다.
      return `바꾸지 못했어요 (코드 ${code || "unknown"})`;
  }
}

/**
 * 감사 목록에 적을 번호. **가운데를 가린다.**
 *
 * 대표 화면이 "누가 무엇을 무엇으로 바꿨나" 를 보는 자리라 번호가 필요하지만,
 * 전체를 늘어놓을 이유는 없다 -- 앞 세 자리와 뒤 네 자리면 어느 번호였는지
 * 알아보는 데 충분하다.
 *
 * @param {string} phone
 */
export function maskPhone(phone) {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (digits.length < 8) return digits ? "···" : "";
  return `${digits.slice(0, 3)}····${digits.slice(-4)}`;
}
