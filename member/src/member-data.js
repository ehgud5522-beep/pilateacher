/**
 * 회원 앱이 Firestore 에서 읽는 것 **전부**. 다른 파일은 Firestore 를 만지지 않는다.
 *
 * ── 두 문서뿐이다 ──
 *   memberLinks/{uid}                            내 clientId 가 어디 있는가
 *   organizations/{org}/memberViews/{clientId}   화면 넷이 그리는 모든 것
 *
 * 왜 링크 문서를 먼저 읽는가: 규칙이 `memberViews` 의 `list` 를 닫아 뒀다. 목록을
 * 열면 "내 것만" 을 증명할 필터를 요구하게 되고, 그 필터 한 줄이 틀리면 남의
 * 문서가 보인다. 그래서 회원은 **자기 문서 id 를 먼저 알고** 그 하나만 연다.
 *
 * ── 여기서 질의를 쓰지 않는다 ──
 * `collection()` · `getDocs()` · `query()` 를 부르지 않는다. 화면이 늘면서
 * 조용히 `passes` 를 읽게 되는 것을 막는 것이 이 파일의 두 번째 일이고,
 * `tests/member/reads-nothing-else.test.js` 가 그것을 지킨다.
 */

/* lite 다. 한 번 읽고 끝이라 실시간 구독이 필요 없고, 그 차이가 번들에서
   426KB 다 (845 → 419KB, gzip 222 → 107KB). 회원은 지하 스튜디오에서 LTE 로
   이 화면을 연다.

   구독이 필요해지는 날에는 lite 로 안 된다 -- 그때 무엇을 얻고 무엇을
   내주는지 다시 재 보고 바꾼다. */
import { doc, getDoc } from "firebase/firestore/lite";

const text = (value) => String(value ?? "").trim();

/** 연결 문서. 없으면 아직 이어지지 않은 계정이다. */
export async function readMemberLink(db, userId) {
  const uid = text(userId);
  if (!db || !uid) return null;
  const snapshot = await getDoc(doc(db, "memberLinks", uid));
  if (!snapshot.exists()) return null;
  const data = snapshot.data() || {};
  return {
    status: text(data.status),
    links: (Array.isArray(data.links) ? data.links : [])
      .map((link) => ({
        organizationId: text(link?.organizationId),
        clientId: text(link?.clientId),
        locationId: text(link?.locationId),
      }))
      .filter((link) => link.organizationId && link.clientId),
  };
}

/**
 * 투영 하나. 없을 수 있다 -- 연결 직후 트리거가 도는 몇 초가 그렇다.
 * 그때 "조회 실패" 를 띄우면 정상 상태를 고장으로 말하게 된다.
 */
export async function readMemberView(db, link) {
  const organizationId = text(link?.organizationId);
  const clientId = text(link?.clientId);
  if (!db || !organizationId || !clientId) return null;
  const snapshot = await getDoc(
    doc(db, "organizations", organizationId, "memberViews", clientId),
  );
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}

/**
 * 이어진 곳 전부의 투영. 여러 지점에 등록된 회원은 둘이다 (확정 7번).
 *
 * 한 곳을 못 읽어도 나머지는 보여준다 -- 한 지점 때문에 화면 전체가 비면
 * 회원은 아무것도 확인하지 못한다.
 *
 * @returns {Promise<Array<{ link: any, view: any, errorCode: string }>>}
 */
export async function readMemberViews(db, links) {
  const list = Array.isArray(links) ? links : [];
  return Promise.all(list.map(async (link) => {
    try {
      return { link, view: await readMemberView(db, link), errorCode: "" };
    } catch (error) {
      return { link, view: null, errorCode: text(error?.code) || "unknown" };
    }
  }));
}
