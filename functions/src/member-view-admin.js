"use strict";

/**
 * 투영을 점검하고 다시 만드는 대표 전용 문 둘. 설계 문서 11장.
 *
 * ── 왜 PC 스크립트가 아닌가 ──
 * 11장은 대표가 PC 에서 `node tools/backfill-member-views.mjs` 를 돌리는 그림이었다.
 * 그러려면 그 PC 에 Admin SDK 자격증명(ADC 또는 서비스 계정 키)이 있어야 한다.
 * 키 파일 하나가 센터의 모든 데이터를 여는 열쇠이고, 그것을 노트북에 두고
 * 관리하는 일이 이 기능의 값어치보다 크다. 그래서 서버에 두고 대표가 화면에서
 * 누른다 -- 권한은 호출자의 uid 로 그 자리에서 따진다.
 *
 * ── 무엇을 견주는가 ──
 * 저장된 투영과, 지금 다시 만든 투영을 비교한다. 여기에 **독립적인 잔여 재계산**
 * 하나를 더한다. 다시 만든 것과만 견주면 buildMemberView 가 틀렸을 때 둘이 사이
 * 좋게 같은 답을 내고, 그 대조는 아무것도 증명하지 못한다. 잔여는 회원이 가장
 * 먼저 보는 숫자라 그 하나만이라도 다른 길로 세어 본다.
 *
 * ── 쓰는 문은 기본이 건조 실행이다 ──
 * `dryRun` 을 끄려면 호출하는 쪽이 명시해야 한다. 되돌릴 수 없는 것은 먼저
 * 보여준다 -- 이관과 같은 규칙이다.
 */

const { FORBIDDEN_FIELDS, buildMemberView } = require("./member-view");
const { collectMemberViewInput, rebuildMemberView } = require("./member-view-triggers");
const { isActiveOwner, membershipId } = require("./member-link");

/** 한 번 호출에 볼 수 있는 회원 수. 넘으면 커서를 돌려주고 멈춘다. */
const MAX_MEMBERS_PER_CALL = 200;

/* 한 번 호출에 쓸 시간. 함수의 timeout(60초)보다 넉넉히 짧게 잡는다 -- 시간이
   다 되어 죽으면 어디까지 했는지가 남지 않고, 대표는 처음부터 다시 돌린다. */
const TIME_BUDGET_MS = 45000;

const STAGES = Object.freeze({
  AUTHORIZE: "authorize",
  VERIFY_OWNER: "verify_owner",
  LIST_CLIENTS: "list_clients",
  INSPECT: "inspect",
  WRITE: "write",
});

/** 무엇이 어긋났는가. 종류마다 고치는 방법이 다르므로 뭉개지 않는다. */
const MISMATCH = Object.freeze({
  /** 연결된 회원인데 투영이 없다. 트리거가 돌지 않았다 */
  MISSING: "missing",
  /** 연결이 없는데 투영이 남아 있다. 해제가 끝까지 가지 않았다 */
  ORPHAN: "orphan",
  /** 저장된 잔여가 회원권에서 다시 센 값과 다르다 */
  REMAINING_TOTAL: "remaining_total",
  /** 회원권 건수가 다르다 */
  PASS_COUNT: "pass_count",
  /** 이력 건수가 다르다 */
  HISTORY_COUNT: "history_count",
  /** 이름·지점 등 화면에 보이는 값이 옛것이다 */
  STALE_FIELD: "stale_field",
  /** 있어서는 안 되는 필드가 문서에 있다. 관문이 뚫린 것이다 */
  FORBIDDEN_FIELD: "forbidden_field",
});

class MemberViewAdminError extends Error {
  constructor(code, options = {}) {
    super(options.message || code, options.cause ? { cause: options.cause } : undefined);
    this.name = "MemberViewAdminError";
    this.code = code;
    this.stage = options.stage || STAGES.AUTHORIZE;
  }
}

const text = (value) => String(value ?? "").trim();
const count = (value) => (Number.isInteger(Number(value)) && Number(value) >= 0 ? Number(value) : 0);

const toDate = (value) => {
  if (value instanceof Date) return value;
  if (value && typeof value.toDate === "function") return value.toDate();
  const parsed = new Date(String(value ?? ""));
  return Number.isFinite(parsed.getTime()) ? parsed : null;
};

/**
 * 지금 쓸 수 있는 회차의 합. **buildMemberView 와 다른 길로 센다.**
 *
 * 앱의 activeRemainingTotal(pass-repository.js)과 같은 판정이다: 살아 있고
 * 만료되지 않은 회원권만. 그 함수를 가져다 쓰지 않는 것은 Functions 가 src/ 를
 * require 할 수 없어서이기도 하지만, **대조하는 쪽이 대조당하는 쪽의 코드를
 * 쓰면 그 대조는 아무것도 증명하지 못하기 때문**이다.
 *
 * @param {Array<any>} passes @param {Date} now
 */
function usableRemainingTotal(passes, now) {
  return (Array.isArray(passes) ? passes : [])
    .filter((pass) => {
      if (text(pass?.status) !== "active") return false;
      const expiresAt = toDate(pass?.expiresAt);
      return !expiresAt || expiresAt.getTime() >= now.getTime();
    })
    .reduce((sum, pass) => sum + count(pass?.remainingCount), 0);
}

/**
 * 문서 어디에든 금지 필드가 있는가. 중첩까지 훑는다.
 *
 * 허용 목록이 이미 막고 있으므로 여기서 걸리는 것은 관문이 뚫렸다는 뜻이다.
 * 두 겹으로 두는 이유는 허용 목록에 실수로 한 줄이 늘었을 때 그것을 잡을 것이
 * 필요해서다.
 *
 * @param {any} value @returns {Array<string>}
 */
function forbiddenFieldsIn(value) {
  const found = new Set();
  const walk = (node, depth) => {
    if (!node || typeof node !== "object" || depth > 6) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (FORBIDDEN_FIELDS.includes(key)) found.add(key);
      walk(child, depth + 1);
    }
  };
  walk(value, 0);
  return [...found];
}

/**
 * 회원 하나를 견준다. **순수 함수다.**
 *
 * @param {{ client: any, view: any, rebuilt: any, passes: Array<any>, now: Date }} input
 * @returns {Array<{ code: string, detail?: string }>}
 */
function compareMemberView(input = {}) {
  const linked = Boolean(text(input?.client?.userId));
  const view = input?.view || null;
  const found = [];

  if (!linked) {
    /* 연결이 없으면 투영도 없어야 한다. 남아 있으면 해제한 사람이 그 문서를
       계속 읽을 수 있다 -- 규칙은 문서의 userId 로 판정한다. */
    if (view) found.push({ code: MISMATCH.ORPHAN });
    return found;
  }
  if (!view) return [{ code: MISMATCH.MISSING }];

  for (const field of forbiddenFieldsIn(view)) {
    found.push({ code: MISMATCH.FORBIDDEN_FIELD, detail: field });
  }

  const recounted = usableRemainingTotal(input?.passes, input?.now instanceof Date ? input.now : new Date());
  if (count(view.remainingTotal) !== recounted) {
    found.push({ code: MISMATCH.REMAINING_TOTAL, detail: `${count(view.remainingTotal)} != ${recounted}` });
  }

  const rebuilt = input?.rebuilt || null;
  if (rebuilt) {
    const storedPasses = Array.isArray(view.passes) ? view.passes.length : 0;
    const freshPasses = Array.isArray(rebuilt.passes) ? rebuilt.passes.length : 0;
    if (storedPasses !== freshPasses) {
      found.push({ code: MISMATCH.PASS_COUNT, detail: `${storedPasses} != ${freshPasses}` });
    }
    const storedHistory = Array.isArray(view.history) ? view.history.length : 0;
    const freshHistory = Array.isArray(rebuilt.history) ? rebuilt.history.length : 0;
    if (storedHistory !== freshHistory) {
      found.push({ code: MISMATCH.HISTORY_COUNT, detail: `${storedHistory} != ${freshHistory}` });
    }
    /* 이름과 지점은 회원이 "내 것이 맞나"를 확인하는 값이다. 틀리면 숫자가
       맞아도 남의 화면처럼 보인다. 값은 담지 않는다 -- 어느 칸인지만. */
    for (const field of ["name", "locationName", "clientStatus"]) {
      if (text(view[field]) !== text(rebuilt[field])) {
        found.push({ code: MISMATCH.STALE_FIELD, detail: field });
      }
    }
  }
  return found;
}

/**
 * @param {{
 *   listClients: (input: any) => Promise<Array<any>>,
 *   inspectClient: (organizationId: string, clientId: string) => Promise<any>,
 *   rebuildClient: (organizationId: string, clientId: string, eventAt: Date) => Promise<string>,
 *   readMembership: (membershipDocumentId: string) => Promise<any>,
 *   now?: () => Date,
 *   timeBudgetMs?: number,
 * }} dependencies
 */
function createMemberViewAdminService(dependencies) {
  const {
    listClients,
    inspectClient,
    rebuildClient,
    readMembership,
    now = () => new Date(),
    timeBudgetMs = TIME_BUDGET_MS,
  } = dependencies || {};

  async function requireOwner(organizationId, callerUid) {
    let membership = null;
    try {
      membership = await readMembership(membershipId(organizationId, callerUid));
    } catch (error) {
      throw new MemberViewAdminError("admin_unavailable", { stage: STAGES.VERIFY_OWNER, cause: error });
    }
    if (!isActiveOwner(membership)) {
      throw new MemberViewAdminError("not_owner", { stage: STAGES.VERIFY_OWNER });
    }
    return membership;
  }

  /** 두 문이 같은 인자를 받는다. 한쪽만 다르게 읽히면 점검과 재작성이 서로 다른 집합을 본다. */
  function scopeOf(request) {
    const callerUid = text(request?.auth?.uid);
    if (!callerUid) throw new MemberViewAdminError("unauthenticated", { stage: STAGES.AUTHORIZE });
    const organizationId = text(request?.data?.organizationId);
    const locationId = text(request?.data?.locationId);
    const clientId = text(request?.data?.clientId);
    /* 지점을 반드시 받는다 (확정 8번: 1단계는 반송점만). 빠뜨리면 센터 전체를
       훑게 되고, 그것은 대표가 의도한 적 없는 크기다. */
    if (!organizationId || (!locationId && !clientId)) {
      throw new MemberViewAdminError("invalid_request", { stage: STAGES.AUTHORIZE });
    }
    const limit = Math.min(count(request?.data?.limit) || MAX_MEMBERS_PER_CALL, MAX_MEMBERS_PER_CALL);
    return { callerUid, organizationId, locationId, clientId, after: text(request?.data?.after), limit };
  }

  async function eachClient(scope, visit) {
    let clients = [];
    try {
      clients = await listClients(scope);
    } catch (error) {
      throw new MemberViewAdminError("admin_unavailable", { stage: STAGES.LIST_CLIENTS, cause: error });
    }

    /* 시계도 주입받은 것을 쓴다 -- 테스트가 예산 초과를 실제로 만들어 볼 수
       있어야 하고, 그러지 못하면 이 장치는 프로덕션에서 처음 돌아 본다. */
    const startedAt = now().getTime();
    let checked = 0;
    let cursor = "";
    for (const client of clients) {
      /* 시간이 다 되면 여기까지 했다고 말하고 멈춘다. 죽어서 끊기면 어디까지
         했는지가 남지 않는다. */
      if (now().getTime() - startedAt > timeBudgetMs) {
        return { checked, cursor, partial: true, stopped: false };
      }
      checked += 1;
      cursor = text(client.id);
      const done = await visit(client);
      if (done) return { checked, cursor, partial: false, stopped: true };
    }
    return {
      checked,
      cursor,
      // 상한까지 채웠으면 더 있을 수 있다. 커서로 이어 부른다.
      partial: clients.length >= scope.limit,
      stopped: false,
    };
  }

  /**
   * 읽기 전용 전수 대조.
   *
   * 어긋난 회원을 만나면 **그 회원에서 멈춘다.** 계속 돌면 어디서부터
   * 어긋나기 시작했는지 잃고, 대표가 봐야 할 것은 "몇 명이 틀렸나"가 아니라
   * "무엇이 틀렸나"이다.
   */
  async function verify(request) {
    const scope = scopeOf(request);
    await requireOwner(scope.organizationId, scope.callerUid);

    let stoppedAt = "";
    let mismatches = [];
    let linked = 0;
    const sweep = await eachClient(scope, async (client) => {
      let inspected = null;
      try {
        inspected = await inspectClient(scope.organizationId, text(client.id));
      } catch (error) {
        throw new MemberViewAdminError("admin_unavailable", { stage: STAGES.INSPECT, cause: error });
      }
      if (text(inspected?.client?.userId)) linked += 1;
      const found = compareMemberView({ ...inspected, now: now() });
      if (found.length === 0) return false;
      stoppedAt = text(client.id);
      mismatches = found;
      return true;
    });

    return {
      checked: sweep.checked,
      linked,
      partial: sweep.partial,
      cursor: sweep.cursor,
      // 회원 id 는 대표가 찾아가야 하는 값이라 돌려준다. 이름·번호는 담지 않는다.
      stoppedAt,
      mismatches,
      ok: mismatches.length === 0,
    };
  }

  /**
   * 다시 만든다. **기본은 건조 실행이다.**
   *
   * `dryRun` 이면 무엇이 바뀔지만 센다. 실제로 쓸 때는 트리거가 쓰는 그
   * 함수(rebuildMemberView)를 그대로 부른다 -- 백필과 트리거가 다른 답을 내면
   * 대조가 무엇을 증명하는지 알 수 없다.
   */
  async function rebuild(request) {
    const scope = scopeOf(request);
    await requireOwner(scope.organizationId, scope.callerUid);
    const dryRun = request?.data?.dryRun !== false;

    /* 읽기를 시작한 시각을 쓴다. 읽은 뒤에 차감이 일어나 트리거가 먼저 쓰면 그
       값의 sourceEventAt 이 더 커서, 우리 트랜잭션이 옛 값으로 덮지 않는다. */
    const eventAt = now();
    const outcomes = {};
    let wouldWrite = 0;
    let failedAt = "";
    let failedCode = "";

    const sweep = await eachClient(scope, async (client) => {
      const clientId = text(client.id);
      if (dryRun) {
        let inspected = null;
        try {
          inspected = await inspectClient(scope.organizationId, clientId);
        } catch (error) {
          throw new MemberViewAdminError("admin_unavailable", { stage: STAGES.INSPECT, cause: error });
        }
        if (compareMemberView({ ...inspected, now: now() }).length > 0) wouldWrite += 1;
        return false;
      }
      try {
        const outcome = await rebuildClient(scope.organizationId, clientId, eventAt);
        outcomes[outcome] = (outcomes[outcome] || 0) + 1;
      } catch (error) {
        /* 쓰다 실패하면 거기서 멈춘다. 계속 돌면 어느 회원부터 안 됐는지 잃고,
           대표는 전부를 다시 돌리게 된다. 원본 코드를 그대로 올린다 -- 정규화
           하면 원인 확정이 불가능해진다. */
        failedAt = clientId;
        failedCode = text(error?.code) || "unknown";
        outcomes.failed = (outcomes.failed || 0) + 1;
        return true;
      }
      return false;
    });

    return {
      dryRun,
      checked: sweep.checked,
      wouldWrite,
      outcomes,
      failedAt,
      failedCode,
      partial: sweep.partial,
      cursor: sweep.cursor,
      ok: !failedAt,
    };
  }

  return { verify, rebuild };
}

/**
 * Firestore 를 만지는 자리. 읽기는 트리거가 쓰는 그 함수들을 그대로 부른다.
 *
 * @param {{ firestore: any, loadBuildJourney: () => Promise<any> }} dependencies
 */
function createFirestoreMemberViewAdminPorts(dependencies) {
  const { firestore, loadBuildJourney } = dependencies || {};
  const org = (organizationId) => firestore.collection("organizations").doc(organizationId);

  return {
    async readMembership(membershipDocumentId) {
      const snapshot = await firestore.collection("memberships").doc(membershipDocumentId).get();
      return snapshot.exists ? snapshot.data() : null;
    },

    async listClients(scope) {
      if (scope.clientId) {
        const snapshot = await org(scope.organizationId).collection("clients").doc(scope.clientId).get();
        return snapshot.exists ? [{ id: snapshot.id, ...snapshot.data() }] : [];
      }
      /* 문서 id 순으로 읽는다. 커서로 이어 부르려면 순서가 호출마다 같아야 한다. */
      let query = org(scope.organizationId).collection("clients")
        .where("locationId", "==", scope.locationId)
        .orderBy("__name__")
        .limit(scope.limit);
      if (scope.after) {
        query = org(scope.organizationId).collection("clients")
          .where("locationId", "==", scope.locationId)
          .orderBy("__name__")
          .startAfter(scope.after)
          .limit(scope.limit);
      }
      const page = await query.get();
      return page.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }));
    },

    async inspectClient(organizationId, clientId) {
      const viewSnapshot = await org(organizationId).collection("memberViews").doc(clientId).get();
      const collected = await collectMemberViewInput(firestore, organizationId, clientId);
      if (!collected) return { client: null, view: null, rebuilt: null, passes: [] };
      if (collected.unlinked) {
        /* 연결이 없으면 다시 만들 것이 없다. 회원 문서는 따로 읽어 연결 여부를
           확정한다 -- collectMemberViewInput 은 그것만 알려주고 멈춘다. */
        const clientSnapshot = await org(organizationId).collection("clients").doc(clientId).get();
        return {
          client: clientSnapshot.exists ? { id: clientSnapshot.id, ...clientSnapshot.data() } : null,
          view: viewSnapshot.exists ? viewSnapshot.data() : null,
          rebuilt: null,
          passes: [],
        };
      }
      const rebuilt = buildMemberView({ ...collected, buildJourney: await loadBuildJourney(), now: new Date() });
      return {
        client: collected.client,
        view: viewSnapshot.exists ? viewSnapshot.data() : null,
        rebuilt,
        passes: collected.passes,
      };
    },

    async rebuildClient(organizationId, clientId, eventAt) {
      return rebuildMemberView(firestore, {
        organizationId, clientId, eventAt, buildJourney: await loadBuildJourney(),
      });
    },
  };
}

module.exports = {
  MAX_MEMBERS_PER_CALL,
  MISMATCH,
  MemberViewAdminError,
  STAGES,
  TIME_BUDGET_MS,
  compareMemberView,
  createFirestoreMemberViewAdminPorts,
  createMemberViewAdminService,
  forbiddenFieldsIn,
  usableRemainingTotal,
};
