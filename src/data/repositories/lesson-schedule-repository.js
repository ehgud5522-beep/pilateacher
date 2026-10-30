/**
 * 강사 일정을 센터 서버의 `lessons/{id}` 에 쓴다 (schedule-publish.js 가 만든 문서).
 *
 * ── 완료된 수업은 건드리지 않는다 ──
 * 확정(deductPass)이 같은 문서를 "completed" 로 merge 한다. 그 뒤에 일정 쪽이
 * "scheduled" 를 쓰면 완료가 되돌아간다. 그래서 **읽고 쓰기를 한 트랜잭션**으로
 * 묶는다 -- 읽은 순간과 쓴 순간 사이에 확정이 끼면 트랜잭션이 다시 돈다.
 *
 * ── 실패는 기기 저장을 되돌리지 않는다 ──
 * 일정은 이미 기기에 저장됐다. 서버에 못 쓴 것은 "회원 앱에 아직 안 보인다" 는
 * 뜻이고, 다음 저장 때 다시 보낸다. 실패는 건마다 원본 코드와 함께 돌려준다.
 */

import { paths } from "../schema/paths.js";

export const PUBLISH_OUTCOME = Object.freeze({
  WRITTEN: "written",
  /** 이미 확정된 수업이라 일정 쪽에서 쓰지 않았다. 정상이다. */
  SETTLED: "settled",
  /** 서버가 이미 같은 내용이다. */
  UNCHANGED: "unchanged",
  FAILED: "failed",
});

const text = (value) => String(value ?? "").trim();

/**
 * Firestore 에 붙는 쓰기. 단위 테스트는 같은 모양의 가짜를 넘기고, 규칙 테스트는
 * 에뮬레이터의 firestore 를 넘겨 **이 코드 그대로** 규칙을 지나게 한다 --
 * 가짜만으로는 규칙이 이 읽기를 막는 것을 못 잡았다 (2026-10-31).
 *
 * @param {{ firestore?: any }} [options]
 * @returns {{ transact: (documentPath: string, decide: (current: any) => any) => Promise<any> }}
 */
export function createFirestoreLessonScheduleStore(options = {}) {
  const load = () => import("firebase/firestore");
  return {
    async transact(documentPath, decide) {
      const { doc, getFirestore, runTransaction, serverTimestamp } = await load();
      const firestore = options.firestore || getFirestore();
      const reference = doc(firestore, documentPath);
      return runTransaction(firestore, async (transaction) => {
        const snapshot = await transaction.get(reference);
        const current = snapshot.exists() ? snapshot.data() : null;
        const write = decide(current);
        if (write) {
          transaction.set(reference, {
            ...write,
            updatedAt: serverTimestamp(),
            ...(current ? {} : { createdAt: serverTimestamp() }),
          }, { merge: true });
        }
        if (write) return PUBLISH_OUTCOME.WRITTEN;
        return text(current?.status) === "completed" ? PUBLISH_OUTCOME.SETTLED : PUBLISH_OUTCOME.UNCHANGED;
      });
    },
  };
}

const millis = (value) => {
  if (!value) return null;
  if (typeof value?.toMillis === "function") return value.toMillis();
  const at = value instanceof Date ? value : new Date(value);
  return Number.isFinite(at.getTime()) ? at.getTime() : null;
};

/** 서버 문서가 이미 이 일정과 같은가. 같으면 쓰지 않는다 -- 쓰면 회원 데이터가 다시 만들어진다. */
function sameSchedule(current, data) {
  if (!current) return false;
  const ids = (value) => JSON.stringify((Array.isArray(value) ? value : []).map(text).sort());
  return text(current.status) === text(data.status)
    && millis(current.startsAt) === millis(data.startsAt)
    && millis(current.endsAt) === millis(data.endsAt)
    && ids(current.clientIds) === ids(data.clientIds)
    && text(current.lessonType) === text(data.lessonType)
    && text(current.instructorId) === text(data.instructorId)
    && text(current.locationId) === text(data.locationId);
}

/**
 * 이 문서를 지금 써도 되는가. **순수 함수다.**
 * 완료된 수업이면 null (확정이 이긴다). 서버와 같으면 null (쓸 것이 없다).
 */
export function scheduleWriteFor(current, document) {
  if (text(current?.status) === "completed") return null;
  if (sameSchedule(current, document.data)) return null;
  return document.data;
}

/**
 * @param {string} organizationId
 * @param {Array<{ lessonId: string, data: object }>} documents
 * @param {{ store?: ReturnType<typeof createFirestoreLessonScheduleStore>, createdBy?: string }} [options]
 * @returns {Promise<Array<{ lessonId: string, outcome: string, errorCode: string }>>}
 */
export async function publishScheduledLessons(organizationId, documents, options = {}) {
  const organization = text(organizationId);
  const store = options.store || createFirestoreLessonScheduleStore();
  const results = [];
  for (const document of Array.isArray(documents) ? documents : []) {
    const lessonId = text(document?.lessonId);
    if (!organization || !lessonId) continue;
    try {
      const outcome = await store.transact(
        paths.lesson(organization, lessonId),
        (current) => {
          const write = scheduleWriteFor(current, document);
          /* 처음 만드는 문서에만 누가 만들었는지 적는다. */
          return write && !current && options.createdBy ? { ...write, createdBy: options.createdBy } : write;
        },
      );
      results.push({ lessonId, outcome, errorCode: "" });
    } catch (error) {
      results.push({ lessonId, outcome: PUBLISH_OUTCOME.FAILED, errorCode: text(error?.code) || "unknown" });
    }
  }
  return results;
}
