/**
 * 공지사항 — **대표 · 총괄매니저가 강사에게 알리는 글.**
 *
 * ── 왜 팝업인가 ──
 * 목록에만 두면 아무도 안 본다. 센터의 공지는 "봤는지" 가 요점이라 (단가가
 * 바뀐다, 다음 주 휴무다) 한 번은 눈앞에 세워야 하고, 확인한 뒤에는 다시 서면
 * 안 된다 -- 매번 뜨는 창은 곧 X 를 누르는 손버릇이 되고, 그때부터는 중요한
 * 공지도 안 읽힌다.
 *
 * ── 확인은 그 기기에만 (2026-10-31 대표 결정) ──
 * [확인했습니다(다시 표시하지 않기)] 를 누른 공지 id 를 그 기기에 적는다. 서버에
 * 읽음 기록을 남기지 않는다 -- 옛 앱이 남긴 읽음 기록(reads)은 지우지 않고 읽지만
 * 않는다. 다시 표시하지 않기를 눌러도 더보기 → 공지사항 목록에서는 읽을 수 있다.
 *
 * ── 쓰는 길은 서버 함수 하나 (manageNotice) ──
 * 대표 · 총괄매니저가 쓰고 고치고 지운다. 총괄매니저는 **자기가 쓴 공지만** 고치고
 * 지운다. 앱이 문서를 직접 쓰지 않는다 (규칙이 닫아 둔다).
 *
 * ── 글자만 ──
 * 제목 · 본문 · 대상 · 중요 · 표시 종료일. 이미지 · 서식 · 링크는 받지 않는다 --
 * 본문은 글자 그대로 보이고, 주소처럼 생긴 글자도 눌러서 열리지 않는다.
 *
 * ── 대상 ──
 * 전체 강사 또는 지점 선택. 비워 두면 전체다 -- 빈 목록을 "아무도 아님" 으로
 * 읽으면 공지를 쓰고 아무에게도 안 보이는 일이 생긴다. 옛 공지의 직급 · 역할
 * 조건은 그대로 따른다 (새로 걸 수는 없다).
 */

const text = (value) => String(value ?? "").trim();
const list = (value) => (Array.isArray(value) ? value.map(text).filter(Boolean) : []);

/** 공지 문서의 칸. 서버 함수가 이것만 쓴다. */
export const NOTICE_FIELDS = Object.freeze([
  "organizationId", "title", "body", "endsOn", "important", "locationIds",
  "status", "createdAt", "createdBy", "createdByName", "updatedAt", "updatedBy",
]);

/** 옛 공지의 끝냄 표시. 새 공지는 지운다 -- ended 인 옛 공지는 띄우지 않는다. */
export const NOTICE_STATUS = Object.freeze({
  ACTIVE: "active",
  ENDED: "ended",
});

export const NOTICE_TITLE_MAX = 60;
export const NOTICE_BODY_MAX = 2000;
export const NOTICE_LOCATION_MAX = 30;

/** 날짜 한 칸. 달력 날짜(YYYY-MM-DD)다 -- 절대 순간이 아니다. */
const isDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(text(value));

/** 서버 시각 · Date · 숫자 어느 것이든 밀리초로. 모르면 0. */
export function noticeMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  if (value instanceof Date) return value.getTime();
  const parsed = typeof value === "number" ? value : Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * 이 공지가 지금 보일 때인가.
 *
 * 날짜는 **달력 날짜**로 비교한다. 종료일은 **그날까지 포함**이다 -- 사람이
 * "10일까지" 라고 쓸 때 10일을 빼고 생각하지 않는다. 지나면 팝업에도 목록에도
 * 나오지 않는다. 옛 공지의 시작일도 따른다.
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
 * 이 사람이 이 공지의 대상인가. 빈 조건은 **전체**다.
 *
 * @param {any} notice
 * @param {{ locationId?: string, locationIds?: Array<string>, title?: string, role?: string }} who
 */
export function noticeTargets(notice, who) {
  const locations = list(notice?.locationIds);
  const titles = list(notice?.titles);
  const roles = list(notice?.roles);
  const mine = new Set([text(who?.locationId), ...list(who?.locationIds)].filter(Boolean));

  if (locations.length && !locations.some((id) => mine.has(id))) return false;
  if (titles.length && !titles.includes(text(who?.title))) return false;
  if (roles.length && !roles.includes(text(who?.role))) return false;
  return true;
}

/** 최신 먼저 (올린 시각, 같으면 id). */
const newestFirst = (left, right) => (
  noticeMillis(right.createdAt) - noticeMillis(left.createdAt)
  || text(right.startsOn).localeCompare(text(left.startsOn))
  || text(right.id).localeCompare(text(left.id))
);

/**
 * 더보기 → 공지사항 목록. 대상 · 기간 안의 것 전부, 확인한 것도 포함. 최신 먼저.
 * @param {{ notices?: Array<any>, today?: string, who?: any }} input
 */
export function visibleNotices({ notices, today, who } = {}) {
  return (Array.isArray(notices) ? notices : [])
    .filter(Boolean)
    .filter((notice) => noticeInWindow(notice, today))
    .filter((notice) => noticeTargets(notice, who))
    .sort(newestFirst);
}

/**
 * 지금 팝업으로 띄울 공지들. **최신 먼저**, 하나씩 띄운다. 이 기기에서 확인한
 * 것(confirmedIds)은 빠진다.
 *
 * @param {{ notices?: Array<any>, confirmedIds?: Set<string> | Array<string>, today?: string, who?: any }} input
 */
export function pendingNotices({ notices, confirmedIds, today, who } = {}) {
  const confirmed = confirmedIds instanceof Set ? confirmedIds : new Set(list(confirmedIds));
  return visibleNotices({ notices, today, who }).filter((notice) => !confirmed.has(text(notice.id)));
}

/**
 * 쓴 글이 성립하는가. 빈 문자열이면 통과다. 앱 화면과 서버 함수가 같은 것을 본다.
 *
 * @param {any} draft
 * @param {{ today?: string }} [options]
 */
export function noticeError(draft, options = {}) {
  const title = text(draft?.title);
  const body = text(draft?.body);
  if (!title) return "제목을 입력해 주세요.";
  if (title.length > NOTICE_TITLE_MAX) return `제목은 ${NOTICE_TITLE_MAX}자까지입니다.`;
  if (!body) return "내용을 입력해 주세요.";
  if (body.length > NOTICE_BODY_MAX) return `내용은 ${NOTICE_BODY_MAX}자까지입니다.`;
  const endsOn = text(draft?.endsOn);
  if (endsOn && !isDay(endsOn)) return "표시 종료일을 확인해 주세요.";
  /* 중요 공지는 확인 전까지 닫을 수 없다 -- 끝나는 날이 없으면 그 창이 언제까지고 선다. */
  if (draft?.important === true && !endsOn) return "중요 공지는 표시 종료일을 정해 주세요.";
  const today = text(options.today);
  if (endsOn && isDay(today) && endsOn < today) return "표시 종료일이 이미 지났습니다.";
  if (list(draft?.locationIds).length > NOTICE_LOCATION_MAX) return `지점은 ${NOTICE_LOCATION_MAX}곳까지 고를 수 있습니다.`;
  return "";
}

/**
 * 서버에 둘 본문. **받은 것 가운데 이 칸들만** -- 이미지 · 링크 · 서식 칸은 와도 버린다.
 * @param {any} draft
 */
export function noticeContent(draft) {
  const content = {
    title: text(draft?.title),
    body: String(draft?.body ?? "").trim(),
    important: draft?.important === true,
    locationIds: [...new Set(list(draft?.locationIds))],
  };
  const endsOn = text(draft?.endsOn);
  return endsOn ? { ...content, endsOn } : content;
}
