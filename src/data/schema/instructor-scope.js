/**
 * 강사가 보는 회원의 범위, 그리고 만료·재등록 판정.
 *
 * **원본은 functions/shared/instructor-scope.mjs 에 있다.** 이유는 phone.mjs 와
 * 같다 -- clients.instructorIds 를 채우는 트리거가 같은 판정을 써야 하는데,
 * Functions 는 functions/ 만 배포되므로 src/ 를 가져올 수 없다. 두 벌이 되면
 * 트리거가 채운 값과 화면이 세는 값이 서로 다른 규칙을 따르게 된다.
 *
 * 부르는 쪽은 여기서 가져오면 된다. 배경은 docs/instructor-scope-plan.md.
 */

export * from "../../../functions/shared/instructor-scope.mjs";
