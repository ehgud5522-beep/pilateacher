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
  /** 다른 기기가 지우거나 취소한 수업이라 되살리지 않았다. */
  CANCELLED_ELSEWHERE: "cancelled_elsewhere",
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
        return outcomeWithoutWrite(current);
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
 *
 * **취소된 수업은 아무 기기나 되살리지 못한다** (2026-10-31). 센터에는 PC 가 두
 * 대인 곳이 많다. PC-A 에서 지운 일정을 PC-B 가 아직 들고 있으면, PC-B 를 여는
 * 순간 "처음 맞추기" 가 그것을 예정으로 다시 썼다. 되살릴 수 있는 것은 둘뿐이다:
 * - 이 기기가 취소한 것 (updatedDevice 가 나) -- 내 출석 취소를 내가 되돌린다
 * - 이번 저장에서 새로 들어온 것 (allowRevive) -- 되돌리기를 누른 것
 * 앱을 열 때 맞추기는 allowRevive 를 주지 않는다.
 *
 * @param {any} current
 * @param {{ data: any, allowRevive?: boolean }} document
 * @param {{ deviceId?: string }} [options]
 */
export function scheduleWriteFor(current, document, options = {}) {
  if (text(current?.status) === "completed") return null;
  if (sameSchedule(current, document.data)) return null;
  if (text(current?.status) === "cancelled" && text(document.data?.status) !== "cancelled") {
    const mine = Boolean(text(options.deviceId)) && text(current?.updatedDevice) === text(options.deviceId);
    if (!mine && document.allowRevive !== true) return null;
  }
  return document.data;
}

/** 쓰지 않았을 때 왜인가. 완료 · 다른 기기의 취소 · 이미 같음. */
export function outcomeWithoutWrite(current) {
  const status = text(current?.status);
  if (status === "completed") return PUBLISH_OUTCOME.SETTLED;
  if (status === "cancelled") return PUBLISH_OUTCOME.CANCELLED_ELSEWHERE;
  return PUBLISH_OUTCOME.UNCHANGED;
}

/**
 * @param {string} organizationId
 * @param {Array<{ lessonId: string, data: object }>} documents
 * @param {{ store?: ReturnType<typeof createFirestoreLessonScheduleStore>, createdBy?: string, deviceId?: string }} [options]
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
          const write = scheduleWriteFor(current, document, { deviceId: options.deviceId });
          if (!write) return null;
          /* 어느 기기가 썼는가 -- 취소를 되살려도 되는지 다음에 이것을 본다.
             처음 만드는 문서에만 누가 만들었는지 적는다. */
          return {
            ...write,
            ...(text(options.deviceId) ? { updatedDevice: text(options.deviceId) } : {}),
            ...(!current && options.createdBy ? { createdBy: options.createdBy } : {}),
          };
        },
      );
      results.push({ lessonId, outcome, errorCode: "" });
    } catch (error) {
      results.push({ lessonId, outcome: PUBLISH_OUTCOME.FAILED, errorCode: text(error?.code) || "unknown" });
    }
  }
  return results;
}
