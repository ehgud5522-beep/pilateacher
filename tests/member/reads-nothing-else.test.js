import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * 회원 앱이 **두 문서 말고는 아무것도 읽지 않는다**는 것을 소스로 확인한다.
 *
 * 규칙이 이미 막고 있지만, 규칙이 막는 것은 "남의 문서"다. 자기 센터의
 * `products` 를 읽는 코드가 생기면 규칙은 거부하고 화면은 조용히 빈다 --
 * 그리고 그 실패는 회원 폰에서만 보인다.
 *
 * 그래서 화면이 늘면서 질의가 하나 끼어드는 것을 여기서 잡는다. 이 테스트가
 * 막는 것은 유출이 아니라 **다음 사람의 실수**다.
 */

const memberRoot = fileURLToPath(new URL("../../member/src/", import.meta.url));

/** 문서를 읽는 API 를 가져와도 되는 단 하나의 파일. */
const DATA_FILE = "member-data.js";

/** 핸들을 만드는 데 필요한 것. 이것 말고는 읽기 API 다. */
const HANDLE_ONLY = "getFirestore";

/** 목록을 읽는 API. 회원은 문서를 id 로 하나씩만 연다. */
const LIST_APIS = ["collection(", "collectionGroup(", "getDocs(", "query(", "where(", "onSnapshot("];

/** 열어도 되는 컬렉션. 이 둘뿐이다. */
const ALLOWED_COLLECTIONS = ["memberLinks", "organizations", "memberViews"];

/** 회원 앱이 절대 읽지 않는 곳. */
const FORBIDDEN_COLLECTIONS = [
  "passes", "ledger", "clients", "products", "lessons", "lessonNotes",
  "memberships", "auditLogs", "instructorClientTotals", "assessments", "locations",
];

async function memberSources() {
  const found = [];
  const walk = async (dir) => {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, item.name);
      if (item.isDirectory()) await walk(full);
      else if (/\.(js|jsx)$/.test(item.name)) {
        found.push({ name: path.relative(memberRoot, full), text: await readFile(full, "utf8") });
      }
    }
  };
  await walk(memberRoot);
  return found;
}

/* 주석은 걷어내고 본다. 이 파일들의 머리말이 "passes 를 읽지 않는다" 라고
   적고 있어, 그대로 세면 자기 설명 때문에 실패한다. */
const codeOf = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("문서를 읽는 API 를 가져오는 파일은 하나뿐이다", async () => {
  /* firebase.js 는 getFirestore 로 핸들을 만들어야 한다. 그것 말고 doc·getDoc
     같은 읽기 API 를 가져오는 파일이 늘면, 읽는 자리가 하나라는 말이 거짓이 된다. */
  for (const file of await memberSources()) {
    if (file.name === DATA_FILE) continue;
    const imported = [...codeOf(file.text)
      .matchAll(/import\s*\{([^}]*)\}\s*from\s*"firebase\/firestore(?:\/lite)?"/g)]
      .flatMap((match) => match[1].split(",").map((name) => name.trim()).filter(Boolean));
    for (const name of imported) {
      assert.equal(
        name, HANDLE_ONLY,
        `${file.name} 이 firestore 에서 ${name} 을 가져온다. 읽기는 ${DATA_FILE} 한 곳이다`,
      );
    }
  }
});

test("목록 질의를 쓰지 않는다", async () => {
  /* 목록을 열면 "내 것만" 을 증명할 필터를 요구하게 되고, 그 필터 한 줄이
     틀리면 남의 문서가 보인다. 회원은 자기 문서 id 를 먼저 알고 그 하나만 연다. */
  for (const file of await memberSources()) {
    const code = codeOf(file.text);
    for (const api of LIST_APIS) {
      assert.equal(code.includes(api), false, `${file.name} 에 ${api} 가 있다`);
    }
  }
});

test("여는 컬렉션은 memberLinks 와 memberViews 뿐이다", async () => {
  /* doc(db, "a", id, "b", id) 의 문자열 인자를 전부 모은다. 어느 파일에 있든
     본다 -- 읽는 자리가 늘어나는 날에도 이 검사는 서야 한다. */
  let total = 0;
  for (const file of await memberSources()) {
    const names = [...codeOf(file.text).matchAll(/doc\(([^)]*)\)/g)]
      .flatMap((match) => [...match[1].matchAll(/"([^"]+)"/g)].map((quoted) => quoted[1]));
    total += names.length;
    for (const name of names) {
      assert.ok(ALLOWED_COLLECTIONS.includes(name), `${file.name}: 허용하지 않은 컬렉션 ${name}`);
    }
  }
  assert.ok(total > 0, "doc() 호출을 찾지 못했다 -- 이 검사가 헛돌고 있다");
});

test("경로 문자열에 금지된 컬렉션이 없다", async () => {
  /* 낱말 하나로 세지 않는다 -- 화면의 탭 이름이 "passes" 다. 슬래시가 든
     경로 문자열만 본다. doc() 인자는 위 검사가 이미 짚는다. */
  for (const file of await memberSources()) {
    const paths = [...codeOf(file.text).matchAll(/"([^"]*\/[^"]*)"/g)].map((match) => match[1]);
    for (const found of paths) {
      for (const name of FORBIDDEN_COLLECTIONS) {
        assert.equal(
          found.split("/").includes(name), false,
          `${file.name} 의 경로 "${found}" 에 ${name} 이 있다`,
        );
      }
    }
  }
});
