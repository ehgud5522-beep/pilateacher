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

/**
 * 지점 업무보드 (2026-11-24 대표 계정에서 확인). 보드가 늘면 여기에 더한다.
 *
 * successStatusId: 그 보드의 "성공" 단계 번호. 플로우는 업무 상태를 큰 분류(COMPLETE)가 아니라 **보드마다 다른
 * 단계 번호**로 준다 -- 성공과 환불이 둘 다 COMPLETE 분류라, 번호로 봐야 성공만 고를 수 있다.
 * branchName: 목록 응답에 보드 이름(projectTitle)이 비어 오는 일이 있어 지점 이름을 여기 둔다.
 */
export const FLOW_PT_BOARDS = Object.freeze([
  { projectId: "2955393", branchName: "삼계점", successStatusId: "1035123" },
  { projectId: "2955389", branchName: "율하점", successStatusId: "1035111" },
  { projectId: "2955426", branchName: "토월점", successStatusId: "1035140" },
  { projectId: "2955391", branchName: "대방점", successStatusId: "1035117" },
  { projectId: "2955434", branchName: "좌동점", successStatusId: "1035157" },
  { projectId: "2955398", branchName: "반송점", successStatusId: "1035129" },
  { projectId: "2955353", branchName: "대원점", successStatusId: "1035105" },
  { projectId: "2955433", branchName: "양산점", successStatusId: "1035146" },
  { projectId: "2955093", branchName: "장유점", successStatusId: "1035099" },
].map((board) => Object.freeze(board)));
export const FLOW_PT_PROJECT_IDS = Object.freeze(FLOW_PT_BOARDS.map((board) => board.projectId));
export const flowPtBoard = (projectId) => FLOW_PT_BOARDS.find((board) => board.projectId === String(projectId ?? "").trim()) || null;

export const FLOW_PT_COLLECTION = "flowPtQueue";
/** 이보다 오래된 글은 가져오지 않는다 -- 처음 켤 때 한 달 반치만. */
export const FLOW_PT_LOOKBACK_DAYS = 45;
/** 처리 상태. waiting 만 목록 위에 선다. */
export const FLOW_PT_STATE = Object.freeze({ WAITING: "waiting", ISSUED: "issued", NOT_APPLICABLE: "not_applicable", BASELINE: "baseline" });

/* ── 기준선 (2026-11-24 대표: "오늘부터") ──
   업무 조회에는 등록 날짜가 없어, 처음 읽었을 때 보드를 만든 8월부터의 성공 업무 750건이 전부 발급 대기로 올라왔다.
   **오늘부터 새로 성공한 것만** 띄운다: 이 시각 전에 처음 본 업무는 기준선(baseline)으로 숨긴다 -- 단 오늘 올라온
   글(글 번호가 FLOW_PT_TODAY_POST_ID 이상)은 남긴다. 그 뒤로 새로 성공이 되는 업무는 모두 발급 대기에 뜬다
   (며칠 전 상담예정으로 올렸다가 오늘 성공으로 옮긴 업무도). 글 번호는 플로우 전체에서 시간 순으로 늘어난다
   (11/23 19:59 → 88613148, 11/24 11:14 → 88635315). */
export const FLOW_PT_BASELINE_UNTIL = new Date("2026-11-24T19:20:00+09:00");
export const FLOW_PT_TODAY_POST_ID = 88620000;
/** 이 업무를 기준선으로 숨길까 -- 기준선 시각 전에 처음 봤고, 오늘 글이 아니면. */
export function isBaselineTask(postId, firstSeenAt) {
  const seen = firstSeenAt instanceof Date ? firstSeenAt.getTime() : new Date(firstSeenAt).getTime();
  const id = Number(String(postId ?? "").trim());
  return Number.isFinite(seen) && seen < FLOW_PT_BASELINE_UNTIL.getTime() && !(Number.isFinite(id) && id >= FLOW_PT_TODAY_POST_ID);
}

const text = (value) => String(value ?? "").trim();

/* ── PT 줄 (2026-11-24 대표: "피티 · pt · 디오사 · 듀엣 · 패키지도 PT 수강권", "PT 체험도 넣어 줘") ──
   양산점 · 장유점 업무 40건씩으로 맞췄다. FC 가 쓰는 줄의 모양:
     [재등록] ○○님 1:1PT 깍두기EV 10s 55만 카드완납     ← PT
     [신규] ○○님 1:1 40s 공동구매e …                     ← "pt" 없이 1:1 만 쓰기도 한다
     [신규] ○○/○○님 2:1 듀엣 30s …   [신규] ○○님 디오사A 10s …   1:1 pt 24s 패키지e
     [신규] ○○님 1:1 pt 일일체험비 5.5만                   ← PT 체험도 넣는다
     [신규] ○○님 8:1 그룹 200s …                           ← 그룹은 뺀다 (한 글에 PT 줄 · 그룹 줄이 같이 오기도 한다)
   그래서 **줄마다** 본다: PT 말이 있고 빼는 말이 없는 줄이 하나라도 있으면 PT. */
const PT_WORDS = /(^|[^a-z])pt([^a-z]|$)|피티|(^|[^0-9])1\s*:\s*1([^0-9]|$)|(^|[^0-9])2\s*:\s*1([^0-9]|$)|듀엣|디오사|패키지/i;
/* 그룹(8:1 · 6:1 … · "그룹"), 새 회원권이 아닌 것(세션업 · 결제변경 · 매출취소). */
const NOT_PT_WORDS = /(^|[^0-9])([3-9]|[1-9][0-9])\s*:\s*1([^0-9]|$)|그룹|세션업|결제\s*변경|매출\s*취소/;

/** 글에서 PT 줄만. */
export function ptLines(value) {
  return text(value).split(/\r?\n/).map((line) => line.trim()).filter((line) => line && PT_WORDS.test(line) && !NOT_PT_WORDS.test(line));
}

/** "PT" 가 적힌 줄이 있는가 (옛 이름 -- 테스트 · 다른 곳이 쓴다). */
export const mentionsPt = (value) => ptLines(value).length > 0;

/**
 * 그 보드의 "성공" 업무인가. 공개 API 문서는 큰 분류(COMPLETE)를 예로 들지만 실제로는 단계 번호가 온다 --
 * 둘 다 받는다. 큰 분류만 오면 환불도 섞이므로 그때는 글의 "환불" 표시로 FC 에게 알린다 (mentionsRefund).
 */
export function isSuccessTask(post, board = flowPtBoard(post?.projectId)) {
  const status = text(post?.taskStatus);
  if (!status) return false;
  if (board && status === board.successStatusId) return true;
  return status.toUpperCase() === "COMPLETE";
}
/** 옛 이름. */
export const isCompletedTask = (post) => isSuccessTask(post);

/** 발급 대기에 세울 글인가. */
export function isPtQueuePost(post, board = flowPtBoard(post?.projectId)) {
  if (!post || !text(post.postId)) return false;
  return isSuccessTask(post, board) && ptLines(`${text(post.title)}\n${text(post.content)}`).length > 0;
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
export function flowQueueFields(post, { organizationId, locationId = "", board = flowPtBoard(post?.projectId) }) {
  const title = text(post?.title).slice(0, 200);
  const body = text(post?.content);
  const lines = ptLines(`${title}\n${body}`);
  return {
    organizationId: text(organizationId),
    postId: text(post?.postId),
    flowProjectId: text(post?.projectId),
    branchName: (text(board?.branchName) || branchNameOfProject(post?.projectTitle)).slice(0, 60),
    locationId: text(locationId),
    title,
    /* FC 가 볼 것은 PT 줄이다 -- 본문 첫머리는 "매출 양산중부 ○○○" 라 쓸모가 없다. */
    excerpt: flowExcerpt(lines.length ? lines.join(" / ") : body, 240),
    /* 카드에 크게: 등록상품(PT 줄) · 횟수 (2026-11-24 대표: "금액이랑 횟수 크게"). 금액은 업무 칸에서 따로 넣는다. */
    product: flowExcerpt(lines[0] || "", 80),
    sessions: sessionsOf(lines[0] || ""),
    mentionsRefund: /환불/.test(`${title} ${body}`),
    /* 잔금 글은 계약금 때 이미 발급했을 수 있다 -- FC 가 확인하게 표시한다. */
    /* 업무 칸으로 오면 구분 칸이 "잔금" · "체험" 한 줄로 온다. */
    isBalance: /잔금/.test(`${title} ${lines.join(" ")}`) || body.split(/\r?\n/).some((line) => line.trim() === "잔금"),
    /* PT 체험 (2026-11-24 대표: 넣는다). 체험 회원권인지 FC 가 보게 표시한다. */
    isTrial: lines.some((line) => /체험/.test(line)) || body.split(/\r?\n/).some((line) => line.trim() === "체험"),
    registerName: text(post?.registerName).slice(0, 60),
    registeredAt: flowDateTime(post?.registeredDateTime),
    taskStatus: text(post?.taskStatus).toUpperCase().slice(0, 20),
    flowUrl: flowPostUrl(post?.projectId, post?.postId),
  };
}

/** 같은 글을 또 쓰지 않으려고 비교하는 열쇠. */
export const flowQueueSignature = (fields) => [
  fields.title, fields.excerpt, fields.mentionsRefund, fields.taskStatus, fields.locationId, fields.branchName,
  Boolean(fields.isBalance), Boolean(fields.isTrial), text(fields.product), text(fields.amountManwon), fields.sessions ?? "",
].join("|");

/* ── 업무 필터 조회 응답 (개인용 GET /user/posts/projects/{id}/tasks/filter, 2026-11-24) ──
   업무 한 건: { taskId, postId, projectId, content(업무 이름), columns: [...] }. 문서 예시의 columns 는 비어 있어
   칸 모양을 확정하지 못했다 -- 플로우 앱의 업무 칸 모양(columnId · columnType · columnData[{ optionName, customColumnData }])과
   다른 이름(COLUMN_SRNO · value …)을 함께 받는다. */
const columnIdOf = (column) => text(column?.columnId ?? column?.columnSrno ?? column?.COLUMN_SRNO ?? column?.id);
const columnTexts = (column) => {
  const out = [];
  const push = (value) => {
    if (value === null || value === undefined) return;
    if (typeof value === "object") return;
    const item = text(value);
    if (item) out.push(item);
  };
  const data = Array.isArray(column?.columnData) ? column.columnData : Array.isArray(column?.values) ? column.values : [];
  for (const entry of data) {
    if (entry && typeof entry === "object") push(entry.optionName || entry.customColumnData || entry.value || entry.text || entry.userName);
    else push(entry);
  }
  if (!data.length) push(column?.optionName ?? column?.value ?? column?.text ?? column?.data ?? column?.columnValue);
  return out;
};

/** 칸 값들 (빈 값 · 업무 이름 칸 · 번호 칸은 뺀다). FC 가 볼 줄과 PT 판정에 쓴다. */
export function taskColumnValues(task) {
  const columns = Array.isArray(task?.columns) ? task.columns : [];
  const values = [];
  for (const column of columns) {
    const type = text(column?.columnType || column?.defaultColumnType).toUpperCase();
    const id = Number(columnIdOf(column));
    /* 기본 칸(0~12)과 담당자 · 날짜 · 체크 칸은 FC 에게 쓸모가 없고 작성자 이메일까지 섞인다 (2026-11-24 첫 결과) -- 보드에서 만든 칸만. */
    if (["TASK_NM", "PROGRESS", "RGSR_ID", "RGSN_DTTM", "EDTR_DTTM", "TASK_NUM", "STATUS", "PRIORITY", "USER", "DATE", "CHECKBOX"].includes(type)) continue;
    if (Number.isFinite(id) && id >= 0 && id <= 12) continue;
    values.push(...columnTexts(column).filter((value) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)));
  }
  return [...new Set(values)];
}

/** 상태 칸의 값 (단계 번호 또는 이름). 없으면 빈 값. */
export function taskStatusOf(task) {
  const columns = Array.isArray(task?.columns) ? task.columns : [];
  const status = columns.find((column) => columnIdOf(column) === "12" || text(column?.columnType || column?.defaultColumnType).toUpperCase() === "STATUS");
  if (!status) return "";
  const data = Array.isArray(status.columnData) ? status.columnData[0] : null;
  return text(data?.customColumnData || data?.optionSrno || data?.optionName || status.value || status.optionSrno || status.optionName);
}

/**
 * 업무를 게시글 모양으로 -- 판정(isPtQueuePost) · 칸(flowQueueFields)을 그대로 쓰려고.
 * 상태: 성공만 걸러 받았으면 그 보드의 성공 번호, 아니면 칸 값의 상태.
 */
/** 업무 이름. content 가 비어 오고 이름은 업무명 칸(TASK_NM, 번호 6)에 온다 (2026-11-24 첫 결과: 카드가 "제목 없음"). */
export function taskNameOf(task) {
  const columns = Array.isArray(task?.columns) ? task.columns : [];
  const name = columns.find((column) => text(column?.columnType || column?.defaultColumnType).toUpperCase() === "TASK_NM" || columnIdOf(column) === "6");
  return text(task?.content) || (name ? columnTexts(name)[0] || "" : "");
}

/** 금액(만원): 보드에서 만든 숫자 칸의 첫 값. "30.25" 처럼 온다. */
export function taskAmountOf(task) {
  const columns = Array.isArray(task?.columns) ? task.columns : [];
  for (const column of columns) {
    const id = Number(columnIdOf(column));
    if (Number.isFinite(id) && id >= 0 && id <= 12) continue;
    if (text(column?.columnType).toUpperCase() !== "NUMBER") continue;
    const value = columnTexts(column)[0];
    if (value && /^\d+(\.\d+)?$/.test(value)) return value;
  }
  return "";
}

/** 횟수: 등록상품 줄의 "40s" · "10S" · "20회" · "30s+5" … 첫 숫자. 못 읽으면 null. */
export function sessionsOf(line) {
  const match = /(^|[^0-9.])(\d{1,3})\s*(s|S|회)(?![a-zA-Z])/.exec(text(line));
  return match ? Number(match[2]) : null;
}

export function taskAsPost(task, board, { filtered = true } = {}) {
  const status = filtered ? text(board?.successStatusId) : taskStatusOf(task);
  return {
    postId: text(task?.postId || task?.taskId),
    projectId: text(task?.projectId) || text(board?.projectId),
    projectTitle: text(task?.projectTitle),
    title: taskNameOf(task),
    content: taskColumnValues(task).join("\n"),
    taskStatus: status === "성공" ? text(board?.successStatusId) : status,
    registeredDateTime: text(task?.registeredDateTime),
  };
}
