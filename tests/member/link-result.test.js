import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import {
  LINK_RESULT, OPENS_HOME, linkResultScreen,
} from "../../member/src/link-result.js";

/* 서버가 정한 상태 목록을 그대로 읽어 온다. 화면 쪽 복사본이 하나라도 빠지면
   그 회원은 "연결하지 못했어요 (코드 taken)" 같은 화면을 보게 된다 -- 사람이
   읽을 문구가 있는데 코드가 나오는 것은 목록이 어긋났다는 뜻이다. */
const require = createRequire(import.meta.url);
const { LINK_STATUS } = require("../../functions/src/member-link.js");

test("서버가 돌려주는 상태 전부에 화면이 있다", () => {
  const known = new Set(Object.values(LINK_RESULT));
  for (const status of Object.values(LINK_STATUS)) {
    assert.ok(known.has(status), `화면 쪽에 ${status} 가 없다`);
  }
  assert.deepEqual(
    Object.values(LINK_RESULT).sort(),
    Object.values(LINK_STATUS).sort(),
    "두 목록이 어긋났다 (functions/src/member-link.js 의 LINK_STATUS)",
  );
});

test("들어갈 수 있는 것과 멈추는 것이 갈린다", () => {
  for (const status of OPENS_HOME) {
    assert.equal(linkResultScreen(status).opensHome, true, status);
  }
  for (const status of ["ambiguous", "not_found", "taken", "rejected"]) {
    assert.equal(linkResultScreen(status).opensHome, false, status);
  }
});

test("종료된 회원도 들어가고, 지난 기록을 본다", () => {
  /* 함께한 시간이 사라지는 것이 아니다. 문 앞에서 막으면 회원은 자기 기록을
     영영 못 본다. */
  const screen = linkResultScreen(LINK_RESULT.ENDED);
  assert.equal(screen.opensHome, true);
  assert.match(screen.title, /종료/);
  assert.match(screen.body, /지난 수업 기록/);
});

test("다시 눌러도 같은 답이 나오는 곳에는 재시도 버튼이 없다", () => {
  /* 버튼을 두면 회원은 그것을 누르느라 센터에 전화하지 않는다. 이 셋은
     센터가 움직여야 풀린다. */
  for (const status of ["ambiguous", "not_found", "taken"]) {
    assert.equal(linkResultScreen(status).retry, false, status);
  }
});

test("모르는 상태도 숨기지 않고 코드를 보여준다", () => {
  const screen = linkResultScreen("something_new");
  assert.equal(screen.opensHome, false);
  assert.match(screen.body, /코드 something_new/);
  // 분류하지 못한 것은 일시적 문제일 수 있다. 여기서만 재시도를 준다.
  assert.equal(screen.retry, true);

  const empty = linkResultScreen("");
  assert.match(empty.body, /코드 unknown/);
});

test("문구가 회원에게 할 일을 말한다", () => {
  assert.match(linkResultScreen("ambiguous").body, /센터/);
  assert.match(linkResultScreen("not_found").body, /센터/);
  assert.match(linkResultScreen("taken").body, /센터/);
  // 가족 공용 번호가 실제 사유다. 그것을 말해 주면 회원이 먼저 알아챈다.
  assert.match(linkResultScreen("taken").body, /가족/);
});
