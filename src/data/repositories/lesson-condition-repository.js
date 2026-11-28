/**
 * 수업 전 몸 상태 읽기 (강사 앱, 2026-11-28). 쓰기는 보니따 → 서버(memberLessonCondition)뿐이다.
 *
 * 문서 하나: organizations/{센터}/lessonConditions/{lessonId}_{clientId}. 규칙이 그 수업의 담당 강사만
 * 읽게 한다 -- 없으면 null. 판정 · 문구는 functions/shared/lesson-condition.mjs.
 */
import { conditionDocId } from "../../../functions/shared/lesson-condition.mjs";

export { conditionHeadline } from "../../../functions/shared/lesson-condition.mjs";

const text = (value) => String(value ?? "").trim();

export function createFirestoreLessonConditionStore() {
  const load = () => import("firebase/firestore");
  return {
    read: async (path) => {
      const { doc, getDoc, getFirestore } = await load();
      const snapshot = await getDoc(doc(getFirestore(), path));
      return snapshot.exists() ? snapshot.data() : null;
    },
  };
}

/**
 * @returns {Promise<{ mood: string, areas: string[], memo: string } | null>}
 */
export async function readLessonCondition(organizationId, lessonId, clientId, { store = createFirestoreLessonConditionStore() } = {}) {
  if (!text(organizationId) || !text(lessonId) || !text(clientId)) return null;
  const found = await store.read(`organizations/${text(organizationId)}/lessonConditions/${conditionDocId(lessonId, clientId)}`);
  if (!found) return null;
  return {
    mood: text(found.mood),
    areas: Array.isArray(found.areas) ? found.areas.map(text).filter(Boolean) : [],
    memo: text(found.memo),
  };
}
