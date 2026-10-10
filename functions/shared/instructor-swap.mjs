/**
 * 강사 계정 교체 — **같은 사람인데 로그인 계정만 바뀐다.**
 *
 * ── 왜 생겼는가 ──
 * 2026-10, 반송점 점장이 애플 로그인(privaterelay)에서 gmail 로 옮기려 했다.
 * 대표는 옛 소속을 퇴사 처리하고 새 계정을 강사로 추가했는데, 그러자 그 사람의
 * 10월 수업이 급여에서 흩어졌다 -- 원장은 옛 uid 를 들고 있고 새 계정에는
 * 담당 회원도 누적도 없다.
 *
 * 퇴사와 교체는 다른 일이다. 퇴사는 그 사람이 나간 것이고, 교체는 **그대로
 * 있는데 문패만 바뀐 것**이다. 지금까지 앱에 그 구분이 없었다.
 *
 * ── 원장은 옮기지 않는다 ──
 * append-only 다. 옛 uid 로 박힌 차감은 그때 그 계정이 한 수업이고, 그것을
 * 고쳐 쓰면 "언제 무엇이 있었는가" 가 흔들린다. 대신 새 소속에 previousUids 를
 * 남기고, **급여와 누적을 세는 쪽이 둘을 한 사람으로 본다.**
 *
 * 옮기는 것은 앞으로를 가리키는 것들뿐이다: 직급·풀방금액 같은 소속 설정,
 * 회원권의 담당, 회원의 담당 목록, 누적 진행, 아직 오지 않은 일정.
 *
 * ── 누적은 더한다, 덮지 않는다 ──
 * 두 계정이 같은 회원을 맡은 적이 있으면 문서가 둘이다. 덮어쓰면 한쪽의
 * 횟수가 사라지고, 그 숫자는 급여 판정 3(누적 20회 미만)을 직접 움직인다.
 */

const text = (value) => String(value ?? "").trim();
const count = (value) => (Number.isInteger(Number(value)) && Number(value) >= 0 ? Number(value) : 0);

/**
 * 옛 소속에 남기는 표시. **퇴사와 구분한다.**
 *
 * 퇴사(revoked)로 두면 강사 목록에서 "나간 사람" 으로 읽히고, 대표는 그
 * 사람이 아직 다니는데 왜 나간 것으로 되어 있는지 매번 다시 묻게 된다.
 */
export const MEMBERSHIP_SWAPPED = "swapped";

/** 교체가 막히는 이유. 코드 없는 "할 수 없습니다" 를 남기지 않는다. */
export const SWAP_ERROR = Object.freeze({
  SAME_UID: "swap_same_uid",
  FROM_MISSING: "swap_from_missing",
  TO_MISSING: "swap_to_missing",
  DIFFERENT_ORG: "swap_different_organization",
  TO_NOT_ACTIVE: "swap_to_not_active",
  TO_ALREADY_SWAPPED: "swap_to_already_swapped",
  FROM_IS_OWNER: "swap_from_is_owner",
  /* 총괄매니저가 총괄매니저(나 대표)의 계정을 바꾸려 한 경우. 대표만이다 --
     소속 문서의 role 문과 같은 선이고, 같은 이유다. */
  ACTOR_BELOW_TARGET: "swap_actor_below_target",
});

/** 막힌 이유를 사람 말로. 고칠 방법까지 말한다. */
export const SWAP_ERROR_LABEL = Object.freeze({
  [SWAP_ERROR.SAME_UID]: "같은 계정입니다. 옮길 것이 없습니다.",
  [SWAP_ERROR.FROM_MISSING]: "옛 계정의 소속을 찾지 못했습니다.",
  [SWAP_ERROR.TO_MISSING]: "새 계정이 아직 이 센터의 강사가 아닙니다. 먼저 강사로 추가해 주세요.",
  [SWAP_ERROR.DIFFERENT_ORG]: "두 계정이 서로 다른 센터에 있습니다.",
  [SWAP_ERROR.TO_NOT_ACTIVE]: "새 계정이 재직 상태가 아닙니다.",
  [SWAP_ERROR.TO_ALREADY_SWAPPED]: "새 계정은 이미 다른 계정을 넘겨받았습니다.",
  [SWAP_ERROR.FROM_IS_OWNER]: "대표 계정은 이 통로로 바꾸지 않습니다. 콘솔에서 합니다.",
  [SWAP_ERROR.ACTOR_BELOW_TARGET]: "총괄매니저 계정 교체는 대표만 할 수 있습니다.",
});

/**
 * 이 소속이 품고 있는 옛 계정들.
 *
 * 한 사람이 두 번 바꿀 수 있다 (애플 → gmail → 회사 메일). 그때 앞의 것이
 * 떨어지면 그 기간의 급여가 다시 흩어진다.
 */
export function previousUidsOf(membership) {
  const list = Array.isArray(membership?.previousUids) ? membership.previousUids : [];
  return list.map(text).filter(Boolean);
}

/** 이 소속이 급여에서 자기 것으로 세는 uid 전부. 지금 것이 맨 앞이다. */
export function instructorIdsOf(membership) {
  const own = text(membership?.userId);
  const seen = new Set();
  return [own, ...previousUidsOf(membership)].filter((uid) => {
    if (!uid || seen.has(uid)) return false;
    seen.add(uid);
    return true;
  });
}

/**
 * 옛 uid 를 지금 uid 로 바꿔 주는 함수. **급여와 누적이 이것으로 합친다.**
 *
 * 모르는 uid 는 그대로 돌려준다 -- 소속 문서가 지워진 옛 계정의 원장도
 * 줄로는 서야 하고, 그때는 uid 가 곧 이름이다.
 *
 * @param {Array<any>} memberships
 * @returns {(instructorId: unknown) => string}
 */
export function canonicalInstructorIdFrom(memberships) {
  const byOld = new Map();
  for (const membership of Array.isArray(memberships) ? memberships : []) {
    const own = text(membership?.userId);
    if (!own) continue;
    for (const old of previousUidsOf(membership)) {
      /* 같은 옛 uid 가 두 소속에 적혀 있으면 어느 쪽이 맞는지 알 수 없다.
         먼저 온 것을 쓰고 덮지 않는다 -- 조용히 바뀌는 것보다 낫다. */
      if (!byOld.has(old)) byOld.set(old, own);
    }
  }
  return (instructorId) => byOld.get(text(instructorId)) ?? text(instructorId);
}

/**
 * 이 교체가 성립하는가. **서버가 쓰기 전에 이것을 먼저 본다.**
 *
 * @param {{ from?: any, to?: any, actorRole?: string }} input 두 소속 문서와 누르는 사람의 역할
 * @returns {string} 빈 문자열이면 통과
 */
export function swapError({ from, to, actorRole = "owner" } = {}) {
  const fromUid = text(from?.userId);
  const toUid = text(to?.userId);
  if (!from) return SWAP_ERROR.FROM_MISSING;
  if (!to) return SWAP_ERROR.TO_MISSING;
  if (!fromUid || !toUid || fromUid === toUid) return SWAP_ERROR.SAME_UID;
  if (text(from.organizationId) !== text(to.organizationId)) return SWAP_ERROR.DIFFERENT_ORG;
  /* 대표는 이 통로로 바꾸지 않는다. 규칙이 owner 를 앱에서 세우지 못하게 해
     두었고(memberships create), 여기로 열면 그 선이 뒤로 뚫린다. */
  if (text(from.role) === "owner" || text(to.role) === "owner") return SWAP_ERROR.FROM_IS_OWNER;
  /* 총괄매니저는 자기와 같은 자리를 건드리지 못한다. 교체는 그 사람의 로그인
     계정을 통째로 바꾸는 일이라, 열어 두면 총괄매니저가 다른 총괄매니저의
     자리를 자기가 아는 계정으로 옮길 수 있다 -- 규칙의 mayManageMembership 과
     같은 선이다. */
  if (text(actorRole) !== "owner"
    && (text(from.role) === "area_manager" || text(to.role) === "area_manager")) {
    return SWAP_ERROR.ACTOR_BELOW_TARGET;
  }
  if (text(to.status) !== "active") return SWAP_ERROR.TO_NOT_ACTIVE;
  /* 이미 누군가를 넘겨받은 계정에 또 얹지 않는다. 두 사람의 원장이 한 줄로
     합쳐지면 그것을 가르는 길이 없다. */
  if (previousUidsOf(to).length > 0 && !previousUidsOf(to).includes(fromUid)) {
    return SWAP_ERROR.TO_ALREADY_SWAPPED;
  }
  return "";
}

/**
 * 새 소속이 넘겨받는 설정. **급여를 움직이는 값들이다.**
 *
 * 새 계정에 이미 값이 있으면 그것을 둔다 -- 대표가 추가하면서 직접 넣었을 수
 * 있고, 옛 값으로 덮으면 방금 정한 것이 조용히 되돌아간다.
 */
export function swappedMembershipPatch(from, to) {
  const patch = {};
  const carry = (key) => {
    const current = to?.[key];
    const empty = current === undefined || current === null || current === "";
    if (empty && from?.[key] !== undefined && from?.[key] !== null && from?.[key] !== "") {
      patch[key] = from[key];
    }
  };
  carry("title");
  carry("fullRoomRate");
  carry("locationId");
  carry("displayName");
  /* 부원장은 플래그 하나가 급여 판정 1 그 자체다 (deduction-pricing.js).
     거짓이 기본값이라 "비어 있다" 로 세지 않고 따로 본다. */
  if (to?.isDeputyDirector !== true && from?.isDeputyDirector === true) {
    patch.isDeputyDirector = true;
  }
  /* 지금 uid 를 앞에 두지 않는다 -- previousUids 는 **옛 것만** 담는다.
     자기 자신이 들어가면 canonical 이 자기를 가리켜 무한히 맴돈다. */
  const merged = new Set([...previousUidsOf(to), ...previousUidsOf(from), text(from?.userId)]);
  merged.delete(text(to?.userId));
  merged.delete("");
  patch.previousUids = [...merged];
  return patch;
}

/**
 * 누적 진행 둘을 하나로. **더한다.**
 *
 * 두 계정이 같은 회원을 맡은 적이 있으면 문서가 둘이다. 덮어쓰면 한쪽이
 * 사라지고, 그 숫자는 급여 판정 3(누적 20회 미만)을 직접 움직인다.
 */
export function mergeTotals(fromTotal, toTotal) {
  return count(fromTotal?.sessions) + count(toTotal?.sessions);
}

/**
 * 두 번 눌러도 같은 결과인가. **이미 끝난 교체를 다시 돌리는가.**
 *
 * 대표가 느려서 한 번 더 누르는 일은 반드시 생긴다. 그때 두 번째가 무엇을
 * 더 옮기면 안 된다 -- 누적이 두 배가 되고, 그것은 되돌릴 수 없다.
 *
 * @param {{ from?: any, to?: any }} [input]
 */
export function alreadySwapped({ from, to } = {}) {
  return text(from?.status) === MEMBERSHIP_SWAPPED
    && previousUidsOf(to).includes(text(from?.userId));
}
