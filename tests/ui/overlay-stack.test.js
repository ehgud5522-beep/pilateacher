import assert from "node:assert/strict";
import test from "node:test";
import {
  OVERLAY_LAYER, OVERLAY_OPEN_ORDER, SHEET_Z, overlayZ,
} from "../../src/features/ui/overlay-stack.js";

/* ── 왜 이 표를 테스트로 묶어 두는가 ─────────────────────────────────────
   1.1.42 웹에서 회원 상세의 "담당 변경" 을 누르면 담당 변경이 회원 상세
   **뒤에서** 열렸다. 둘 다 z-50 이었고, 값이 같으면 App.jsx 에서 먼저 적힌
   쪽이 밑으로 간다 -- 담당 변경이 먼저 적혀 있었다.

   값 하나가 다시 같아지는 순간 버그가 그대로 돌아오는데, 화면은 멀쩡히
   그려지므로 어떤 렌더 테스트도 그것을 잡지 못한다. 그래서 숫자 자체를
   여기서 본다. */

test("열리는 순서대로 z-index 가 커진다", () => {
  const stack = OVERLAY_OPEN_ORDER.map((name) => ({ name, z: overlayZ(name) }));
  for (let index = 1; index < stack.length; index += 1) {
    const under = stack[index - 1];
    const over = stack[index];
    assert.ok(over.z > under.z,
      `${over.name}(${over.z}) 는 ${under.name}(${under.z}) 위에 서야 한다`);
  }
});

test("표에 적힌 층은 OVERLAY_OPEN_ORDER 에 빠짐없이 들어 있다", () => {
  /* 표에만 더하고 순서에 안 적으면 그 층은 아무것과도 견줘지지 않는다 --
     "위에 서야 한다" 가 어디에도 안 적힌 층이 생긴다. */
  assert.deepEqual([...OVERLAY_OPEN_ORDER].sort(), Object.keys(OVERLAY_LAYER).sort());
  assert.equal(new Set(Object.values(OVERLAY_LAYER)).size, Object.keys(OVERLAY_LAYER).length,
    "두 층이 같은 값을 쓰면 다시 JSX 순서가 정하게 된다");
});

test("회원 상세가 안에서 연 시트보다도 담당 변경이 위다", () => {
  /* 회원 상세는 자기 z-index 로 쌓임 맥락을 만든다. 그 안의 시트는
     position:fixed 에 z-60 이어도 회원 상세 층 안에 갇히므로, 담당 변경은
     회원 상세보다 크기만 해서는 모자라고 **시트 값보다도** 커야 한다. */
  assert.ok(overlayZ("ACTION") > OVERLAY_LAYER.DETAIL);
  assert.ok(overlayZ("ACTION") > SHEET_Z);
});

test("없는 층 이름은 조용한 0 이 아니라 그 자리에서 터진다", () => {
  /* 조용히 0 이 되면 정확히 고치려던 그 버그 -- 뒤에서 열림 -- 로 돌아간다. */
  assert.throws(() => overlayZ("MODAL"), /Unknown overlay layer/);
  assert.throws(() => overlayZ(undefined), /Unknown overlay layer/);
});
