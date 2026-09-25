"use strict";

/**
 * 회원 연락처 변경 — 누가 바꿀 수 있고, 무엇이 막는가.
 *
 * 순수 판정만 있다. 읽지도 쓰지도 않으므로 경계값을 전부 테스트로 고정할 수
 * 있고, 저장소(client-phone-store.js)는 이 판정을 부르기만 한다.
 *
 * ── 왜 서버인가 ──
 * 번호는 **회원의 정체**다. 회원 앱이 인증된 번호로 명부를 찾고
 * (member-link-store.js 의 findClientsByPhone), 엑셀 이관이 번호로 문서 id 를
 * 만든다. 그래서 번호를 바꾸는 일은 세 가지가 함께 일어나야 한다.
 *
 *   1. 같은 센터에 그 번호를 쓰는 다른 회원이 없을 것
 *   2. 이전 번호를 남길 것 (엑셀 재업로드가 그것을 보고 막는다)
 *   3. 이미 연결된 계정이면 끊을 것 -- 남의 번호로 남의 잔여를 보게 둘 수 없다
 *
 * 1번은 쿼리이고 3번은 여러 문서를 건드린다. 규칙으로는 둘 다 못 하므로
 * callable 이고, 규칙은 클라이언트가 phone 을 직접 못 쓰게 잠근다.
 *
 * ── clientId 는 절대 바뀌지 않는다 ──
 * 이관이 만든 `csv_01012345678` 은 그 회원의 주소다. 원장·누적·수업이 전부
 * 그 id 를 가리키고 있어, 바꾸는 순간 그 회원의 과거가 통째로 끊긴다.
 * **id 와 번호가 달라도 정상이다.**
 */

/** 막는 이유. 화면이 이 코드로 문구를 고른다. */
const PHONE_EDIT = Object.freeze({
  /** 010 으로 시작하는 11자리가 아니다. */
  INVALID: "phone_invalid",
  /** 바꿀 것이 없다. */
  SAME: "phone_same",
  /** 이 역할은 연락처를 바꾸지 못한다. */
  NOT_ALLOWED: "phone_not_allowed",
  /** 강사인데 이 회원의 담당이 아니다. */
  NOT_MY_CLIENT: "phone_not_my_client",
  /** 강사 하루 한도를 넘었다. */
  DAILY_LIMIT: "phone_daily_limit",
  /** 같은 센터의 다른 회원이 이미 쓰는 번호다. */
  DUPLICATE: "phone_duplicate",
  /** 그 회원이 없다. */
  NO_CLIENT: "phone_no_client",
});

/** 강사가 하루에 바꿀 수 있는 건수. 대표·FC매니저에게는 한도가 없다. */
const INSTRUCTOR_DAILY_LIMIT = 10;

/** 연락처를 바꿀 수 있는 역할. 강사는 자기 회원만이라 따로 본다. */
const FULL_EDIT_ROLES = Object.freeze(["owner", "manager"]);

const text = (value) => String(value ?? "").trim();
const digitsOf = (value) => String(value ?? "").replace(/\D/g, "");

/**
 * 한국 휴대폰 번호인가.
 *
 * 010 열한 자리만 받는다. 011·016 같은 옛 식별번호는 2021년에 사라졌고,
 * 지역번호를 받으면 그 번호로는 회원 앱에 로그인할 수 없다 -- 문자 인증이
 * 휴대폰에만 간다. 받아 두고 로그인이 안 되는 것이 거절보다 나쁘다.
 */
function isMobilePhone(value) {
  const digits = digitsOf(value);
  return digits.length === 11 && digits.startsWith("010");
}

/**
 * 이 회원의 활성 회원권을 이 강사가 맡고 있는가.
 *
 * 듀엣이면 clientIds 에 들어 있는 것도 자기 회원이다 -- 짝의 번호를 못 고치면
 * 그 회원은 아무 강사에게도 속하지 않은 것이 된다.
 *
 * @param {Array<any>} passes @param {string} clientId @param {string} instructorId
 */
function teachesClient(passes, clientId, instructorId) {
  const client = text(clientId);
  const instructor = text(instructorId);
  if (!client || !instructor) return false;
  return (Array.isArray(passes) ? passes : []).some((pass) => {
    if (text(pass?.status) !== "active") return false;
    if (text(pass?.instructorId) !== instructor) return false;
    const listed = Array.isArray(pass?.clientIds) ? pass.clientIds.map(text) : [];
    return text(pass?.clientId) === client || listed.includes(client);
  });
}

/**
 * 하루를 가르는 열쇠. **한국 시간 자정 기준이다.**
 *
 * UTC 로 세면 한국의 오전 9시에 날짜가 바뀐다 -- 강사에게는 하루 중간에
 * 한도가 초기화되는 것으로 보이고, 그 시각을 아는 사람은 아무도 없다.
 *
 * @param {Date} now @returns {string} `2026-09-25`
 */
function kstDayKey(now) {
  const at = now instanceof Date && Number.isFinite(now.getTime()) ? now : new Date();
  const kst = new Date(at.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

/**
 * 이 변경이 가능한가.
 *
 * 중복 검사는 여기서 하지 않는다 -- 쿼리라서 저장소가 한다. 나머지 전부는
 * 여기서 끝난다.
 *
 * @param {{
 *   role?: string, actorId?: string, client?: any, passes?: Array<any>,
 *   newPhone?: string, usedToday?: number, now?: Date,
 * }} input
 * @returns {{ ok: boolean, code?: string, phone?: string, limit?: number }}
 */
function decidePhoneEdit(input) {
  const role = text(input?.role);
  const client = input?.client || null;
  if (!client) return { ok: false, code: PHONE_EDIT.NO_CLIENT };

  const phone = digitsOf(input?.newPhone);
  if (!isMobilePhone(phone)) return { ok: false, code: PHONE_EDIT.INVALID };
  if (phone === digitsOf(client.phone)) return { ok: false, code: PHONE_EDIT.SAME };

  if (FULL_EDIT_ROLES.includes(role)) return { ok: true, phone };

  if (role !== "instructor") return { ok: false, code: PHONE_EDIT.NOT_ALLOWED };

  /* 강사는 자기 회원만. 서버가 본다 -- 화면이 버튼을 감추는 것과 서버가
     거부하는 것은 다른 일이고, 화면만 감추면 그것은 잠긴 문이 아니다. */
  const clientId = text(client.clientId || client.id);
  if (!teachesClient(input?.passes, clientId, input?.actorId)) {
    return { ok: false, code: PHONE_EDIT.NOT_MY_CLIENT };
  }

  /* 도배 방지. 한 강사가 하루에 열 건까지다 -- 명부를 훑으며 번호를 바꿔
     보는 일을 막되, 하루치 정정은 넉넉히 되게 둔다. */
  const used = Number(input?.usedToday) || 0;
  if (used >= INSTRUCTOR_DAILY_LIMIT) {
    return { ok: false, code: PHONE_EDIT.DAILY_LIMIT, limit: INSTRUCTOR_DAILY_LIMIT };
  }
  return { ok: true, phone };
}

/**
 * 중복일 때 뭐라고 답할 것인가.
 *
 * **강사에게는 회원 이름을 주지 않는다.** 번호 하나로 "이 번호는 박두리
 * 회원의 것" 을 알아낼 수 있으면, 그것은 남의 명부를 한 명씩 조회하는
 * 길이다 -- 강사 명부를 좁혀 둔 것과 같은 선이다.
 *
 * @param {{ role?: string, owner?: any }} input
 * @returns {{ code: string, clientName?: string }}
 */
function duplicateAnswer(input) {
  const role = text(input?.role);
  const found = { code: PHONE_EDIT.DUPLICATE };
  if (!FULL_EDIT_ROLES.includes(role)) return found;
  const name = text(input?.owner?.name);
  return name ? { ...found, clientName: name } : found;
}

module.exports = {
  FULL_EDIT_ROLES,
  INSTRUCTOR_DAILY_LIMIT,
  PHONE_EDIT,
  decidePhoneEdit,
  duplicateAnswer,
  isMobilePhone,
  kstDayKey,
  teachesClient,
};
