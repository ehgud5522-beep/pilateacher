/**
 * 시계를 앞으로 옮겨 테스트를 다시 돌린다. `npm run test:clock`.
 *
 * ── 왜 빌드 앞에 있는가 ──
 * 픽스처가 오늘에 기대면 **만든 날에만 통과한다.** 이 저장소에서 그 일이 네
 * 번 있었고, 마지막에는 그 테스트가 main 에 남아 Codemagic 을 멈춰 세웠다 --
 * 고친 사람은 이미 다른 일을 하고 있었고, 무너진 빌드는 그 사람 것이 아니었다.
 *
 * 보통의 테스트는 "지금 맞는가" 를 묻는다. 이것은 **"다음 달에도 맞는가"** 를
 * 묻는다. 둘은 다른 질문이고, 앞의 것만으로는 시한폭탄을 못 찾는다.
 *
 * ── 왜 두 칸인가 ──
 * +30일  차감 소급 창(7일)·만료 임박(14일)처럼 날짜 단위로 움직이는 판정
 * +365일 연도가 바뀔 때만 드러나는 것 -- 날짜 라벨의 연도, 회원권 만료
 *
 * 둘 다 돌리는 데 5분쯤 걸린다. 그 5분이 지난번 Codemagic 한 판보다 싸다.
 *
 * ── 실패했을 때 고치는 법 ──
 * 픽스처의 날짜를 오늘 기준으로 바꾸는 것이 아니라, **시계를 주입한다.**
 * 대부분의 함수가 이미 `now` 옵션을 받는다 -- 안 받으면 그것부터 만든다.
 * 오늘로부터 며칠 뒤로 픽스처를 옮기면 그 테스트는 내일 또 다른 날에 터진다.
 */

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

/* 돌릴 파일 목록은 test:node 에서 그대로 가져온다. 여기에 따로 적으면 새
   폴더가 생긴 날 한쪽에만 추가되고, 빠진 쪽은 조용히 안 돌아간다. */
const suite = String(require(path.join(root, "package.json")).scripts["test:node"] || "")
  .replace(/^node --test\s+/, "")
  .trim();

if (!suite) {
  console.error("\n[CLOCK_SUITE_NOT_FOUND]");
  console.error("package.json 의 test:node 에서 돌릴 목록을 읽지 못했습니다.");
  process.exit(1);
}

/** 며칠 뒤로 옮겨 볼 것인가. 근거는 이 파일 머리말에 있다. */
const SHIFTS = [30, 365];

const failures = [];
for (const days of SHIFTS) {
  const at = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  process.stdout.write(`\n── 시계 +${days}일 (${at}) ──────────────────────────\n`);
  const result = spawnSync(
    process.execPath,
    ["--import", "./tools/clock-shift.mjs", "--test", ...suite.split(/\s+/)],
    {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, CLOCK_SHIFT_DAYS: String(days), CLOCK_SHIFT_QUIET: "1" },
      /* 셸을 거치지 않는다. Windows 에서 cmd 를 끼우면 node.exe 경로가
         "C:\Program Files\..." 의 띄어쓰기에서 끊긴다. 그러면 테스트가 아니라
         실행 자체가 실패하는데 화면에는 "시계 의존 테스트" 라고 나온다 --
         없는 버그를 찾으러 다니게 된다. 실제로 그랬다.
         파일 목록의 별표는 node --test 가 직접 푸는 것이라 셸이 할 일이 없다. */
    },
  );
  /* 실행이 시작도 못 한 것과 테스트가 떨어진 것은 다른 실패다. */
  if (result.error || result.status === null) {
    console.error("\n[CLOCK_RUN_FAILED]");
    console.error(
      `시계 +${days}일 실행을 시작하지 못했습니다: ${result.error?.message || `signal ${result.signal}`}`,
    );
    process.exit(1);
  }
  if (result.status !== 0) failures.push(days);
}

if (failures.length) {
  console.error(`\n[CLOCK_DEPENDENT_TEST]`);
  console.error(`시계를 +${failures.join("일, +")}일 옮기면 무너지는 테스트가 있습니다.`);
  console.error("");
  console.error("픽스처의 날짜를 오늘 기준으로 옮기지 마세요 -- 그러면 또 다른 날에 터집니다.");
  console.error("그 테스트가 부르는 함수에 시계를 주입하세요 (대부분 now 옵션을 이미 받습니다).");
  process.exit(1);
}

process.stdout.write(`\n시계를 +${SHIFTS.join("일, +")}일 옮겨도 전부 통과했습니다.\n`);
