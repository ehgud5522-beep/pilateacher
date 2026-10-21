/**
 * firebase-admin 을 들여오고 Firestore 손잡이를 연다.
 *
 * ── 왜 한 곳에 모으는가 ──
 * **설치된 곳이 `functions/` 뿐이다.** 루트에서 `import("firebase-admin/app")`
 * 을 하면 ERR_MODULE_NOT_FOUND 로 떨어진다 -- 도구는 `tools/` 에 있고 거기에는
 * node_modules 가 없다. 각 도구가 저마다 경로를 짜 맞추면 하나를 고칠 때 넷을
 * 고쳐야 하고, 하나를 빠뜨리면 그 도구만 조용히 안 돈다.
 *
 * 자격은 환경이 준다 (GOOGLE_APPLICATION_CREDENTIALS 또는 ADC). 키를 코드에
 * 두지 않는다.
 */

import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const NEWLINE = String.fromCharCode(10);

const here = dirname(fileURLToPath(import.meta.url));
const functionsPackage = resolve(here, "..", "..", "functions", "package.json");

/**
 * `functions/` 의 node_modules 에서 들여온다.
 *
 * @param {string} specifier "firebase-admin/app" 같은 것
 * @returns {Promise<any>}
 */
async function fromFunctions(specifier) {
  try {
    const require = createRequire(functionsPackage);
    return await import(pathToFileURL(require.resolve(specifier)).href);
  } catch (error) {
    /* 왜 못 찾았는지 **어디를 봤는지와 함께** 말한다. "모듈 없음" 만 남기면
       설치를 안 한 것인지 경로가 틀린 것인지 알 수 없다. */
    const notFound = error?.code === "MODULE_NOT_FOUND" || error?.code === "ERR_MODULE_NOT_FOUND";
    const reason = notFound
      ? "functions/ 에 설치되어 있지 않습니다. 'npm --prefix functions install' 을 먼저 돌리세요."
      : String(error?.message || error);
    throw new Error([
      `${specifier} 를 들여오지 못했습니다.`,
      `  찾은 곳: ${functionsPackage}`,
      `  이유: ${reason}`,
    ].join(NEWLINE));
  }
}

/**
 * Firestore 손잡이. **자격이 없으면 첫 줄에서 멈춘다.**
 *
 * @param {{ key?: string }} [options] key 는 서비스 계정 키 파일 경로
 * @returns {Promise<any>}
 */
export async function openFirestore(options = {}) {
  const { cert, getApps, initializeApp } = await fromFunctions("firebase-admin/app");
  const { getFirestore } = await fromFunctions("firebase-admin/firestore");
  if (!getApps().length) {
    initializeApp(options.key ? { credential: cert(options.key) } : undefined);
  }
  const firestore = getFirestore();

  /* **자격은 여기서 확인한다.** initializeApp 은 자격이 없어도 조용히 지나가고,
     첫 질의에서야 "Unable to detect a Project Id" 가 스택 20줄과 함께 터진다 --
     그때는 이미 머리말이 찍혀 있어 무언가 읽은 줄 안다. */
  try {
    await firestore.listCollections();
  } catch (error) {
    throw new Error([
      "Firestore 에 닿지 못했습니다. 자격이 없거나 프로젝트를 찾지 못했습니다.",
      "셋 중 하나가 필요합니다:",
      "  1. GOOGLE_APPLICATION_CREDENTIALS=<서비스 계정 키 경로>",
      "  2. gcloud auth application-default login",
      "  3. --key <서비스 계정 키 경로>",
      "firebase login 은 쓰이지 않습니다 -- Admin SDK 가 읽는 자격이 아닙니다.",
      "프로젝트가 안 잡히면 GOOGLE_CLOUD_PROJECT=pilateacher 도 함께 주세요.",
      `원본: ${String(error?.message || error).split(NEWLINE)[0]}`,
    ].join(NEWLINE));
  }
  return firestore;
}
