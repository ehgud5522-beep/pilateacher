import assert from "node:assert/strict";
import test from "node:test";
import {
  centreLessonRows, centreLessonSummary, lessonHasClient,
} from "../../src/features/members/centre-lessons.js";
import { readCentreLessons } from "../../src/data/repositories/member-note-repository.js";

const A = "client-a";
const B = "client-b";
const NAMES = { "u-1": "정예진", "u-2": "박서연" };
const nameOf = (id) => NAMES[id] || "";

const lesson = (overrides = {}) => ({
  lessonId: "l-1", clientId: A, clientIds: [A], instructorId: "u-1",
  startsAt: new Date(2026, 8, 18, 19, 0), ...overrides,
});
const note = (overrides = {}) => ({
  lessonId: "l-1", clientId: A, memberNote: "숄더브릿지 3세트", createdBy: "u-1", ...overrides,
});

/* ── 누가 그 수업에 있었나 ────────────────────────────────────────────── */

test("옛 수업은 clientIds 가 없고 clientId 하나만 있다", () => {
  /* 안 받아 주면 듀엣 기능 전에 기록된 수업이 통째로 사라진다. */
  assert.equal(lessonHasClient({ clientId: A }, A), true);
  assert.equal(lessonHasClient({ clientId: A }, B), false);
  assert.equal(lessonHasClient({ clientId: A, clientIds: [] }, A), true, "빈 배열은 없는 것과 같다");
});

test("듀엣은 두 사람 모두의 기록이다", () => {
  const duet = { clientId: A, clientIds: [A, B] };
  assert.equal(lessonHasClient(duet, A), true);
  assert.equal(lessonHasClient(duet, B), true);
  assert.equal(lessonHasClient(duet, "client-c"), false);
});

test("회원 id 가 없으면 아무 수업도 그 회원의 것이 아니다", () => {
  assert.equal(lessonHasClient(lesson(), ""), false);
  assert.equal(lessonHasClient(lesson(), null), false);
});

/* ── 수업과 말을 묶는다 ──────────────────────────────────────────────── */

test("수업에 그 수업의 말이 붙는다", () => {
  const rows = centreLessonRows({ clientId: A, lessons: [lesson()], notes: [note()], instructorName: nameOf });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].memberNote, "숄더브릿지 3세트");
  assert.equal(rows[0].taughtByName, "정예진");
  assert.equal(rows[0].wroteByName, "정예진");
  assert.equal(rows[0].writtenByOther, false);
});

test("다른 회원의 말이 섞이지 않는다", () => {
  /* 문서 id 가 `${lessonId}_${clientId}` 라 듀엣 한 수업에 말이 둘이다.
     섞이면 짝에게 보낸 말이 이 회원의 화면에 뜬다. */
  const rows = centreLessonRows({
    clientId: A,
    lessons: [lesson({ clientIds: [A, B] })],
    notes: [note({ clientId: B, memberNote: "짝에게 보낸 말" }), note()],
    instructorName: nameOf,
  });
  assert.equal(rows[0].memberNote, "숄더브릿지 3세트");
});

test("가르친 강사와 말을 쓴 강사가 다르면 그것을 말한다", () => {
  /* 인수인계 뒤에 그렇다. 한 칸으로 뭉개면 "누구와 이야기할까" 에 답할 수 없다. */
  const rows = centreLessonRows({
    clientId: A, lessons: [lesson({ instructorId: "u-1" })],
    notes: [note({ createdBy: "u-2" })], instructorName: nameOf,
  });
  assert.equal(rows[0].taughtByName, "정예진");
  assert.equal(rows[0].wroteByName, "박서연");
  assert.equal(rows[0].writtenByOther, true);
});

test("말이 없는 수업도 줄로 선다", () => {
  const rows = centreLessonRows({ clientId: A, lessons: [lesson()], notes: [], instructorName: nameOf });
  assert.equal(rows.length, 1, "말이 없다고 수업이 없어지지 않는다");
  assert.equal(rows[0].memberNote, "");
  assert.equal(rows[0].wroteByName, "");
  assert.equal(rows[0].writtenByOther, false);
});

test("이름을 못 찾으면 빈 문자열이다 -- uid 를 보여주지 않는다", () => {
  const rows = centreLessonRows({
    clientId: A, lessons: [lesson({ instructorId: "u-없음" })], notes: [],
    instructorName: nameOf,
  });
  assert.equal(rows[0].taughtByName, "");
  assert.equal(rows[0].taughtBy, "u-없음", "uid 자체는 들고 있다 -- 화면이 쓰지 않을 뿐이다");
});

test("이름 조회 함수를 안 주면 터지지 않는다", () => {
  const rows = centreLessonRows({ clientId: A, lessons: [lesson()], notes: [note()] });
  assert.equal(rows[0].taughtByName, "");
  assert.equal(rows[0].memberNote, "숄더브릿지 3세트");
});

/* ── 순서 ─────────────────────────────────────────────────────────────── */

test("최근 수업이 먼저, 날짜를 못 읽은 것은 맨 뒤", () => {
  const rows = centreLessonRows({
    clientId: A,
    lessons: [
      lesson({ lessonId: "old", startsAt: new Date(2026, 5, 1) }),
      lesson({ lessonId: "broken", startsAt: "어제" }),
      lesson({ lessonId: "new", startsAt: new Date(2026, 9, 1) }),
    ],
    notes: [],
  });
  assert.deepEqual(rows.map((row) => row.lessonId), ["new", "old", "broken"]);
});

/* ── 요약 ─────────────────────────────────────────────────────────────── */

test("0건과 못 읽었다를 가른다", () => {
  /* 둘이 같은 얼굴이면 대표는 기록이 없는 것으로 읽고 강사에게 묻지 않는다. */
  assert.equal(centreLessonSummary({ rows: [] }), "센터에 기록된 수업이 없습니다");
  assert.match(centreLessonSummary({ errorCode: "permission-denied" }), /불러오지 못했습니다 \(코드 permission-denied\)/);
  assert.match(centreLessonSummary({ rows: [], errorCode: "unavailable" }), /코드 unavailable/, "오류가 0건보다 먼저다");
});

test("요약은 수업 수와 말이 붙은 수를 따로 센다", () => {
  const rows = centreLessonRows({
    clientId: A,
    lessons: [lesson({ lessonId: "l-1" }), lesson({ lessonId: "l-2" })],
    notes: [note({ lessonId: "l-1" })],
  });
  assert.equal(centreLessonSummary({ rows }), "센터 기록 2건 · 회원에게 보낸 말 1건");
  assert.equal(centreLessonSummary({ rows: rows.filter((row) => !row.memberNote) }), "센터 기록 1건");
});

/* ── 센터에서 읽어 오기 ──────────────────────────────────────────────── */

const fakeStore = ({ lessons = [], notes = [], failLessons = "", failNotes = "" } = {}) => ({
  asked: [],
  read: async () => null,
  serverTimestamp: async () => "T",
  commit: async () => {},
  query(collectionPath, filter) {
    this.asked.push({ collectionPath, filter });
    if (collectionPath.endsWith("/lessons")) {
      if (failLessons) return Promise.reject(Object.assign(new Error("x"), { code: failLessons }));
      return Promise.resolve(lessons);
    }
    if (failNotes) return Promise.reject(Object.assign(new Error("x"), { code: failNotes }));
    return Promise.resolve(notes);
  },
});

test("한 회원의 수업과 말을 한 번에 받아 온다", async () => {
  const store = fakeStore({ lessons: [lesson()], notes: [note()] });
  const found = await readCentreLessons("center-a", { clientId: A, store });
  assert.equal(found.lessons.length, 1);
  assert.equal(found.notes.length, 1);
  assert.equal(found.errorCode, "");
  // 그 회원 것만 묻는다 -- 센터 전체를 받아 와서 거르지 않는다.
  assert.deepEqual(store.asked.map((item) => item.filter), [
    { field: "clientIds", op: "array-contains", value: A },
    { field: "clientId", op: "==", value: A },
  ]);
});

test("정렬을 질의에 붙이지 않는다 -- 복합 색인을 더하지 않으려고", () => {
  /* array-contains 에 orderBy 를 더하면 색인 배포가 한 번 더 필요하다.
     줄 세우기는 centreLessonRows 가 한다. */
  const store = fakeStore();
  return readCentreLessons("center-a", { clientId: A, store }).then(() => {
    for (const asked of store.asked) {
      assert.equal("orderBy" in asked, false);
      assert.equal("limit" in asked, false);
    }
  });
});

test("말만 못 읽으면 수업 목록이라도 보여준다", async () => {
  /* 둘 다 묶어 던지면 "기록이 없다" 와 구별되지 않는다. */
  const found = await readCentreLessons("center-a", {
    clientId: A, store: fakeStore({ lessons: [lesson()], failNotes: "unavailable" }),
  });
  assert.equal(found.lessons.length, 1);
  assert.deepEqual(found.notes, []);
  assert.equal(found.errorCode, "", "수업은 읽혔으므로 오류로 부르지 않는다");
});

test("수업을 못 읽으면 코드를 그대로 돌려준다", async () => {
  const found = await readCentreLessons("center-a", {
    clientId: A, store: fakeStore({ failLessons: "permission-denied" }),
  });
  assert.deepEqual(found.lessons, []);
  assert.equal(found.errorCode, "permission-denied");
  // 그 코드가 요약 문구까지 간다 -- 0건과 구별된다.
  assert.match(centreLessonSummary(found.errorCode ? { errorCode: found.errorCode } : { rows: [] }),
    /코드 permission-denied/);
});

test("회원 id 가 없으면 질의하지 않고 거부한다", async () => {
  const store = fakeStore();
  await assert.rejects(() => readCentreLessons("center-a", { clientId: "", store }));
  assert.deepEqual(store.asked, []);
});
