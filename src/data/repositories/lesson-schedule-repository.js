/**
 * 강사 일정을 센터 서버의 `lessons/{id}` 에 쓴다 (schedule-publish.js 가 만든 문서).
 *
 * ── 완료된 수업은 건드리지 않는다 ──
 * 확정(deductPass)이 같은 문서를 "completed" 로 쓴다. 그 뒤에 일정 쪽이
 * "scheduled" 를 쓰면 완료가 되돌아간다. 그래서 **읽고 쓰기를 한 트랜잭션**으로
 * 묶는다 -- 읽은 순간과 쓴 순간 사이에 확정이 끼면 트랜잭션이 다시 돈다.
 *
 * ── 수정 번호 (2026-10-31, 동기화 1단계) ──
 * 문서마다 `revision` 이 있고 일정 쓰기마다 1 씩 오른다. 기기는 마지막으로 본 번호
 * (`baseRevision`)를 들고 쓴다. 서버 번호가 그것과 다르면 그사이 다른 기기가
 * 고친 것이다 -- **쓰지 않고 CONFLICT 로 돌려준다.** 서버가 이긴다. 밀린 수정은
 * 앱이 버리지 않고 [내 수정 다시 적용] 으로 남긴다. 규칙도 같은 것을 본다
 * (revision == 서버 + 1) -- 옛 탭이 번호 없이 덮는 것을 서버가 막는다.
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
  /** 그사이 다른 기기가 고쳤다. 쓰지 않았다 -- 서버가 이긴다. */
  CONFLICT: "conflict",
  FAILED: "failed",
});

const text = (value) => String(value ?? "").trim();

/** 서버 문서의 수정 번호. 번호가 생기기 전의 문서는 0 이다. */
export const revisionOf = (current) => Math.max(0, Number(current?.revision) || 0);

/**
 * Firestore 에 붙는 쓰기. 단위 테스트는 같은 모양의 가짜를 넘기고, 규칙 테스트는
 * 에뮬레이터의 firestore 를 넘겨 **이 코드 그대로** 규칙을 지나게 한다 --
 * 가짜만으로는 규칙이 이 읽기를 막는 것을 못 잡았다 (2026-10-31).
 *
 * @param {{ firestore?: any }} [options]
 * @returns {{ transact: (documentPath: string, decide: (current: any) => { write: any, outcome: string }) => Promise<{ outcome: string, revision: number }> }}
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
        const { write, outcome } = decide(current);
        if (write) {
          transaction.set(reference, {
            ...write,
            updatedAt: serverTimestamp(),
            ...(current ? {} : { createdAt: serverTimestamp() }),
          }, { merge: true });
        }
        return { outcome, revision: write ? write.revision : revisionOf(current) };
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
  const grades = (value) => JSON.stringify(Object.entries(value && typeof value === "object" ? value : {}).sort());
  return text(current.status) === text(data.status)
    && millis(current.startsAt) === millis(data.startsAt)
    && millis(current.endsAt) === millis(data.endsAt)
    && ids(current.clientIds) === ids(data.clientIds)
    && text(current.lessonType) === text(data.lessonType)
    && text(current.instructorId) === text(data.instructorId)
    && text(current.locationId) === text(data.locationId)
    && text(current.scheduleType) === text(data.scheduleType)
    && text(current.room) === text(data.room)
    && ids(current.equipmentIds) === ids(data.equipmentIds)
    && grades(current.careGrades) === grades(data.careGrades);
}

/**
 * 이 문서를 지금 써도 되는가. **순수 함수다.** decideScheduleWrite 의 쓰기만.
 *
 * @param {any} current
 * @param {{ data: any, allowRevive?: boolean, baseRevision?: number }} document
 * @param {{ deviceId?: string }} [options]
 */
export function scheduleWriteFor(current, document, options = {}) {
  return decideScheduleWrite(current, document, options).write;
}

/**
 * 쓸 것인가, 왜 아닌가. 차례로:
 * 1. 완료된 수업이면 쓰지 않는다 (확정이 이긴다)
 * 2. 서버와 같으면 쓰지 않는다 (쓸 것이 없다)
 * 3. **취소된 수업은 아무 기기나 되살리지 못한다** (2026-10-31). 되살릴 수 있는
 *    것은 이 기기가 취소한 것(updatedDevice 가 나)과, 이번 저장에서 새로 들어온
 *    것(allowRevive -- 되돌리기 · 다시 살리기)뿐이다. 앱을 열 때 맞추기는 아니다.
 * 4. 서버 번호가 기기가 본 번호와 다르면 쓰지 않는다 (다른 기기가 먼저 고쳤다).
 *    문서가 아직 없으면 견줄 것이 없다.
 *
 * @param {any} current
 * @param {{ data: any, allowRevive?: boolean, baseRevision?: number }} document
 * @param {{ deviceId?: string }} [options]
 * @returns {{ write: any | null, outcome: string }}
 */
export function decideScheduleWrite(current, document, options = {}) {
  if (text(current?.status) === "completed") return { write: null, outcome: PUBLISH_OUTCOME.SETTLED };
  if (sameSchedule(current, document.data)) return { write: null, outcome: PUBLISH_OUTCOME.UNCHANGED };
  if (text(current?.status) === "cancelled" && text(document.data?.status) !== "cancelled") {
    const mine = Boolean(text(options.deviceId)) && text(current?.updatedDevice) === text(options.deviceId);
    if (!mine && document.allowRevive !== true) return { write: null, outcome: PUBLISH_OUTCOME.CANCELLED_ELSEWHERE };
  }
  const serverRevision = revisionOf(current);
  /* 서버의 마지막 쓰기가 이 기기의 것이면 충돌이 아니다 -- 그사이 다른 기기가
     끼지 않았다. 지웠다가 되돌리기를 누른 일정은 지우기 전 번호를 들고 오는데,
     그 사이의 번호는 내가 지운 한 번뿐이다. */
  const lastWriterIsMe = Boolean(text(options.deviceId)) && text(current?.updatedDevice) === text(options.deviceId);
  if (current && !lastWriterIsMe && serverRevision !== Math.max(0, Number(document.baseRevision) || 0)) {
    return { write: null, outcome: PUBLISH_OUTCOME.CONFLICT };
  }
  return { write: { ...document.data, revision: serverRevision + 1 }, outcome: PUBLISH_OUTCOME.WRITTEN };
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
 * @param {Array<{ lessonId: string, data: object, baseRevision?: number, deleted?: boolean, allowRevive?: boolean }>} documents
 * @param {{ store?: ReturnType<typeof createFirestoreLessonScheduleStore>, createdBy?: string, deviceId?: string }} [options]
 * @returns {Promise<Array<{ lessonId: string, outcome: string, errorCode: string, revision: number }>>}
 */
export async function publishScheduledLessons(organizationId, documents, options = {}) {
  const organization = text(organizationId);
  const store = options.store || createFirestoreLessonScheduleStore();
  const results = [];
  for (const document of Array.isArray(documents) ? documents : []) {
    const lessonId = text(document?.lessonId);
    if (!organization || !lessonId) continue;
    try {
      const { outcome, revision } = await store.transact(
        paths.lesson(organization, lessonId),
        (current) => {
          const decided = decideScheduleWrite(current, document, { deviceId: options.deviceId });
          if (!decided.write) return decided;
          /* 누가 · 어느 기기가 썼는가. 기기는 취소를 되살려도 되는지 다음에 이것을
             본다. 지운 일정에는 지운 시각을 남긴다 -- 출석 전원 취소와 가른다.
             처음 만드는 문서에만 누가 만들었는지 적는다. */
          return {
            outcome: decided.outcome,
            write: {
              ...decided.write,
              ...(text(options.createdBy) ? { updatedBy: text(options.createdBy) } : {}),
              ...(text(options.deviceId) ? { updatedDevice: text(options.deviceId) } : {}),
              deletedAt: document.deleted ? new Date() : null,
              ...(!current && options.createdBy ? { createdBy: options.createdBy } : {}),
            },
          };
        },
      );
      results.push({ lessonId, outcome, errorCode: "", revision: Number(revision) || 0 });
    } catch (error) {
      results.push({ lessonId, outcome: PUBLISH_OUTCOME.FAILED, errorCode: text(error?.code) || "unknown", revision: 0 });
    }
  }
  return results;
}

/**
 * 확정을 되돌린 수업을 다시 예정으로 (2026-10-31). 전에는 원장만 보정하고 서버의
 * 수업 문서는 "completed" 로 남아, 그 수업은 다시는 회원 앱에 나가지 않았다.
 * 대표만 한다 (규칙: completed → scheduled 는 대표).
 *
 * @param {string} organizationId
 * @param {string} lessonId
 * @param {{ store?: any, firestore?: any, updatedBy?: string, deviceId?: string }} [options]
 * @returns {Promise<{ outcome: string, revision: number }>}
 */
export async function reopenSettledLesson(organizationId, lessonId, options = {}) {
  const store = options.store || createFirestoreLessonScheduleStore({ firestore: options.firestore });
  const result = await store.transact(paths.lesson(text(organizationId), text(lessonId)), (current) => {
    if (!current) return { write: null, outcome: "missing" };
    if (text(current.status) !== "completed") return { write: null, outcome: "not_completed" };
    return {
      outcome: "reopened",
      write: {
        status: "scheduled",
        revision: revisionOf(current) + 1,
        ...(text(options.updatedBy) ? { updatedBy: text(options.updatedBy) } : {}),
        ...(text(options.deviceId) ? { updatedDevice: text(options.deviceId) } : {}),
      },
    };
  });
  return { outcome: result.outcome, revision: result.revision };
}
