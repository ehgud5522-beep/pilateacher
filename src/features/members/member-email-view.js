/**
 * 강사 관리에서 같은 이름의 계정을 이메일로 가린다 (2026-11-19 대표: "계정 교체 · 계정
 * 추가 때 이름이 같으면 구분이 어렵다, 기존 것이 어떤 이메일인지 확인이 필요하다").
 *
 * 이메일은 서버(listCentreMemberEmails)가 대표에게만 준다. 소속 문서에는 이메일이
 * 없다 -- users/{uid} 를 열면 전화번호까지 함께 열리기 때문이다.
 */

const text = (value) => String(value ?? "").trim();

/** 계정을 가리키는 한 줄: "박서연 · a@b.com". 이메일을 모르면 이름만. */
export function accountLabel(membership, emails) {
  const name = text(membership?.displayName) || text(membership?.userId);
  const email = text(emails?.[text(membership?.userId)]);
  return email ? `${name} · ${email}` : name;
}

/**
 * 이 이름을 쓰는 다른 계정 전부 (재직 · 퇴사 모두). 강사 추가 화면이 "같은 이름의
 * 계정이 있어요 -- 이 이메일" 을 말할 때 쓴다.
 */
export function sameNameMembers(members, displayName, exceptUserId = "") {
  const wanted = text(displayName);
  if (!wanted) return [];
  return (Array.isArray(members) ? members : []).filter((item) => (
    text(item?.displayName) === wanted && text(item?.userId) !== text(exceptUserId)
  ));
}

/** 이메일 목록을 못 읽었을 때. 코드 없이 숨기지 않는다. */
export function emailsFailure(thrown) {
  const code = text(thrown?.details?.code) || text(thrown?.code) || "unknown";
  return `이메일을 불러오지 못했어요 (코드 ${code})`;
}
