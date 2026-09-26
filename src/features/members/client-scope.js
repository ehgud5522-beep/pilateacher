/**
 * 누가 어느 회원을 보는가 — **한 곳에서만 정한다.**
 *
 * ── 왜 함수 하나인가 ──
 * 회원 목록이 나오는 자리가 여럿이다. 회원 탭, 검색, 일정 추가, 회원권 발급,
 * 급여 상세, 변화 기록, 엑셀 이관. 화면마다 따로 거르면 **한 화면만 빠뜨린
 * 날 그 화면이 명부 전체를 연다** -- 그리고 그 사실은 아무 데도 나타나지 않는다.
 *
 * 그래서 거르는 일을 화면에서 빼고 조회에 붙인다. 부르는 쪽은 "누가 보는가"
 * 만 넘기고, 무엇이 돌아올지는 여기가 정한다.
 *
 * ── 이것은 편의가 아니라 경계다 ──
 * 0-10 때의 좁히기는 화면이 안 보여 주는 것이었고 규칙은 열려 있었다. 이번은
 * 다르다. 같은 판정을 규칙이 `instructorIds` 로 강제하므로, 여기서 안 좁히면
 * 3단계 이후 **조회가 통째로 거부된다** (조건 없는 목록 읽기는 규칙이 막는다).
 *
 * 배경은 docs/instructor-scope-plan.md.
 */

import { ROLES } from "../../data/schema/constants.js";

/**
 * 본인 담당 회원만 보는 역할.
 *
 * **규칙의 강사 분기와 같은 목록이어야 한다.** 한쪽에만 역할이 있으면 그
 * 역할은 화면에서 보이는데 서버가 거부하거나, 반대로 화면이 숨긴 것을 서버가
 * 내준다. 테스트가 두 목록을 묶어 둔다.
 */
export const SCOPED_ROLES = Object.freeze([ROLES.INSTRUCTOR]);

/**
 * 전체 명부를 보는 역할. 대표와 FC매니저다.
 *
 * `staff` 는 여기 둔다 -- 이번 작업이 정한 것은 "강사는 본인 회원만" 이고
 * 직원의 범위는 아직 정해진 적이 없다. 정하지 않은 것을 조용히 좁히면 그
 * 사람의 화면이 이유 없이 빈다.
 */
export const FULL_SCOPE_ROLES = Object.freeze([ROLES.OWNER, ROLES.MANAGER, ROLES.STAFF]);

/**
 * 이 사람이 회원을 조회할 때 붙는 조건.
 *
 * @param {{ role?: string, isLegacy?: boolean }} organization
 * @param {string} currentUserId
 * @returns {{ instructorId: string }} 빈 문자열이면 전체를 본다.
 */
export function clientScopeFor(organization, currentUserId) {
  /* 미소속 개인 강사에게는 조직도 담당도 없다. 본인 기기의 명부가 전부다. */
  if (organization?.isLegacy) return { instructorId: "" };
  const role = String(organization?.role || "").trim();
  if (!SCOPED_ROLES.includes(role)) return { instructorId: "" };
  const userId = String(currentUserId || "").trim();
  /* 역할은 강사인데 uid 를 모르면 **아무것도 보여 주지 않는다.** 여기서 전체를
     돌려주면 로그인 정보를 못 읽은 순간이 명부를 여는 순간이 된다. */
  return { instructorId: userId || NO_CLIENTS };
}

/**
 * 아무 회원도 가리키지 않는 값. 실제 uid 와 겹칠 수 없는 철자여야 한다 --
 * 겹치면 그 사람의 회원이 "못 읽는 상태" 에 노출된다.
 */
export const NO_CLIENTS = "__no_instructor__";

/** 이 조회가 좁혀진 것인가. 화면이 "내 회원만 보입니다" 를 말할 때 쓴다. */
export const isScopedToInstructor = (scope) => Boolean(scope?.instructorId);
