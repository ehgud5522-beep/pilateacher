/**
 * 플로우 PT 발급 대기 (2026-11-24 대표: "플로우에 등록상품이 PT 라고 적힌 것만 발급 대기 화면으로 --
 * FC 가 플로우에 내용을 확인한 후에 발급할 수 있게").
 *
 * ── 무엇을 가져오는가 ──
 * 지점 업무보드(플로우 프로젝트)의 게시글 중 **업무 상태가 완료(COMPLETE)** 이고 제목 · 본문에 **PT** 가 적힌 것.
 * 플로우 공개 API(GET /v1/posts/projects/{projectId})는 업무보드의 칸 값(구분 · 등록상품 · 금액 · 결제)과
 * 보드 고유 상태 이름(성공 · 환불)을 주지 않는다 -- 큰 분류(taskStatus)와 제목 · 본문뿐이다.
 * 그래서 **판정은 FC 가 한다**: 이 목록은 "확인할 것" 이고, FC 가 플로우 원문을 열어 성공인지 · 상품이 맞는지
 * 보고 발급한 뒤 "발급함" / "해당 없음" 을 누른다. 앱이 발급하지 않는다.
 *
 * 순수 함수. 플로우 호출 · 저장은 functions/src/flow-pt-queue.js.
 */

/** 지점 업무보드 (2026-11-24 대표 계정에서 확인). 보드가 늘면 여기에 더한다. */
export const FLOW_PT_PROJECT_IDS = Object.freeze([
  "2955393", "2955389", "2955426", "2955391", "2955434", "2955398", "2955353", "2955433", "2955093",
]);

export const FLOW_PT_COLLECTION = "flowPtQueue";
/** 이보다 오래된 글은 가져오지 않는다 -- 처음 켤 때 한 달 반치만. */
export const FLOW_PT_LOOKBACK_DAYS = 45;
/** 처리 상태. waiting 만 목록 위에 선다. */
export const FLOW_PT_STATE = Object.freeze({ WAITING: "waiting", ISSUED: "issued", NOT_APPLICABLE: "not_applicable" });

const text = (value) => String(value ?? "").trim();

/** "PT" 가 낱말로 적혔는가. "1:1pt" · "PT 10회" · "피티" 는 예, "opt" · "apt" 는 아니오. */
export function mentionsPt(value) {
  const body = text(value);
  return /(^|[^a-z])pt([^a-z]|$)/i.test(body) || body.includes("피티");
}

/** 업무 글이고 완료로 옮겨졌는가. 플로우 큰 분류: REQUEST · PROGRESS · FEEDBACK · COMPLETE · HOLD. */
export const isCompletedTask = (post) => text(post?.taskStatus).toUpperCase() === "COMPLETE";

/** 발급 대기에 세울 글인가. */
export function isPtQueuePost(post) {
  if (!post || !text(post.postId)) return false;
  return isCompletedTask(post) && mentionsPt(`${text(post.title)} ${text(post.content)}`);
}

/** "삼계점 업무보드" → "삼계점". 앱 지점 이름과 맞출 때 쓴다. */
export function branchNameOfProject(projectTitle) {
  return text(projectTitle).replace(/\s*업무\s*보드\s*$/, "").trim();
}

/** 지점 이름 비교용: 공백 · "점" 꼬리를 떼고 본다 ("삼계" · "삼계점" · "삼계 점" 을 같게). */
const branchKey = (name) => text(name).replace(/\s+/g, "").replace(/점$/, "");

/**
 * 플로우 지점 이름 → 앱 지점 id. 하나만 맞을 때만 돌려준다 -- 둘 이상이면 고르지 않는다(빈 값).
 * @param {string} branchName
 * @param {Array<{ id: string, name?: string }>} locations
 */
export function matchLocationId(branchName, locations) {
  const key = branchKey(branchName);
  if (!key) return "";
  const hits = (locations || []).filter((location) => location && branchKey(location.name) === key);
  return hits.length === 1 ? text(hits[0].id) : "";
}

/** "20261124111420"(한국 시각) → Date. 읽지 못하면 null. */
export function flowDateTime(value) {
  const digits = text(value);
  if (!/^\d{14}$/.test(digits)) return null;
  const at = new Date(`${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}T${digits.slice(8, 10)}:${digits.slice(10, 12)}:${digits.slice(12, 14)}+09:00`);
  return Number.isNaN(at.getTime()) ? null : at;
}

/** 본문 앞부분. 전화번호는 가린다 -- 확인은 플로우 원문에서 한다. */
export function flowExcerpt(value, max = 160) {
  const flat = text(value).replace(/\s+/g, " ");
  const masked = flat.replace(/01[016789][-. ]?\d{3,4}[-. ]?\d{4}/g, "010-****-****");
  return masked.length > max ? `${masked.slice(0, max)}…` : masked;
}

/** 플로우에서 그 글을 여는 주소. */
export const flowPostUrl = (projectId, postId) => `https://flow.team/main.act?projectId=${encodeURIComponent(text(projectId))}&postId=${encodeURIComponent(text(postId))}`;

/**
 * 저장할 칸 (플로우에서 온 것만). 처리 칸(state · handledBy · handledAt)은 여기 없다 -- 처음 만들 때만
 * waiting 으로 넣고, 그 뒤 동기화는 처리 칸을 건드리지 않는다 (FC 가 누른 것을 되돌리지 않게).
 */
export function flowQueueFields(post, { organizationId, locationId = "" }) {
  const title = text(post?.title).slice(0, 200);
  const body = text(post?.content);
  return {
    organizationId: text(organizationId),
    postId: text(post?.postId),
    flowProjectId: text(post?.projectId),
    branchName: branchNameOfProject(post?.projectTitle).slice(0, 60),
    locationId: text(locationId),
    title,
    excerpt: flowExcerpt(body),
    mentionsRefund: /환불/.test(`${title} ${body}`),
    registerName: text(post?.registerName).slice(0, 60),
    registeredAt: flowDateTime(post?.registeredDateTime),
    taskStatus: text(post?.taskStatus).toUpperCase().slice(0, 20),
    flowUrl: flowPostUrl(post?.projectId, post?.postId),
  };
}

/** 같은 글을 또 쓰지 않으려고 비교하는 열쇠. */
export const flowQueueSignature = (fields) => [
  fields.title, fields.excerpt, fields.mentionsRefund, fields.taskStatus, fields.locationId, fields.branchName,
].join("|");
