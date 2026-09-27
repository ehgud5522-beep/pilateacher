/**
 * 마지막으로 본 화면을 기기에 둔다. 지하 스튜디오에서 열기 위해서다.
 *
 * ── 왜 필요한가 ──
 * 회원이 이 앱을 여는 자리는 대개 센터 안이고, 거기는 지하이거나 엘리베이터
 * 앞이다. 못 읽으면 지금은 "지금 불러오지 못했어요" 뿐인데, 그 사람이 알고
 * 싶은 것은 방금 전까지 참이었던 숫자 하나다.
 *
 * ── 저장하는 것은 허용 목록이다 ──
 * 투영 문서를 통째로 넣지 않는다. 지금 투영에 `phone` 이 없는 것은 서버의
 * 허용 목록이 막고 있어서인데, **거기 한 줄이 늘면 기기 저장에도 조용히
 * 따라 들어온다.** 서버가 지운 뒤에도 폰에는 남는다 -- 아무도 그것을 지울
 * 생각을 하지 않는다.
 *
 * 그래서 이 파일이 자기 목록을 따로 든다. 모르는 칸은 버린다.
 *
 * ── 오래된 숫자는 보여주지 않는다 ──
 * 잔여 횟수는 시간이 지나면 틀린다. 한 달 지난 사본은 맞을 때보다 틀릴 때가
 * 많고, 회원은 그 숫자를 믿고 수업에 온다. 그래서 나이를 넘기면 버린다 --
 * 아무것도 안 보이는 편이 틀린 숫자보다 낫다.
 *
 * ── 이것은 Firestore 캐시가 아니다 ──
 * 이 앱은 `firebase/firestore/lite` 를 쓴다. 오프라인 지속성도 실시간 구독도
 * 없다. 여기 있는 것이 전부고, 우리가 적은 것만 남는다.
 */

/** 기기에 두는 칸. 계정 삭제 때 이 이름으로 걷는다 (session.js). */
export const VIEW_CACHE_KEY = "pilateacher.member.view";

/** 사본의 모양이 바뀌면 올린다. 다른 판은 읽지 않고 버린다. */
export const CACHE_VERSION = 1;

/** 이보다 오래된 사본은 쓰지 않는다. */
export const CACHE_MAX_AGE_DAYS = 14;
const DAY_MS = 86400000;

/** 사본에 담는 최상위 칸. 여기 없는 것은 저장하지 않는다. */
export const CACHED_VIEW_FIELDS = Object.freeze([
  "organizationId", "clientId", "name", "locationName", "clientStatus",
  "remainingTotal", "nextExpiresAt", "passes", "history", "journey",
]);

export const CACHED_PASS_FIELDS = Object.freeze([
  "passId", "displayName", "purchaseRound", "totalSessions", "serviceSessions",
  "remainingCount", "expiresAt", "status", "isDuet", "partnerName",
]);

export const CACHED_HISTORY_FIELDS = Object.freeze([
  "occurredAt", "type", "instructorName", "memberNote",
]);

/**
 * 어떤 모양으로도 기기에 남으면 안 되는 칸.
 *
 * 허용 목록이 이미 막고 있으므로 코드는 이것을 쓰지 않는다 -- 테스트만 쓴다.
 * 투영 쪽(`functions/src/member-view.js`)과 같은 방식이고, 같은 이유다:
 * 허용 목록에 실수로 한 줄이 늘었을 때 그것을 잡을 것이 필요하다.
 *
 * **번호가 맨 앞인 것은 대표가 정한 것이다.** 폰을 잃어버렸을 때 잠금 없이
 * 열리는 저장소에 회원 번호가 남아 있으면 안 된다.
 */
export const NEVER_CACHED = Object.freeze([
  "phone", "phoneNumber", "userId", "uid",
  "baseUnitPrice", "netContractPrice", "unitPrice", "rule",
  "notes", "lessonRecord", "transcript",
]);

const text = (value) => String(value ?? "").trim();

/** Date·Timestamp·문자열을 ISO 로. 화면의 toDate 가 되읽는다. */
function iso(value) {
  if (!value) return "";
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : "";
  if (typeof value.toDate === "function") {
    const converted = value.toDate();
    return Number.isFinite(converted?.getTime?.()) ? converted.toISOString() : "";
  }
  if (typeof value === "object" && typeof value.seconds === "number") {
    return new Date(value.seconds * 1000).toISOString();
  }
  const parsed = new Date(String(value));
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : "";
}

const DATE_FIELDS = new Set(["nextExpiresAt", "expiresAt", "occurredAt"]);

/** 허용 목록으로만 옮긴다. 모르는 칸은 말없이 버린다. */
function pick(source, fields) {
  const out = {};
  for (const field of fields) {
    const value = source?.[field];
    if (value === undefined || value === null) continue;
    out[field] = DATE_FIELDS.has(field) ? iso(value) : value;
  }
  return out;
}

/** 저장할 모양으로 줄인다. 화면이 받는 `places` 와 같은 자리를 쓴다. */
export function cacheableViews(places) {
  return (Array.isArray(places) ? places : [])
    .filter((place) => place?.view)
    .map((place) => ({
      link: {
        organizationId: text(place.link?.organizationId),
        clientId: text(place.link?.clientId),
        locationId: text(place.link?.locationId),
      },
      view: {
        ...pick(place.view, CACHED_VIEW_FIELDS),
        passes: (Array.isArray(place.view.passes) ? place.view.passes : [])
          .map((pass) => pick(pass, CACHED_PASS_FIELDS)),
        history: (Array.isArray(place.view.history) ? place.view.history : [])
          .map((entry) => pick(entry, CACHED_HISTORY_FIELDS)),
      },
    }))
    .filter((place) => place.link.organizationId && place.link.clientId);
}

/**
 * 적는다. 실패해도 던지지 않는다 -- 사본을 못 남기는 것은 화면이 죽을 일이
 * 아니다. 빈 목록은 적지 않는다: 아직 아무것도 못 읽은 상태를 "회원권이
 * 없다" 로 굳혀 두면 안 된다.
 */
export function writeViewCache(places, at, store) {
  const cached = cacheableViews(places);
  if (!cached.length) return false;
  try {
    const box = store || (typeof localStorage === "undefined" ? null : localStorage);
    if (!box) return false;
    box.setItem(VIEW_CACHE_KEY, JSON.stringify({
      version: CACHE_VERSION,
      savedAt: (at instanceof Date ? at : new Date()).toISOString(),
      places: cached,
    }));
    return true;
  } catch (_error) {
    /* 저장이 막힌 기기가 있다. 다음에 온라인으로 읽으면 될 일이다. */
    return false;
  }
}

/**
 * 읽는다. 없거나·판이 다르거나·너무 오래됐으면 `null` 이다.
 *
 * **틀리는 방향은 "없음" 이다.** 못 읽은 사본을 억지로 살려 쓰면 회원이
 * 근거 없는 숫자를 보게 되고, 그것은 센터에 전화가 와야 드러난다.
 */
export function readViewCache(store, now = new Date()) {
  let raw = null;
  try {
    const box = store || (typeof localStorage === "undefined" ? null : localStorage);
    raw = box ? box.getItem(VIEW_CACHE_KEY) : null;
  } catch (_error) {
    return null;
  }
  if (!raw) return null;

  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch (_error) {
    return null;
  }
  if (!parsed || parsed.version !== CACHE_VERSION) return null;

  const savedAt = new Date(String(parsed.savedAt || ""));
  if (!Number.isFinite(savedAt.getTime())) return null;
  /* 미래 시각은 시계가 틀렸거나 손댄 것이다. 통과시키면 그 사본은 영영 안
     늙는다. */
  if (savedAt.getTime() > now.getTime()) return null;
  if (now.getTime() - savedAt.getTime() >= CACHE_MAX_AGE_DAYS * DAY_MS) return null;

  const places = (Array.isArray(parsed.places) ? parsed.places : [])
    .filter((place) => place?.link?.organizationId && place?.link?.clientId && place?.view);
  if (!places.length) return null;

  return { places, savedAt };
}

/**
 * 언제 본 것인지. **"방금" 이라고 말하지 않는다** -- 회원이 이 줄을 읽고
 * 숫자를 믿을지 정한다.
 */
export function cacheAgeLabel(savedAt, now = new Date()) {
  const at = savedAt instanceof Date ? savedAt : new Date(String(savedAt || ""));
  if (!Number.isFinite(at.getTime())) return "";
  const minutes = Math.floor((now.getTime() - at.getTime()) / 60000);
  if (minutes < 1) return "조금 전";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "어제";
  return `${days}일 전`;
}

/** 오프라인 줄에 쓸 문장. 나이를 감추지 않는다. */
export function offlineNotice(savedAt, now = new Date()) {
  const label = cacheAgeLabel(savedAt, now);
  if (!label) return "저장해 둔 정보예요.";
  return `${label}에 확인한 정보예요. 연결되면 새로고침돼요.`;
}
