import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

/**
 * 듀엣 발급이 화면에서 실제로 이어졌는지 본다.
 *
 * 판정은 tests/data/duet-issue.test.js 가 보고, 여기서는 그 판정이 불리는지와
 * 발급이 짝을 싣는지를 본다 -- 판정이 아무리 맞아도 호출되지 않으면 듀엣이
 * 회원 한 명의 회원권으로 나간다. App.jsx 는 단위 테스트로 열 수 없어 소스로
 * 확인한다.
 */
const appSource = await readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");

test("the form refuses to advance while a duet is incomplete", () => {
  /* 짝 없는 듀엣이나 같은 사람 둘은 데이터가 깨진다. 확인 화면까지 보내면
     대표는 그것이 정상인 줄 안다. */
  assert.match(appSource, /const duetBlock = blockingNotice\(duetNotices\)/);
  assert.match(appSource, /if \(duetBlock\) \{ setFormError\(duetBlock\.message\); return; \}/);
});

test("issuing carries both members, with the anchor first", () => {
  // 규칙과 원장이 clientIds[0] === clientId 에 걸려 있다.
  assert.match(appSource, /clientIds: \[client\.id, partner\.id\]/);
});

test("a 1:1 issue does not grow a clientIds field", () => {
  /* 길이 1 짜리 배열을 심어도 뜻은 같지만, 없던 필드가 생기면 "이 회원권은
     언제 만들어졌나" 를 필드로 가려내던 자리가 흐려진다. */
  assert.match(appSource, /\.\.\.\(form\.duet && partner \? \{ clientIds:/);
});

test("the confirmation renders what does not block but must be seen", () => {
  assert.match(appSource, /reviewNotices\(duetNotices\)\.map/);
  assert.match(appSource, /duetSummaryLine\(total\)/);
});

test("the judgement lives in one module, not spread through the screen", () => {
  /* 막는 것과 알리는 것을 화면 안에서 섞기 시작하면 어느 것이 어느 무게인지
     다음 사람이 알 수 없다. */
  assert.match(appSource, /duetIssueNotices\(\{/);
  assert.doesNotMatch(appSource, /partnerClientId === form\.clientId/, "같은 사람 판정이 화면에 복제되어 있다");
});

test("the partner list never offers the member already chosen", () => {
  // 판정이 막지만, 고를 수 없게 해 두면 그 실수 자체가 일어나지 않는다.
  assert.match(appSource, /item\.id !== form\.clientId && clientMatchesSearch\(item, partnerSearch\)/);
});

test("a pass read that failed never blocks the issue", () => {
  /* 경고 하나 때문에 정당한 계약을 팔 수 없게 되면 안 된다. 회원권은
     "이미 있는 회원권" 경고에만 쓴다. */
  assert.match(appSource, /toleratingReadFailure\(listPasses\(organizationId, \{ store: passStore \}\)\)/);
});
