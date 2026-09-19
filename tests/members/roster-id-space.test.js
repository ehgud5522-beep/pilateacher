import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { mergeRoster } from "../../src/features/roster/roster-bridge.js";
import { evaluateLessonRecordLink } from "../../src/features/lesson-record/link-context.js";

const appSource = () => readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");

/* ── 왜 이 파일이 있는가 ───────────────────────────────────────────────────

   명부를 조직 회원으로 갈아끼운 날, 실기기에서 핵심 기능 셋이 한꺼번에 깨졌다 --
   음성 수업기록 · 체형 분석 화면 · 첫 사진 촬영. 그런데 1749개 테스트는 전부
   통과했다.

   이유는 하나다. 그날 바뀐 것은 어느 함수의 동작이 아니라 **id 의 의미**였다.
   조직에만 있는 회원은 id 가 조직 clientId 이고 기기 목록(db.members)에는 그
   행이 없다. 그 회원 id 를 들고 db.members 에서 찾는 코드는 전부 "없는 사람" 을
   보게 된다.

   기존 테스트가 못 잡은 이유:
     - roster-bridge 테스트는 명부를 순수 함수로만 본다. 그 결과를 누가 어떻게
       쓰는지는 보지 않는다.
     - link-context 테스트는 members 를 직접 넘긴다. 호출하는 쪽이 어느 목록을
       넘기는지가 바로 그 버그였는데, 그 자리는 테스트가 없었다.
     - 화면 스모크는 컴포넌트에 props 를 직접 준다. App 의 배선을 지나지 않는다.

   그래서 두 가지를 고정한다. 하나는 id 공간이 실제로 갈라진다는 사실이고,
   다른 하나는 App 의 회원 조회가 명부를 거친다는 것이다. */

test("a centre-only member's id is not in the device list — that is the whole bug", () => {
  const { roster } = mergeRoster({
    clients: [
      { id: "client-only", name: "한지우", phone: "01011112222", status: "active" },
      { id: "client-linked", name: "김하나", phone: "01012345678", status: "active" },
    ],
    members: [{ id: "m-local-1", name: "김하나", phone: "010-1234-5678", notes: [] }],
    passes: [],
    now: new Date(2026, 8, 20),
  });

  const deviceIds = new Set(["m-local-1"]);
  const [centreOnly, linked] = roster;
  assert.equal(centreOnly.id, "client-only");
  assert.equal(deviceIds.has(centreOnly.id), false, "기기 목록에 없다 -- 여기서 모든 것이 갈렸다");
  // 맞물린 회원은 레거시 id 를 그대로 쓴다. 그래서 절반만 깨졌다.
  assert.equal(linked.id, "m-local-1");
  assert.equal(deviceIds.has(linked.id), true);
});

test("the link check fails on the device list and passes on the roster", () => {
  /* 실기기 진단에 찍힌 그대로다: record_end · voice_blob_saved 까지 정상인데
     마지막 연결 단계에서만 member_session_unresolved. */
  const { roster } = mergeRoster({
    clients: [{ id: "client-only", name: "한지우", phone: "01011112222", status: "active" }],
    members: [],
    passes: [],
    now: new Date(2026, 8, 20),
  });
  const schedule = [{ id: "lesson-1", attendees: [{ memberId: "client-only", status: "booked" }] }];

  const onDeviceList = evaluateLessonRecordLink({
    members: [], schedule, memberId: "client-only", lessonId: "lesson-1",
  });
  assert.equal(onDeviceList.state, "link_review_required");
  assert.equal(onDeviceList.reason, "member_missing");

  const onRoster = evaluateLessonRecordLink({
    members: roster, schedule, memberId: "client-only", lessonId: "lesson-1",
  });
  assert.equal(onRoster.state, "linked");
});

/* ── 배선 ─────────────────────────────────────────────────────────────────

   위 두 가지는 "그렇게 되면 깨진다" 를 보여줄 뿐 배선을 보지 않는다. App.jsx 는
   한 파일에 2만 줄이라 단위 테스트로 그 핸들러들을 부를 수가 없다. 그래서 소스를
   읽어 고정한다 -- 화면 크기를 픽셀로 쓰지 못하게 막는 테스트와 같은 방식이다.

   여기서 막는 것은 하나다: 화면이 건네는 회원 id 를 db.members 에서 찾는 일. */

test("App resolves a member through the roster, not the device list", async () => {
  const source = await appSource();
  assert.match(source, /const findRosterMember = useCallback\(/, "명부 조회 함수가 있어야 한다");

  /* 그날 깨졌던 네 자리. 다시 db.members 로 돌아가면 같은 증상이 그대로 온다. */
  const mustUseRoster = [
    { label: "체형 분석 워크스페이스", near: "hub={(id, initialSavedId) => {" },
    { label: "분석 대상 회원", near: "const analysisMember = (memberId) => {" },
    { label: "인바디 저장", near: "const saveInbody = (id, rec) => {" },
    { label: "인바디 삭제", near: "const deleteInbody = (id, recId) => {" },
  ];
  for (const site of mustUseRoster) {
    const at = source.indexOf(site.near);
    assert.ok(at > 0, `${site.label}: 자리를 찾지 못했다`);
    const body = source.slice(at, at + 400);
    assert.match(body, /findRosterMember\(/, `${site.label}: 명부로 찾아야 한다`);
    assert.doesNotMatch(body, /db\.members\.find\(/, `${site.label}: 기기 목록으로 찾으면 안 된다`);
  }
});

test("the lesson-record link is evaluated against the roster", async () => {
  const source = await appSource();
  const at = source.indexOf("const link = evaluateLessonRecordLink(");
  assert.ok(at > 0);
  const body = source.slice(at - 600, at + 200);
  /* 회원은 명부에서, 일정은 건네받은 db 에서. 그리고 백업은 계속 진짜 db 를
     써야 한다 -- 명부를 백업에 넣으면 조직 회원이 기기 저장에 복사된다. */
  assert.match(body, /linkMembers/);
  assert.match(body, /rosterMembers/);
});

test("writing to a member that has no device row creates one instead of doing nothing", async () => {
  /* 없는 행에 쓰는 것은 실패가 아니라 침묵이다. 화면은 저장된 척하고 기록만
     사라진다 -- 강사가 알아챌 방법이 없다. */
  const source = await appSource();
  for (const near of ["const patch = async (id, p, duet) => {", "const saveScheduleComment = async ("]) {
    const at = source.indexOf(near);
    assert.ok(at > 0, near);
    const body = source.slice(at, at + 1800);
    assert.match(body, /findRosterMember\(/, `${near}: 명부에서 찾아야 한다`);
    assert.match(body, /blankMember\(/, `${near}: 없으면 행을 만들어야 한다`);
  }
});
