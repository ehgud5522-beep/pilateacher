/**
 * 웹 배포 전에 멈춰야 할 이유가 있는가.
 *
 * ── 왜 있는가 ──
 * 배포된 화면이 어느 코드인지 나중에 알 수 있어야 한다. 커밋되지 않은 변경이
 * 섞여 나가면 그 화면은 저장소 어디에도 없는 상태가 되고, "이 버그가 언제
 * 들어왔나" 를 물을 때 짚을 커밋이 없다. 되돌릴 대상도 없다.
 *
 * 브랜치도 같은 이유다. 실험 중인 브랜치가 실수로 나가면 대표가 쓰는 화면이
 * 조용히 바뀐다 -- 웹은 스토어 심사 같은 관문이 없어서 누르는 즉시 전부에게
 * 간다.
 *
 * ── 왜 순수 함수인가 ──
 * git 상태를 만들어 가며 시험할 수는 없다. 판정만 떼어 두면 어떤 상태든 인자로
 * 넣어 볼 수 있다.
 */

/** 여기서만 배포한다. 늘리려면 이 목록 하나만 고친다. */
export const DEPLOYABLE_BRANCHES = Object.freeze(["main", "docs/app-review-account"]);

/**
 * 더러워도 배포를 막지 않는 파일.
 *
 * package-lock.json 은 npm 이 설치할 때마다 만지고 화면에 닿지 않는다. 이것으로
 * 막으면 배포가 거의 매번 막히고, 매번 막히는 장치는 곧 꺼진다.
 */
export const IGNORED_DIRTY_PATHS = Object.freeze(["package-lock.json"]);

/**
 * `git status --porcelain` 한 줄에서 경로만 꺼낸다.
 *
 * 형식은 `XY<공백>경로` 이고, 이름이 바뀐 파일은 `R  옛것 -> 새것` 이다.
 * 공백이나 한글이 든 이름은 따옴표로 감싸여 온다.
 */
export function porcelainPath(line) {
  const text = String(line ?? "");
  /* 앞 두 칸을 자리수로 세지 않고 상태 글자로 벗긴다.

     ` M path` 의 첫 칸은 공백이라, 출력 전체에 trim 을 한 번 먹이면 첫 줄만
     한 칸 밀린다. 그러면 slice(3) 이 경로 첫 글자를 먹고 package-lock.json 이
     `ackage-lock.json` 이 되어 제외 목록에 걸리지 않는다 -- 실제로 그렇게
     새어 나갔다. 부르는 쪽도 고쳤지만, 판정이 입력 모양 하나에 기대고 있으면
     같은 일이 다시 일어난다. */
  const rest = text.replace(/^[ MADRCU?!]{1,2}\s+/, "").trim();
  if (rest === text.trim()) return "";
  const moved = rest.includes(" -> ") ? rest.slice(rest.indexOf(" -> ") + 4) : rest;
  return moved.replace(/^"(.*)"$/, "$1").trim();
}

/**
 * @param {{ branch?: string, status?: string }} input
 *   branch  현재 브랜치 이름. 분리된 HEAD 면 빈 문자열
 *   status  `git status --porcelain` 의 출력 그대로
 * @returns {Array<{ code: string, message: string }>} 비어 있으면 배포해도 된다
 */
export function deployBlockers(input = {}) {
  const blockers = [];
  const branch = String(input.branch ?? "").trim();

  if (!branch || branch === "HEAD") {
    /* 분리된 HEAD 에서는 나간 코드를 가리킬 이름이 없다. 커밋 해시는 남지만
       다음 사람이 "그때 무엇을 내보냈나" 를 물을 때 찾을 자리가 없다. */
    blockers.push({
      code: "DETACHED_HEAD",
      message: "브랜치가 아닌 상태(detached HEAD)입니다. 배포할 브랜치로 옮긴 뒤 다시 하세요.",
    });
  } else if (!DEPLOYABLE_BRANCHES.includes(branch)) {
    blockers.push({
      code: "BRANCH_NOT_ALLOWED",
      message: `${branch} 에서는 배포하지 않습니다. 허용: ${DEPLOYABLE_BRANCHES.join(" · ")}`,
    });
  }

  const dirty = String(input.status ?? "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => ({ line, path: porcelainPath(line) }))
    .filter((item) => item.path && !IGNORED_DIRTY_PATHS.includes(item.path));

  if (dirty.length) {
    blockers.push({
      code: "WORKING_TREE_DIRTY",
      message: [
        `커밋되지 않은 변경이 ${dirty.length}건 있습니다. 배포된 화면이 어느 커밋인지 알 수 없게 됩니다.`,
        ...dirty.slice(0, 10).map((item) => `    ${item.line}`),
        ...(dirty.length > 10 ? [`    … 외 ${dirty.length - 10}건`] : []),
      ].join("\n"),
    });
  }

  return blockers;
}
