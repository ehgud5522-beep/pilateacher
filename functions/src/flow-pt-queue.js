"use strict";

/**
 * 플로우 PT 발급 대기 -- 가져오기 (2026-11-24 대표). 판정 · 칸은 shared/flow-pt-queue.mjs.
 *
 * 몇 분마다 지점 업무보드의 최근 게시글을 읽어, 완료된 PT 업무를
 * organizations/{센터}/flowPtQueue/{postId} 에 둔다. **쓰기는 이 문서뿐이다** -- 회원 · 회원권은 건드리지 않는다.
 * 처음 만들 때만 state=waiting, 그 뒤에는 플로우에서 온 칸만 고친다 (FC 가 누른 처리를 되돌리지 않는다).
 *
 * 어느 센터인가: 플로우 지점 이름("삼계점 업무보드" → 삼계점)과 앱 지점 이름이 맞는 센터. 맞는 지점이 없으면
 * 쓰지 않고 진단에 남긴다 -- 엉뚱한 센터에 쓰지 않는다.
 *
 * 진단: feature flow_pt_queue · stage · errorDomain(flow_api · firestore) · errorCode(플로우 원본 코드 / HTTP) ·
 * message. 글 제목 · 본문 · 회원 이름 · API 키 · userId 는 남기지 않는다 (CLAUDE.md 7).
 */

const API_BASE = "https://api.flow.team";
/* 지점 업무보드의 업무는 플로우 안에서 종류 번호 92 로 나온다 (2026-11-24, 양산점 · 장유점 업무 목록으로 확인).
   공개 API 는 종류를 안 주면 1 · 2 · 4 (글 · 업무 · 일정)만 돌려주는 것으로 보여 -- 9개 보드 모두 200 인데 0건 --
   92 와 2 를 함께 달라고 한다. */
const TASK_TEMPLATE_TYPES = "92,2";
const PAGE_SIZE = 100;
const MAX_PAGES = 10;

const text = (value) => String(value ?? "").trim();

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
 *   firestore: any, fetchImpl?: typeof fetch, apiKey: () => string, userId: () => string,
 *   now?: () => Date, log?: (level: string, event: string, fields: object) => void,
 *   serverTimestamp?: () => any,
 * }} deps
 */
function createFlowPtQueueService(deps) {
  const { firestore, apiKey, userId, now = () => new Date(), log = () => {}, serverTimestamp = () => now() } = deps;
  /* 떼어 부르면 this 를 잃는 구현이 있다 -- 늘 감싸서 부른다. */
  const fetchImpl = deps.fetchImpl || ((...args) => globalThis.fetch(...args));
  const shared = () => import("../shared/flow-pt-queue.mjs");

  /** 비밀값을 읽고 모양을 본다. 값 자체는 어디에도 남기지 않는다. */
  function credentials() {
    let key;
    let account;
    try {
      key = text(apiKey());
      account = text(userId());
    } catch (error) {
      throw new FlowApiError("secret_unreadable", text(error?.message).slice(0, 200), 0);
    }
    if (!key) throw new FlowApiError("api_key_missing", "FLOW_API_KEY 가 비어 있음", 0);
    if (!HEADER_SAFE.test(key)) throw new FlowApiError("api_key_invalid_chars", `FLOW_API_KEY 에 헤더에 못 싣는 글자가 있음 (길이 ${key.length})`, 0);
    if (!account) throw new FlowApiError("user_id_missing", "FLOW_USER_ID 가 비어 있음", 0);
    if (!/^[A-Za-z0-9._@+-]{1,100}$/.test(account)) throw new FlowApiError("user_id_invalid_chars", `FLOW_USER_ID 모양이 아님 (길이 ${account.length})`, 0);
    return { key, account };
  }

  /**
   * @param {string} projectId @param {number} cursor
   * @param {{ withUser?: boolean, templateTypes?: string }} [options] 기본: userId 넣음, 종류 지정 없음. 시험(probe)이 바꿔 본다.
   */
  async function fetchPage(projectId, cursor, options = {}) {
    const { key, account } = credentials();
    const withUser = options.withUser !== false;
    const params = [
      ...(withUser ? [`userId=${encodeURIComponent(account)}`] : []),
      `cursor=${cursor}`, `pageSize=${PAGE_SIZE}`,
      ...(options.templateTypes ? [`templateTypes=${encodeURIComponent(options.templateTypes)}`] : []),
    ];
    const url = `${API_BASE}/v1/posts/projects/${encodeURIComponent(projectId)}?${params.join("&")}`;
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
    if (!response.ok || body?.success === false) {
      /* 플로우 원본 코드(error.code, 예 UNAUTHORIZED_ERROR)를 그대로 -- 없으면 HTTP 상태. */
      throw new FlowApiError(text(body?.error?.code) || `http_${response.status}`, text(body?.error?.message || body?.message).slice(0, 200), response.status);
    }
    return body?.data || {};
  }

  /**
   * 글이 0건일 때 조회 방식을 바꿔 본다 (2026-11-24: 9개 보드가 200 으로 답하는데 글 0건 -- 원인 확정용).
   * 방식마다 몇 건 · 응답 칸 이름 · 글 종류(templateType) · 상태 값 모양만 남긴다. 제목 · 본문 · 이름은 남기지 않는다.
   */
  async function probe(projectId) {
    const variants = [
      { key: "user", label: "userId 넣음", options: {} },
      { key: "user_task", label: "userId + 업무만(2)", options: { templateTypes: "2" } },
      { key: "user_92", label: "userId + 보드 업무(92)", options: { templateTypes: TASK_TEMPLATE_TYPES } },
      { key: "user_all", label: "userId + 전부(1,2,4,92)", options: { templateTypes: "1,2,4,92" } },
    ];
    const results = [];
    for (const variant of variants) {
      try {
        const data = await fetchPage(projectId, 0, variant.options);
        const posts = Array.isArray(data?.posts) ? data.posts : [];
        results.push({
          key: variant.key, label: variant.label, ok: true, posts: posts.length,
          dataKeys: Object.keys(data || {}).slice(0, 12),
          templateTypes: [...new Set(posts.map((post) => text(post?.templateType)))].slice(0, 6),
          taskStatuses: [...new Set(posts.map((post) => text(post?.taskStatus)))].slice(0, 6),
          hasNext: Boolean(data?.hasNext),
        });
      } catch (error) {
        results.push({ key: variant.key, label: variant.label, ok: false, errorCode: text(error?.code || "unknown"), httpStatus: Number(error?.status) || 0 });
      }
    }
    log("info", "flow_pt_queue_probe", { feature: "flow_pt_queue", stage: "probe", flowProjectId: projectId, results });
    return { flowProjectId: projectId, results };
  }

  const typeFallback = new Set();
  const typesFor = (projectId) => (typeFallback.has(projectId) ? "" : TASK_TEMPLATE_TYPES);

  /** 한 보드의 최근 글 (LOOKBACK 안). */
  async function recentPosts(projectId, since) {
    const { flowDateTime } = await shared();
    const posts = [];
    let cursor = 0;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      let data;
      try {
        data = await fetchPage(projectId, cursor, { templateTypes: typesFor(projectId) });
      } catch (error) {
        /* 종류 값을 플로우가 거절하면(400 · VALIDATION) 이 보드는 기본 조회로 -- 아무것도 못 읽는 것보다 낫다. */
        if (!(Number(error?.status) === 400 || text(error?.code) === "VALIDATION_ERROR") || !typesFor(projectId)) throw error;
        typeFallback.add(projectId);
        log("warn", "flow_pt_queue_types_rejected", { feature: "flow_pt_queue", stage: "fetch_posts", flowProjectId: projectId, errorDomain: "flow_api", errorCode: text(error?.code), httpStatus: Number(error?.status) || 0 });
        data = await fetchPage(projectId, cursor);
      }
      const batch = Array.isArray(data.posts) ? data.posts : [];
      posts.push(...batch);
      const oldest = batch.map((post) => flowDateTime(post?.registeredDateTime)).filter(Boolean).sort((a, b) => a - b)[0];
      const next = Number(data.lastCursor);
      if (!data.hasNext || !Number.isFinite(next) || next < 0 || (oldest && oldest < since)) break;
      cursor = next;
    }
    return posts;
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
    const { flowQueueSignature, FLOW_PT_COLLECTION, FLOW_PT_STATE } = await shared();
    const ref = firestore.doc(`organizations/${organizationId}/${FLOW_PT_COLLECTION}/${fields.postId}`);
    const snapshot = await ref.get();
    if (!snapshot.exists) {
      await ref.set({ ...fields, state: FLOW_PT_STATE.WAITING, handledBy: "", handledAt: null, createdAt: serverTimestamp(), syncedAt: serverTimestamp() });
      return "created";
    }
    const current = snapshot.data() || {};
    if (flowQueueSignature({ ...current }) === flowQueueSignature(fields)) return "same";
    await ref.update({
      title: fields.title, excerpt: fields.excerpt, mentionsRefund: fields.mentionsRefund, taskStatus: fields.taskStatus,
      isBalance: fields.isBalance, isTrial: fields.isTrial,
      locationId: fields.locationId, branchName: fields.branchName, syncedAt: serverTimestamp(),
    });
    return "updated";
  }

  /** 한 번 돈다. 보드 하나가 실패해도 나머지는 계속한다. */
  async function sync() {
    const { FLOW_PT_BOARDS, FLOW_PT_LOOKBACK_DAYS, isPtQueuePost, branchNameOfProject, matchLocationId, flowQueueFields } = await shared();
    const since = new Date(now().getTime() - FLOW_PT_LOOKBACK_DAYS * 86400000);
    const directory = await branchDirectory();
    const counts = { projects: 0, failedProjects: 0, posts: 0, pt: 0, created: 0, updated: 0, unmatchedBranch: 0 };
    /* 보드마다 실패 코드 -- [새로고침] 을 누른 사람에게 그대로 보여 준다 (원문 · 값은 로그에만). */
    const failures = [];
    let probed = null;
    for (const board of FLOW_PT_BOARDS) {
      const { projectId } = board;
      let posts;
      try {
        posts = await recentPosts(projectId, since);
      } catch (error) {
        counts.failedProjects += 1;
        const fatal = ["secret_unreadable", "api_key_missing", "api_key_invalid_chars", "user_id_missing", "user_id_invalid_chars"].includes(text(error?.code));
        log("error", "flow_pt_queue_fetch_failed", {
          feature: "flow_pt_queue", stage: "fetch_posts", flowProjectId: projectId,
          errorDomain: error instanceof FlowApiError ? "flow_api" : "unknown", errorCode: text(error?.code || "unknown"),
          httpStatus: Number(error?.status) || 0, causeCode: text(error?.causeCode), detail: text(error?.message).slice(0, 300),
        });
        failures.push({ flowProjectId: projectId, errorCode: text(error?.code || "unknown"), causeCode: text(error?.causeCode), httpStatus: Number(error?.status) || 0 });
        if (fatal) break;
        continue;
      }
      counts.projects += 1;
      counts.posts += posts.length;
      /* 첫 0건 보드 하나만 시험한다 -- 아홉 곳을 다 시험하면 요청이 서른여섯 번이다. */
      if (!posts.length && !probed) {
        probed = await probe(projectId).catch(() => null);
      }
      for (const post of posts) {
        /* 목록 응답에는 projectId 가 비어 오기도 한다 -- 지금 읽는 보드로 채운다. */
        const item = { ...post, projectId: post.projectId || projectId };
        if (!isPtQueuePost(item, board)) continue;
        counts.pt += 1;
        const branchName = board.branchName || branchNameOfProject(post.projectTitle);
        const owners = directory
          .map((entry) => ({ organizationId: entry.organizationId, locationId: matchLocationId(branchName, entry.locations) }))
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
          const result = await upsert(owners[0].organizationId, flowQueueFields(item, { ...owners[0], board }));
          if (result === "created") counts.created += 1;
          if (result === "updated") counts.updated += 1;
        } catch (error) {
          log("error", "flow_pt_queue_write_failed", {
            feature: "flow_pt_queue", stage: "write_queue", flowProjectId: projectId, organizationId: owners[0].organizationId,
            errorDomain: "firestore", errorCode: text(error?.code || "unknown"), detail: text(error?.message).slice(0, 300),
          });
        }
      }
    }
    return { ...counts, failures, ...(probed ? { probe: probed } : {}) };
  }

  return { sync, fetchPage };
}

module.exports = { createFlowPtQueueService, FlowApiError };
