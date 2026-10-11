/**
 * 공지사항 — **대표가 강사에게 한 번 보여주고 끝나는 글.**
 *
 * ── 왜 팝업인가 ──
 * 목록에만 두면 아무도 안 본다. 센터의 공지는 "봤는지" 가 요점이라 (단가가
 * 바뀐다, 다음 주 휴무다) 한 번은 눈앞에 세워야 하고, 본 뒤에는 다시 서면
 * 안 된다 -- 매번 뜨는 창은 곧 X 를 누르는 손버릇이 되고, 그때부터는 중요한
 * 공지도 안 읽힌다.
 *
 * ── 읽음은 본인만 적는다 ──
 * 읽었다는 기록은 그 사람의 것이다. 남이 대신 적으면 "읽음 N명" 이 거짓이
 * 되고, 그 숫자가 이 기능의 전부다.
 *
 * ── 대상 ──
 * 전체 · 지점 · 직급 · 역할. 비워 두면 전체다 -- 빈 목록을 "아무도 아님" 으로
 * 읽으면 공지를 쓰고 아무에게도 안 보이는 일이 생기고, 쓴 사람은 그것을 알
 * 길이 없다.
 *
 * 여러 조건을 함께 걸면 **모두 만족**해야 한다 (AND). 반송점 ∩ 점장처럼
 * 좁히는 것이 실제 쓰임이고, 합집합이면 "반송점 전체" 가 되어 놀란다.
 */

const text = (value) => String(value ?? "").trim();
const list = (value) => (Array.isArray(value) ? value.map(text).filter(Boolean) : []);

/** 공지 한 건이 가질 수 있는 필드 전부. 규칙의 hasOnly 와 같아야 한다. */
export const NOTICE_FIELDS = Object.freeze([
  "organizationId", "title", "body", "imageUrl", "linkUrl",
  "startsOn", "endsOn", "important",
  "locationIds", "titles", "roles",
  "status", "createdAt", "createdBy", "updatedAt", "updatedBy",
]);

/** 공지의 생애. 지우지 않고 종료한다 -- 읽음 기록이 가리킬 글이 사라지면 안 된다. */
export const NOTICE_STATUS = Object.freeze({
  ACTIVE: "active",
  ENDED: "ended",
});

export const NOTICE_TITLE_MAX = 60;
export const NOTICE_BODY_MAX = 2000;

/** 날짜 한 칸. 달력 날짜(YYYY-MM-DD)다 -- 절대 순간이 아니다. */
const isDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(text(value));

/**
 * 이 공지가 지금 기간 안인가.
 *
 * 날짜는 **달력 날짜**로 비교한다. 절대 순간으로 적으면 UTC 기기에서 하루
 * 어긋나고, 그러면 "오늘부터" 라고 쓴 공지가 어제 뜨거나 내일 뜬다.
 *
 * 종료일은 **그날까지 포함**이다. 사람이 "10일까지" 라고 쓸 때 10일을 빼고
 * 생각하지 않는다.
 */
export function noticeInWindow(notice, today) {
  const day = text(today);
  if (!isDay(day)) return false;
  if (text(notice?.status) === NOTICE_STATUS.ENDED) return false;
  const from = text(notice?.startsOn);
  const to = text(notice?.endsOn);
  if (isDay(from) && day < from) return false;
  if (isDay(to) && day > to) return false;
  return true;
}

/**
 * 이 사람이 이 공지의 대상인가.
 *
 * 빈 조건은 **전체**다. 조건을 여럿 걸면 모두 만족해야 한다.
 *
 * @param {any} notice
 * @param {{ locationId?: string, title?: string, role?: string }} who
 */
export function noticeTargets(notice, who) {
  const locations = list(notice?.locationIds);
  const titles = list(notice?.titles);
  const roles = list(notice?.roles);

  if (locations.length && !locations.includes(text(who?.locationId))) return false;
  if (titles.length && !titles.includes(text(who?.title))) return false;
  if (roles.length && !roles.includes(text(who?.role))) return false;
  return true;
}

/**
 * 지금 이 사람에게 띄울 공지들. **중요 → 최신 순이다.**
 *
 * 하나씩 띄우므로 순서가 곧 "무엇을 먼저 보는가" 다. 중요한 것을 뒤에 두면
 * 앞의 셋을 넘기다 손버릇으로 같이 넘긴다.
 *
 * @param {{
 *   notices?: Array<any>, readIds?: Set<string> | Array<string>,
 *   today?: string, who?: any,
 * }} input
 */
export function pendingNotices({ notices, readIds, today, who } = {}) {
  const read = readIds instanceof Set ? readIds : new Set(list(readIds));
  return (Array.isArray(notices) ? notices : [])
    .filter(Boolean)
    .filter((notice) => !read.has(text(notice.id)))
    .filter((notice) => noticeInWindow(notice, today))
    .filter((notice) => noticeTargets(notice, who))
    .sort((left, right) => (
      (right.important === true ? 1 : 0) - (left.important === true ? 1 : 0)
      || text(right.startsOn).localeCompare(text(left.startsOn))
      || text(right.id).localeCompare(text(left.id))
    ));
}

/**
 * 쓴 글이 성립하는가. 빈 문자열이면 통과다.
 *
 * 화면이 먼저 막지만 여기서도 본다 -- 규칙이 거부하면 화면에는
 * permission-denied 한 줄로만 돌아오고, 무엇이 잘못됐는지 알 수 없다.
 */
export function noticeError(draft) {
  const title = text(draft?.title);
  const body = text(draft?.body);
  if (!title) return "제목을 입력해 주세요.";
  if (title.length > NOTICE_TITLE_MAX) return `제목은 ${NOTICE_TITLE_MAX}자까지입니다.`;
  if (!body) return "내용을 입력해 주세요.";
  if (body.length > NOTICE_BODY_MAX) return `내용은 ${NOTICE_BODY_MAX}자까지입니다.`;
  const from = text(draft?.startsOn);
  const to = text(draft?.endsOn);
  if (from && !isDay(from)) return "시작일을 확인해 주세요.";
  if (to && !isDay(to)) return "종료일을 확인해 주세요.";
  if (from && to && to < from) return "종료일이 시작일보다 빠릅니다.";
  /* 링크는 http(s) 만 받는다. javascript: 같은 것이 들어오면 누르는 사람의
     앱 안에서 돈다 -- 공지를 쓰는 사람이 대표라도 그 문을 열어 둘 이유가 없다. */
  const link = text(draft?.linkUrl);
  if (link && !/^https?:\/\//i.test(link)) return "링크는 http 또는 https 로 시작해야 합니다.";
  return "";
}

/**
 * 읽음 기록의 문서 id. **한 사람이 한 공지에 하나다.**
 *
 * id 를 서버가 만들게 두면 같은 사람이 두 번 눌러 두 건이 되고, "읽음 N명" 이
 * 사람 수가 아니게 된다.
 */
export const noticeReadId = (noticeId, userId) => `${text(noticeId)}_${text(userId)}`;

/**
 * 읽음 집계. 대표 화면이 "N/전체" 와 안 읽은 사람을 여기서 얻는다.
 *
 * @param {{ notice?: any, audience?: Array<any>, reads?: Array<any> }} input
 */
export function noticeReadSummary({ notice, audience, reads } = {}) {
  const targeted = (Array.isArray(audience) ? audience : [])
    .filter((member) => member && text(member.status) === "active")
    .filter((member) => noticeTargets(notice, {
      locationId: member.locationId, title: member.title, role: member.role,
    }));
  const readBy = new Set((Array.isArray(reads) ? reads : []).map((item) => text(item?.userId)));
  const unread = targeted.filter((member) => !readBy.has(text(member.userId)));
  return {
    total: targeted.length,
    read: targeted.length - unread.length,
    unread,
  };
}
