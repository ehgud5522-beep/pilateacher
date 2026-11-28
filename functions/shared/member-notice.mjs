/**
 * 보니따(회원 앱) 공지 팝업 (2026-11-28 대표: "회원앱에 공지사항 뜰 수 있는 팝업칸 만들어줘
 * 매끄럽고 부드럽게, 일주일 동안 안 보기 · 닫기, 안에 이미지 띄울 수 있게").
 *
 * **판정은 여기 한 곳이다.** 강사 웹(대표가 쓰는 화면) · 회원 앱 · 규칙 테스트가 같은 값을 쓴다.
 *
 * ── 모양 ──
 * 센터마다 문서 하나: organizations/{센터}/memberNotices/popup. 대표가 고치면 그 글이 바로
 * 회원에게 뜬다. 여러 장을 줄 세우지 않는다 -- 팝업은 한 번에 하나만 뜨고, 쌓아 두면 대표가
 * 무엇이 지금 떠 있는지 모르게 된다.
 *
 * ── 이미지 ──
 * 저장소(Storage)를 쓰지 않고 줄인 JPEG 를 문서에 data URL 로 담는다. 회원 앱이 읽을 수
 * 있는 Storage 문을 따로 열 필요가 없고, 문서 하나를 읽으면 끝난다. 그래서 크기를 묶는다:
 * 문서 한도 1MB 안에서 넉넉하게 MEMBER_NOTICE_IMAGE_MAX 글자.
 *
 * ── 일주일 동안 안 보기 ──
 * 그 기기에만 적는다(계정 · 센터 · 판 별로). 대표가 글을 고치면(version = updatedAt) 다시 뜬다 --
 * "안 보기" 는 그 글에 대한 것이지 앞으로 올 공지 전부에 대한 것이 아니다.
 */

export const MEMBER_NOTICE_DOC_ID = "popup";
export const MEMBER_NOTICE_TITLE_MAX = 60;
export const MEMBER_NOTICE_BODY_MAX = 1000;
/** data URL 글자 수 상한. 규칙도 같은 값을 본다. */
export const MEMBER_NOTICE_IMAGE_MAX = 700000;
export const MEMBER_NOTICE_SNOOZE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export const MEMBER_NOTICE_FIELDS = Object.freeze([
  "organizationId", "title", "body", "image", "active", "endsOn", "updatedAt", "updatedBy",
]);

const IMAGE_PREFIX = /^data:image\/(jpeg|png|webp);base64,/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const text = (value) => String(value ?? "").trim();

/** 왜 저장할 수 없는가. 코드 하나. 저장해도 되면 "". */
export function memberNoticeError(value) {
  const title = text(value?.title);
  const body = String(value?.body ?? "");
  const image = String(value?.image ?? "");
  const endsOn = text(value?.endsOn);
  if (!title && !image) return "member_notice_empty";
  if (title.length > MEMBER_NOTICE_TITLE_MAX) return "member_notice_title_too_long";
  if (body.length > MEMBER_NOTICE_BODY_MAX) return "member_notice_body_too_long";
  if (image && !IMAGE_PREFIX.test(image)) return "member_notice_image_type";
  if (image.length > MEMBER_NOTICE_IMAGE_MAX) return "member_notice_image_too_large";
  if (endsOn && !DAY.test(endsOn)) return "member_notice_ends_on";
  return "";
}

const millisOf = (value) => {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  const at = value instanceof Date ? value : new Date(value);
  return Number.isNaN(at.getTime()) ? 0 : at.getTime();
};

/** 이 글의 판. 고치면 바뀐다 -- "일주일 동안 안 보기" 가 이 값에 묶인다. */
export const memberNoticeVersion = (notice) => String(millisOf(notice?.updatedAt) || "0");

/** 서울 달력 날짜 "YYYY-MM-DD". */
export const seoulDay = (at = new Date()) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
}).format(at);

/** 지금 회원에게 띄울 글인가. 꺼짐 · 빈 글 · 종료일 지남은 아니다. 종료일 당일까지는 띄운다. */
export function memberNoticeLive(notice, now = new Date()) {
  if (!notice || notice.active !== true) return false;
  if (!text(notice.title) && !text(notice.image)) return false;
  const endsOn = text(notice.endsOn);
  return !endsOn || endsOn >= seoulDay(now);
}

const snoozeKey = (scope) => `bonita_member_notice_snooze_v1_${text(scope)}`;

/** "일주일 동안 안 보기" 가 아직 살아 있는가. 저장소를 못 쓰면 false -- 공지가 다시 뜰 뿐이다. */
export function memberNoticeSnoozed(storage, scope, notice, now = new Date()) {
  try {
    const saved = JSON.parse(storage?.getItem?.(snoozeKey(scope)) || "null");
    if (!saved || saved.version !== memberNoticeVersion(notice)) return false;
    return Number(saved.until) > now.getTime();
  } catch (_error) {
    return false;
  }
}

/** 이 글을 일주일 동안 띄우지 않는다. 적지 못하면 false. */
export function snoozeMemberNotice(storage, scope, notice, now = new Date()) {
  try {
    storage?.setItem?.(snoozeKey(scope), JSON.stringify({
      version: memberNoticeVersion(notice),
      until: now.getTime() + MEMBER_NOTICE_SNOOZE_DAYS * DAY_MS,
    }));
    return true;
  } catch (_error) {
    return false;
  }
}

/** 대표 화면의 거절 문구. 코드를 함께 말한다. */
export const MEMBER_NOTICE_ERROR_TEXT = Object.freeze({
  member_notice_empty: "제목이나 이미지 중 하나는 있어야 해요.",
  member_notice_title_too_long: `제목은 ${MEMBER_NOTICE_TITLE_MAX}자까지예요.`,
  member_notice_body_too_long: `내용은 ${MEMBER_NOTICE_BODY_MAX}자까지예요.`,
  member_notice_image_type: "JPEG · PNG · WEBP 이미지만 올릴 수 있어요.",
  member_notice_image_too_large: "이미지가 너무 커요. 더 작은 이미지를 골라 주세요.",
  member_notice_ends_on: "종료일을 다시 골라 주세요.",
});
