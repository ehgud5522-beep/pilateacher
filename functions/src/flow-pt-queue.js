"use strict";

/**
 * 플로우 PT 발급 대기 -- 가져오기 (2026-11-24 대표). 판정 · 칸은 shared/flow-pt-queue.mjs.
 *
 * 몇 분마다(또는 [새로고침]) 지점 업무보드의 **성공** 업무를 읽어, PT 인 것을
 * organizations/{센터}/flowPtQueue/{postId} 에 둔다. **쓰기는 이 문서뿐이다** -- 회원 · 회원권은 건드리지 않는다.
 * 처음 만들 때만 state=waiting, 그 뒤에는 플로우에서 온 칸만 고친다 (FC 가 누른 처리를 되돌리지 않는다).
 *
 * ── 어느 주소로 읽는가 (2026-11-24 확정) ──
 * 이용 기관 관리자용 GET /v1/posts/projects/{id}?userId= 는 9개 보드 모두 200 인데 글이 0건이었다 -- 종류를 다 달라고 해도,
 * 앱에서 보이는 업무를 글 번호로 콕 집어도. 그래서 **개인용** GET /user/posts/projects/{id}/tasks/filter 로 읽는다:
 *   - 키 주인(대표 계정, 9개 보드 참여자) 기준이라 userId 가 없다. 참여자가 아니면 412 PRECONDITION_FAILED_ERROR
 *   - filterRecords 로 상태 칸(COLUMN_SRNO 12) = 그 보드의 성공 번호만 달라고 한다. 거절되면 거르지 않고 받아 칸 값으로 고른다
 *   - 응답의 업무에 칸 값(columns)이 함께 온다 -- 등록상품 · 구분 · 금액 · 결제. PT 판정은 그 값으로 한다
 *
 * 어느 센터인가: 보드 표의 지점 이름과 앱 지점 이름이 맞는 센터. 맞는 지점이 없으면 쓰지 않고 진단에 남긴다.
 *
 * 진단: feature flow_pt_queue · stage · errorDomain(flow_api · firestore) · errorCode(플로우 원본 코드 / HTTP) ·
 * detail. 업무 이름 · 칸 값 · 회원 이름 · API 키는 남기지 않는다 (CLAUDE.md 7).
 */

const API_BASE = "https://api.flow.team";
const PAGE_SIZE = 100;
const MAX_PAGES = 10;
/* 상태 칸 번호 (플로우 문서: 커스텀 상태 컬럼 COLUMN_SRNO 12). */
const STATUS_COLUMN = "12";

const text = (value) => String(value ?? "").trim();
/** Firestore Timestamp · Date · 문자열 → Date. 못 읽으면 null. */
const asDate = (value) => {
  if (!value) return null;
  const at = typeof value?.toDate === "function" ? value.toDate() : value instanceof Date ? value : new Date(value);
  return Number.isFinite(at?.getTime?.()) ? at : null;
};

class FlowApiError extends Error {
  constructor(code, message, status, causeCode = "") {
    super(message);
    this.code = code;
    this.status = status;
    /* fetch 가 응답 전에 실패한 원인 (예 ENOTFOUND · UND_ERR_CONNECT_TIMEOUT · 헤더 값 오류). 원본 그대로. */
    this.causeCode = causeCode;
  }
}

/* 헤더에 실을 수 있는 값인가 -- 줄바꿈 · 한글 · 빈칸이 섞이면 fetch 가 요청 전에 TypeError 로 멈춘다
   (2026-11-24 첫 실행: 9개 보드 모두 network · HTTP 0). 값은 남기지 않고 어떤 모양이 틀렸는지만 말한다. */
const HEADER_SAFE = /^[\x21-\x7e]+$/;

/**
 * @param {{
 *   firestore: any, fetchImpl?: typeof fetch, apiKey: () => string, userId?: () => string,
 *   now?: () => Date, log?: (level: string, event: string, fields: object) => void,
 *   serverTimestamp?: () => any,
 * }} deps
 */
function createFlowPtQueueService(deps) {
  const { firestore, apiKey, now = () => new Date(), log = () => {}, serverTimestamp = () => now() } = deps;
  /* 떼어 부르면 this 를 잃는 구현이 있다 -- 늘 감싸서 부른다. */
  const fetchImpl = deps.fetchImpl || ((...args) => globalThis.fetch(...args));
  const shared = () => import("../shared/flow-pt-queue.mjs");

  /** 비밀값을 읽고 모양을 본다. 값 자체는 어디에도 남기지 않는다. */
  function credentials() {
    let key;
    try {
      key = text(apiKey());
    } catch (error) {
      throw new FlowApiError("secret_unreadable", text(error?.message).slice(0, 200), 0);
    }
    if (!key) throw new FlowApiError("api_key_missing", "FLOW_API_KEY 가 비어 있음", 0);
    if (!HEADER_SAFE.test(key)) throw new FlowApiError("api_key_invalid_chars", `FLOW_API_KEY 에 헤더에 못 싣는 글자가 있음 (길이 ${key.length})`, 0);
    return { key };
  }

  /**
   * 한 쪽의 업무. statusId 가 있으면 그 상태만 달라고 한다.
   * @param {string} projectId @param {number} cursor @param {string} [statusId]
   */
  async function fetchTasks(projectId, cursor, statusId = "") {
    const { key } = credentials();
    const params = [`cursor=${cursor}`, `pageSize=${PAGE_SIZE}`];
    if (statusId) {
      const filter = JSON.stringify([{ COLUMN_SRNO: STATUS_COLUMN, OPERATOR_TYPE: "EQUAL", FILTER_DATA: String(statusId) }]);
      params.push(`filterRecords=${encodeURIComponent(filter)}`);
    }
    const url = `${API_BASE}/user/posts/projects/${encodeURIComponent(projectId)}/tasks/filter?${params.join("&")}`;
    let response;
    try {
      response = await fetchImpl(url, { headers: { "Content-Type": "application/json", "x-flow-api-key": key } });
    } catch (error) {
      const cause = error?.cause;
      throw new FlowApiError("network", `${text(error?.name)}: ${text(error?.message)}${cause?.message ? ` / ${text(cause.message)}` : ""}`.slice(0, 300), 0,
        text(cause?.code || cause?.name || error?.code));
    }
    let body = null;
    try { body = await response.json(); } catch { body = null; }
    /* 문서 예시는 { response: { … } } 로 한 번 더 감싸 보여 준다 -- 둘 다 받는다. */
    const payload = body && typeof body.response === "object" && body.response && !("success" in body) ? body.response : body;
    if (!response.ok || payload?.success === false) {
      /* 플로우 원본 코드(error.code, 예 UNAUTHORIZED_ERROR · PRECONDITION_FAILED_ERROR)를 그대로 -- 없으면 HTTP 상태. */
      throw new FlowApiError(text(payload?.error?.code) || `http_${response.status}`, text(payload?.error?.message || payload?.message).slice(0, 200), response.status);
    }
    return payload?.data || {};
  }

  /** 글 하나의 실제 등록 시각 (GET /user/posts/{postId}). 못 읽으면 null -- 그때는 처음 본 때로 둔다. */
  async function registeredAtOf(postId) {
    const { flowDateTime } = await shared();
    try {
      const { key } = credentials();
      const response = await fetchImpl(`${API_BASE}/user/posts/${encodeURIComponent(postId)}`, { headers: { "Content-Type": "application/json", "x-flow-api-key": key } });
      const body = await response.json().catch(() => null);
      const payload = body && typeof body.response === "object" && body.response && !("success" in body) ? body.response : body;
      const data = payload?.data?.post || payload?.data || {};
      return flowDateTime(data.registeredDateTime || data.rgsnDttm || data.registerDateTime);
    } catch (error) {
      log("warn", "flow_pt_queue_post_detail_failed", { feature: "flow_pt_queue", stage: "post_detail", errorDomain: "flow_api", errorCode: text(error?.code || "unknown") });
      return null;
    }
  }

  /** 한 보드의 성공 업무. 상태 거르기를 플로우가 거절하면 거르지 않고 받아 칸 값으로 고른다. */
  async function successTasks(board) {
    const { taskStatusOf } = await shared();
    let filtered = true;
    const tasks = [];
    let cursor = 0;
    /* 끝까지 읽었는가 (2026-11-28). 마지막 쪽까지 왔을 때만 참 -- 쪽 수 한도에서 끊겼으면 거짓이고, 그 보드에서는
       "성공 목록에 없다" 를 판단하지 않는다 (못 읽은 것을 실패로 바꾸면 대기가 사라진다). */
    let complete = false;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      let data;
      try {
        data = await fetchTasks(board.projectId, cursor, filtered ? board.successStatusId : "");
      } catch (error) {
        if (!filtered || !(Number(error?.status) === 400 || text(error?.code) === "VALIDATION_ERROR")) throw error;
        filtered = false;
        log("warn", "flow_pt_queue_filter_rejected", { feature: "flow_pt_queue", stage: "fetch_tasks", flowProjectId: board.projectId, errorDomain: "flow_api", errorCode: text(error?.code), httpStatus: Number(error?.status) || 0 });
        cursor = 0;
        tasks.length = 0;
        data = await fetchTasks(board.projectId, cursor, "");
      }
      const batch = Array.isArray(data?.tasks) ? data.tasks : [];
      tasks.push(...batch);
      const next = Number(data?.lastCursor);
      if (!data?.hasNext || !Number.isFinite(next) || next < 0) { complete = true; break; }
      cursor = next;
    }
    /* 거르지 못했으면 칸 값의 상태로 고른다. 상태 칸이 안 오면 고를 수 없으니 그대로 두고 FC 가 원문을 본다. */
    return filtered ? { tasks, filtered, complete } : {
      tasks: tasks.filter((task) => {
        const status = taskStatusOf(task);
        return !status || status === board.successStatusId || status === "성공";
      }),
      filtered,
      complete,
    };
  }

  /** 지점 이름 → { organizationId, locationId }. 센터 여럿이면 지점 이름이 하나만 맞는 센터. */
  async function branchDirectory() {
    const organizations = await firestore.collection("organizations").get();
    const directory = [];
    for (const organization of organizations.docs) {
      const locations = await firestore.collection(`organizations/${organization.id}/locations`).get();
      directory.push({ organizationId: organization.id, locations: locations.docs.map((item) => ({ id: item.id, name: text(item.data()?.name) })) });
    }
    return directory;
  }

  async function upsert(organizationId, fields) {
    const { flowQueueSignature, FLOW_PT_COLLECTION, FLOW_PT_STATE, FLOW_PT_FLOW_STATUS, isBaselineTask } = await shared();
    const ref = firestore.doc(`organizations/${organizationId}/${FLOW_PT_COLLECTION}/${fields.postId}`);
    const snapshot = await ref.get();
    if (!snapshot.exists) {
      /* 업무 응답에는 등록 시각이 없다 -- 처음 본 때를 넣는다 (목록이 45일 안을 읽는다). 기준선 전이면 숨긴다. */
      const baseline = isBaselineTask(fields.postId, now());
      /* 띄울 것만 상세를 한 번 읽어 실제 등록 시각을 넣는다 (하루 몇 건 -- 기준선 750건은 부르지 않는다). */
      if (!baseline && !fields.registeredAt) {
        const exact = await registeredAtOf(fields.postId);
        if (exact) { fields.registeredAt = exact; fields.registeredAtExact = true; }
      }
      await ref.set({ ...fields, registeredAt: fields.registeredAt || now(), state: baseline ? FLOW_PT_STATE.BASELINE : FLOW_PT_STATE.WAITING, handledBy: "", handledAt: null, createdAt: serverTimestamp(), syncedAt: serverTimestamp() });
      return baseline ? "baseline" : "created";
    }
    const current = snapshot.data() || {};
    /* ── 숨길지는 **처음 가져온 시각**으로 본다 (2026-11-28) ──
       전에는 registeredAt 으로 봤다. 그런데 새로 만들 때 registeredAt 에 플로우의 **실제 등록 시각**(상세 조회)을 넣으므로,
       11-24 전에 상담으로 올렸다가 지금 성공으로 옮긴 글은 만들 때는 대기였다가 10분 뒤 다음 동기화에서 기준선으로
       숨겨졌다 (운영 3건: 11-25 · 11-26 · 11-27, 모두 정확히 10분 뒤). 처음 가져온 시각(createdAt)이 없는 옛 문서만
       예전처럼 registeredAt 으로 본다 -- 11-24 첫 실행이 750건을 띄운 것을 숨기는 원래 목적. */
    const firstSeen = asDate(current.createdAt) || asDate(current.registeredAt);
    /* 기준선 전에 발급 대기로 만들어 둔 것(아무도 손대지 않은 것)은 기준선으로 돌린다 -- 첫 실행이 750건을 띄웠다. */
    if (current.state === FLOW_PT_STATE.WAITING && !current.handledBy && isBaselineTask(fields.postId, firstSeen)) {
      await ref.update({ state: FLOW_PT_STATE.BASELINE, excerpt: fields.excerpt, syncedAt: serverTimestamp() });
      return "baseline";
    }
    /* 기준선 뒤에 처음 가져왔는데 위 버그로 숨겨진 것은 대기로 되살린다. 기준선 뒤에 새로 만든 문서는 처음부터 대기라
       (위 isBaselineTask(…, now())) 기준선 상태일 이유가 이 버그뿐이다. 손댄 사람이 있으면 건드리지 않는다. */
    if (current.state === FLOW_PT_STATE.BASELINE && !current.handledBy && asDate(current.createdAt) && !isBaselineTask(fields.postId, firstSeen)) {
      await ref.update({ state: FLOW_PT_STATE.WAITING, excerpt: fields.excerpt, syncedAt: serverTimestamp() });
      return "restored";
    }
    /* ── 다시 성공 (2026-11-28 대표: "실패는 상담 실패, 다시 연락해 성공으로 바꿀 수 있다") ──
       성공 목록에서 빠졌던(left) 줄이 돌아오면 성공으로 되돌린다. 아직 회원권과 이어지지 않은 줄은 대기로 -- 실패 때
       FC 가 [해당 없음] 을 눌렀어도 다시 계약했으니 발급할 일이 생겼다. 회원권과 이어진 줄 · [이미 발급 완료] 는 그대로
       (같은 업무로 두 번 발급되지 않는다). 못 본 횟수만 쌓였던 줄은 그 횟수만 지운다. */
    if (current.flowStatus === FLOW_PT_FLOW_STATUS.LEFT || Number(current.missCount) > 0) {
      const back = current.flowStatus === FLOW_PT_FLOW_STATUS.LEFT;
      const reopen = back && current.state === FLOW_PT_STATE.NOT_APPLICABLE && !text(current.passId);
      await ref.update({
        flowStatus: FLOW_PT_FLOW_STATUS.SUCCESS, missCount: 0, syncedAt: serverTimestamp(),
        ...(back ? { resucceededAt: now() } : {}),
        ...(reopen ? { state: FLOW_PT_STATE.WAITING, handledBy: "", handledAt: null } : {}),
      });
      if (back) return "resucceeded";
    }
    if (flowQueueSignature({ ...current }) === flowQueueSignature(fields)) return "same";
    await ref.update({
      title: fields.title, excerpt: fields.excerpt, mentionsRefund: fields.mentionsRefund, taskStatus: fields.taskStatus,
      isBalance: fields.isBalance, isTrial: fields.isTrial,
      product: fields.product ?? "", sessions: fields.sessions ?? null, amountManwon: fields.amountManwon ?? "",
      locationId: fields.locationId, branchName: fields.branchName, syncedAt: serverTimestamp(),
    });
    return "updated";
  }

  /** 한 번 돈다. 보드 하나가 실패해도 나머지는 계속한다. */
  async function sync() {
    const { FLOW_PT_BOARDS, taskAsPost, isPtQueuePost, matchLocationId, flowQueueFields, flowExcerpt, taskColumnValues, taskAmountOf } = await shared();
    const directory = await branchDirectory();
    const counts = { projects: 0, failedProjects: 0, posts: 0, pt: 0, created: 0, updated: 0, unmatchedBranch: 0, unfiltered: 0, baseline: 0, restored: 0, resucceeded: 0, left: 0 };
    /* 보드마다 이번에 본 성공 업무 번호 -- 끝까지 읽은 보드만 (아래 markLeft). PT 판정 전의 전부다: 등록상품 칸을 고쳐 PT 가
       아니게 된 업무는 "실패" 가 아니다. */
    const seenByProject = new Map();
    /* 보드마다 실패 코드 -- [새로고침] 을 누른 사람에게 그대로 보여 준다 (원문 · 값은 로그에만). */
    const failures = [];
    for (const board of FLOW_PT_BOARDS) {
      const { projectId } = board;
      let result;
      try {
        result = await successTasks(board);
      } catch (error) {
        counts.failedProjects += 1;
        const fatal = ["secret_unreadable", "api_key_missing", "api_key_invalid_chars", "UNAUTHORIZED_ERROR"].includes(text(error?.code));
        log("error", "flow_pt_queue_fetch_failed", {
          feature: "flow_pt_queue", stage: "fetch_tasks", flowProjectId: projectId,
          errorDomain: error instanceof FlowApiError ? "flow_api" : "unknown", errorCode: text(error?.code || "unknown"),
          httpStatus: Number(error?.status) || 0, causeCode: text(error?.causeCode), detail: text(error?.message).slice(0, 300),
        });
        failures.push({ flowProjectId: projectId, errorCode: text(error?.code || "unknown"), causeCode: text(error?.causeCode), httpStatus: Number(error?.status) || 0 });
        if (fatal) break;
        continue;
      }
      counts.projects += 1;
      counts.posts += result.tasks.length;
      if (result.complete) seenByProject.set(projectId, new Set(result.tasks.map((task) => text(taskAsPost(task, board, { filtered: result.filtered }).postId)).filter(Boolean)));
      if (!result.filtered) counts.unfiltered += 1;
      for (const task of result.tasks) {
        /* 업무를 게시글 모양으로 -- 이름은 제목, 칸 값은 줄마다 본문, 상태는 (걸러 받았으면) 그 보드의 성공. */
        const item = taskAsPost(task, board, { filtered: result.filtered });
        if (!isPtQueuePost(item, board)) continue;
        counts.pt += 1;
        const owners = directory
          .map((entry) => ({ organizationId: entry.organizationId, locationId: matchLocationId(board.branchName, entry.locations) }))
          .filter((entry) => entry.locationId);
        if (owners.length !== 1) {
          counts.unmatchedBranch += 1;
          log("warn", "flow_pt_queue_branch_unmatched", {
            feature: "flow_pt_queue", stage: "match_branch", flowProjectId: projectId, errorDomain: "flow_pt_queue",
            errorCode: owners.length ? "branch_ambiguous" : "branch_not_found", matches: owners.length,
          });
          continue;
        }
        try {
          const fields = flowQueueFields(item, { ...owners[0], board });
          /* FC 가 볼 줄: 칸 값 전부(구분 · 등록상품 · 금액 · 결제 …) -- 전화번호는 가린다. */
          fields.excerpt = flowExcerpt(taskColumnValues(task).join(" · "), 240) || fields.excerpt;
          fields.amountManwon = taskAmountOf(task);
          const written = await upsert(owners[0].organizationId, fields);
          if (written === "created") counts.created += 1;
          if (written === "baseline") counts.baseline += 1;
          if (written === "updated") counts.updated += 1;
          if (written === "restored") counts.restored += 1;
          if (written === "resucceeded") counts.resucceeded += 1;
        } catch (error) {
          log("error", "flow_pt_queue_write_failed", {
            feature: "flow_pt_queue", stage: "write_queue", flowProjectId: projectId, organizationId: owners[0].organizationId,
            errorDomain: "firestore", errorCode: text(error?.code || "unknown"), detail: text(error?.message).slice(0, 300),
          });
        }
      }
    }
    counts.left = await markLeft(directory, seenByProject);
    return { ...counts, failures };
  }

  /**
   * 성공 목록에서 빠진 줄 (2026-11-28). 플로우에서 성공 → 실패(상담 실패)로 옮기면 서버는 그 업무를 더 이상 받지 못한다 --
   * 전에는 대기에 그대로 남아 실패한 상담으로 발급할 수 있었다. 끝까지 읽은 보드에서 **두 번 연속** 못 본 대기 · 해당 없음 줄을
   * flowStatus "left" 로 표시한다 (한 번은 플로우가 잠깐 덜 준 것일 수 있다). 앱은 대기에서 빼 따로 보이고, 규칙은 이 줄을
   * 회원권과 잇지 못하게 한다. 발급된 줄은 건드리지 않는다. 기준선 줄은 처음부터 안 본다.
   * @returns {Promise<number>} 이번에 left 로 바꾼 줄 수
   */
  async function markLeft(directory, seenByProject) {
    if (!seenByProject.size) return 0;
    const { FLOW_PT_COLLECTION, FLOW_PT_STATE, FLOW_PT_FLOW_STATUS, FLOW_PT_LEFT_AFTER_MISSES } = await shared();
    let left = 0;
    for (const { organizationId } of directory) {
      let snapshot;
      try {
        snapshot = await firestore.collection(`organizations/${organizationId}/${FLOW_PT_COLLECTION}`)
          .where("state", "in", [FLOW_PT_STATE.WAITING, FLOW_PT_STATE.NOT_APPLICABLE]).get();
      } catch (error) {
        log("error", "flow_pt_queue_left_read_failed", { feature: "flow_pt_queue", stage: "mark_left", organizationId, errorDomain: "firestore", errorCode: text(error?.code || "unknown"), detail: text(error?.message).slice(0, 300) });
        continue;
      }
      for (const item of snapshot.docs) {
        const row = item.data() || {};
        const seen = seenByProject.get(text(row.flowProjectId));
        if (!seen || seen.has(text(row.postId || item.id)) || row.flowStatus === FLOW_PT_FLOW_STATUS.LEFT) continue;
        const misses = (Number(row.missCount) || 0) + 1;
        const leaving = misses >= FLOW_PT_LEFT_AFTER_MISSES;
        try {
          await firestore.doc(`organizations/${organizationId}/${FLOW_PT_COLLECTION}/${item.id}`).update({
            missCount: misses, syncedAt: serverTimestamp(),
            ...(leaving ? { flowStatus: FLOW_PT_FLOW_STATUS.LEFT, leftAt: now() } : {}),
          });
          if (leaving) left += 1;
        } catch (error) {
          log("error", "flow_pt_queue_write_failed", { feature: "flow_pt_queue", stage: "mark_left", organizationId, errorDomain: "firestore", errorCode: text(error?.code || "unknown"), detail: text(error?.message).slice(0, 300) });
        }
      }
    }
    return left;
  }

  return { sync, fetchTasks };
}

module.exports = { createFlowPtQueueService, FlowApiError };
