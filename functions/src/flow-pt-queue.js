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

  async function fetchPage(projectId, cursor) {
    const { key, account } = credentials();
    const url = `${API_BASE}/v1/posts/projects/${encodeURIComponent(projectId)}?userId=${encodeURIComponent(account)}&cursor=${cursor}&pageSize=${PAGE_SIZE}`;
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

  /** 한 보드의 최근 글 (LOOKBACK 안). */
  async function recentPosts(projectId, since) {
    const { flowDateTime } = await shared();
    const posts = [];
    let cursor = 0;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const data = await fetchPage(projectId, cursor);
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
      locationId: fields.locationId, branchName: fields.branchName, syncedAt: serverTimestamp(),
    });
    return "updated";
  }

  /** 한 번 돈다. 보드 하나가 실패해도 나머지는 계속한다. */
  async function sync() {
    const { FLOW_PT_PROJECT_IDS, FLOW_PT_LOOKBACK_DAYS, isPtQueuePost, branchNameOfProject, matchLocationId, flowQueueFields } = await shared();
    const since = new Date(now().getTime() - FLOW_PT_LOOKBACK_DAYS * 86400000);
    const directory = await branchDirectory();
    const counts = { projects: 0, failedProjects: 0, posts: 0, pt: 0, created: 0, updated: 0, unmatchedBranch: 0 };
    for (const projectId of FLOW_PT_PROJECT_IDS) {
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
        if (fatal) break;
        continue;
      }
      counts.projects += 1;
      counts.posts += posts.length;
      for (const post of posts) {
        if (!isPtQueuePost(post)) continue;
        counts.pt += 1;
        const branchName = branchNameOfProject(post.projectTitle);
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
          const result = await upsert(owners[0].organizationId, flowQueueFields(post, owners[0]));
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
    return counts;
  }

  return { sync, fetchPage };
}

module.exports = { createFlowPtQueueService, FlowApiError };
