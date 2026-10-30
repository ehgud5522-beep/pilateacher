/**
 * 서버의 내 수업 일정을 실시간으로 받는다 (2026-10-31, 동기화 2단계).
 *
 * 앱이 열려 있는 동안만, **내 수업 일정만**(instructorId == 나), 7일 전 ~ 60일 뒤
 * (대표 조건). 센터 PC 는 탭을 하루 종일 열어 두므로 "돌아올 때 다시 읽기" 로는
 * 다른 PC 의 변경이 거의 안 들어온다 -- 그래서 리스너다. 처음 한 번은 범위 안의
 * 문서 수만큼 읽고, 그 뒤로는 바뀐 문서만 읽는다.
 *
 * 색인: lessons (instructorId, startsAt) -- firestore.foundation.indexes.json.
 *
 * 읽은 문서 수는 부르는 쪽이 하루 단위로 센다 (sync-read-counter.js).
 */

import { paths } from "../schema/paths.js";

const text = (value) => String(value ?? "").trim();

const lessonsCollection = (organizationId) => {
  const documentPath = paths.lesson(organizationId, "placeholder");
  return documentPath.slice(0, documentPath.lastIndexOf("/"));
};

/**
 * @param {{
 *   firestore?: any, organizationId: string, instructorId: string, from: Date, to: Date,
 *   onDocs: (docs: Array<any>, meta: { changes: number, fromCache: boolean }) => void,
 *   onError?: (error: any) => void,
 * }} input
 * @returns {Promise<() => void>} 구독을 끊는 함수
 */
export async function subscribeMyLessons(input) {
  const { collection, getFirestore, onSnapshot, query, where } = await import("firebase/firestore");
  const firestore = input.firestore || getFirestore();
  const organizationId = text(input.organizationId);
  const instructorId = text(input.instructorId);
  if (!organizationId || !instructorId) return () => {};
  const mine = query(
    collection(firestore, lessonsCollection(organizationId)),
    where("instructorId", "==", instructorId),
    where("startsAt", ">=", input.from),
    where("startsAt", "<", input.to),
  );
  return onSnapshot(mine, (snapshot) => {
    input.onDocs(
      snapshot.docs.map((document) => ({ id: document.id, ...document.data() })),
      { changes: snapshot.docChanges().length, fromCache: snapshot.metadata.fromCache },
    );
  }, (error) => input.onError?.(error));
}

/**
 * 한 번만 읽는다 (규칙 테스트 · 다시 시도). 리스너와 같은 질의다.
 * @returns {Promise<Array<any>>}
 */
export async function readMyLessons(input) {
  const { collection, getDocs, getFirestore, query, where } = await import("firebase/firestore");
  const firestore = input.firestore || getFirestore();
  const page = await getDocs(query(
    collection(firestore, lessonsCollection(text(input.organizationId))),
    where("instructorId", "==", text(input.instructorId)),
    where("startsAt", ">=", input.from),
    where("startsAt", "<", input.to),
  ));
  return page.docs.map((document) => ({ id: document.id, ...document.data() }));
}
