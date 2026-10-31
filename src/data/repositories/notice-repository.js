/**
 * 공지사항 읽고 쓰기. **판정은 `functions/shared/notices.mjs` 에 있다.**
 *
 * 여기 있는 것은 서버를 만지는 부분과 기기 저장뿐이다 -- 누구에게 보이는지,
 * 어느 순서로 뜨는지, 무엇이 성립하는 글인지는 전부 저쪽이고, 앱과 서버 함수가
 * 같은 답을 내려면 그래야 한다.
 *
 * - 읽기: 센터 직원이 공지 목록을 읽는다 (규칙)
 * - 쓰기 · 고치기 · 지우기: 서버 함수 manageNotice 하나 (2026-10-31). 앱이 문서를
 *   직접 쓰지 않는다 -- 규칙이 닫아 두었다
 * - 확인: **그 기기에만** 적는다. 서버에 읽음 기록을 남기지 않는다
 */

import { paths } from "../schema/paths.js";
import { readCollection } from "./repository-read.js";
import { noticeError } from "../../../functions/shared/notices.mjs";

export {
  NOTICE_BODY_MAX, NOTICE_TITLE_MAX,
  noticeError, noticeInWindow, noticeMillis, noticeTargets, pendingNotices, visibleNotices,
} from "../../../functions/shared/notices.mjs";

const text = (value) => String(value ?? "").trim();
const requiredText = (value, label) => {
  const found = text(value);
  if (!found) throw new Error(`Missing ${label}`);
  return found;
};

export function createFirestoreNoticeStore() {
  const load = () => import("firebase/firestore");
  return {
    list: async (collectionPath) => {
      const { collection, getDocs, getFirestore } = await load();
      const snapshot = await getDocs(collection(getFirestore(), collectionPath));
      return snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
    },
  };
}

/** 이 센터의 공지 전부. 거르는 것은 부르는 쪽이다 (visibleNotices · pendingNotices). */
export async function listNotices(organizationId, options = {}) {
  const { store = createFirestoreNoticeStore() } = options;
  const organization = requiredText(organizationId, "organizationId");
  return readCollection({
    feature: "notices",
    path: paths.notices(organization),
    read: (path) => store.list(path),
  });
}

/**
 * 공지 쓰기 · 고치기 · 지우기 (manageNotice). 화면이 먼저 글을 보고, 서버가 다시 본다 --
 * 서버가 거부하면 그 이유(reason)가 함께 온다.
 *
 * @param {{ organizationId: string, action: "create" | "update" | "delete", noticeId?: string, value?: any, today?: string }} input
 * @param {{ call: (payload: any) => Promise<any> }} options
 */
export async function manageNotice(input, options) {
  const organizationId = requiredText(input?.organizationId, "organizationId");
  const action = requiredText(input?.action, "action");
  if (action !== "delete") {
    const refused = noticeError(input?.value, { today: input?.today });
    if (refused) throw Object.assign(new Error(refused), { code: "invalid_notice", reason: "notice_invalid" });
  }
  return options.call({
    organizationId, action,
    ...(input?.noticeId ? { noticeId: text(input.noticeId) } : {}),
    ...(action === "delete" ? {} : { value: input?.value }),
  });
}

/* ── 이 기기에서 확인한 공지 ──────────────────────────────────────────────
   계정마다 따로. 저장소를 못 쓰면(사생활 보호 창 따위) 빈 목록 -- 그러면 공지가
   다시 뜰 뿐, 앱이 멈추지는 않는다. 오래된 id 는 200개까지만 둔다. */
const CONFIRMED_LIMIT = 200;
const confirmedKey = (accountId) => `pilateacher_notice_confirmed_v1_${text(accountId)}`;

/** @returns {Set<string>} */
export function confirmedNoticeIds(storage, accountId) {
  if (!text(accountId)) return new Set();
  try {
    const parsed = JSON.parse(storage?.getItem(confirmedKey(accountId)) || "[]");
    return new Set(Array.isArray(parsed) ? parsed.map(text).filter(Boolean) : []);
  } catch {
    return new Set();
  }
}

/** 확인했다 (다시 표시하지 않기). 돌려주는 것은 새 목록. */
export function confirmNotice(storage, accountId, noticeId) {
  const ids = confirmedNoticeIds(storage, accountId);
  const id = text(noticeId);
  if (!text(accountId) || !id) return ids;
  ids.delete(id);
  ids.add(id);
  const kept = [...ids].slice(-CONFIRMED_LIMIT);
  try {
    storage?.setItem(confirmedKey(accountId), JSON.stringify(kept));
  } catch {
    // 못 적었다. 이번 실행 동안은 화면이 기억한다 -- 다음에 다시 뜰 수 있다.
  }
  return new Set(kept);
}
