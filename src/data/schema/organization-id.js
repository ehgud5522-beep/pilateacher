/**
 * 조직 id는 소속 문서 id `{organizationId}_{userId}` 의 앞부분이 된다. 조직 id에
 * "_" 가 섞이면 `a_b` + `c` 와 `a` + `b_c` 가 같은 문서 id가 되어 경계가
 * 모호해진다. 그래서 발급 시점에 소문자·숫자·하이픈만 허용한다.
 *
 * 규칙의 membershipId() 헬퍼는 조립만 하고 분해하지 않지만, 이 값으로 만든
 * 문서를 사람이 읽고 운영자가 검색한다.
 */
export const ORGANIZATION_ID_PATTERN = /^[a-z0-9-]+$/;

/** @param {unknown} value */
export function isOrganizationId(value) {
  return typeof value === "string" && ORGANIZATION_ID_PATTERN.test(value);
}

/**
 * @param {unknown} value
 * @param {string} label
 */
export function assertOrganizationId(value, label = "organizationId") {
  if (!isOrganizationId(value)) throw new Error(`Invalid ${label}`);
  return value;
}
