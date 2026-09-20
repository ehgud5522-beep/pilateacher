/**
 * Java 를 찾는다. 이 기기의 Java 는 PATH 에 없고 Android Studio 안에 있다.
 *
 * ── 왜 모듈인가 ──
 * 규칙 테스트(에뮬레이터)와 AAB 빌드(gradle · keytool)가 똑같이 Java 를 찾는다.
 * 같은 경로 목록을 두 곳에 적으면 한쪽만 고쳐지는 날이 온다 -- 그날 남는 메시지는
 * "java 를 찾지 못했습니다" 하나뿐이고, 왜 다른 명령은 되는지 알 수 없다.
 *
 * ── 찾는 순서 ──
 * 1. JAVA_HOME 이 이미 있고 그 안에 실행 파일이 있으면 그것을 쓴다. 사용자가
 *    정해 둔 것을 덮어쓰지 않는다.
 * 2. PATH 의 java. 보통의 개발 기기는 여기서 끝난다.
 * 3. Android Studio 가 들고 다니는 jbr. 이 기기가 여기에 해당한다.
 *
 * 경로를 외우게 하지 않는 것이 목적이다. 못 찾으면 어디를 봤는지 전부 적어서
 * 말한다 -- 코드 없는 "실패했습니다" 를 남기지 않는다 (CLAUDE.md 4항).
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const isWindows = process.platform === "win32";

/** 실행 파일 이름. 윈도우에서만 확장자가 붙는다. */
export const exeName = (name) => (isWindows ? `${name}.exe` : name);

const binIn = (home, name) => path.join(home, "bin", exeName(name));
const looksLikeJdk = (home) => Boolean(home) && existsSync(binIn(home, "java"));

/** Android Studio 가 들고 다니는 JDK 가 놓이는 자리들. */
function bundledCandidates() {
  const local = process.env.LOCALAPPDATA || path.join(homedir(), "AppData", "Local");
  const programFiles = process.env.ProgramFiles || "C:\Program Files";
  if (isWindows) {
    return [
      path.join(programFiles, "Android", "Android Studio", "jbr"),
      path.join(local, "Programs", "Android Studio", "jbr"),
      path.join(programFiles, "Android", "Android Studio Preview", "jbr"),
    ];
  }
  if (process.platform === "darwin") {
    return [
      "/Applications/Android Studio.app/Contents/jbr/Contents/Home",
      path.join(homedir(), "Applications", "Android Studio.app", "Contents", "jbr", "Contents", "Home"),
    ];
  }
  return ["/opt/android-studio/jbr", path.join(homedir(), "android-studio", "jbr")];
}

/** PATH 위의 java 에서 거슬러 올라가 JDK 홈을 찾는다. */
function javaHomeFromPath() {
  const probe = spawnSync(isWindows ? "where" : "which", ["java"], { encoding: "utf8" });
  if (probe.status !== 0) return null;
  const first = String(probe.stdout || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean)[0];
  if (!first) return null;
  // <home>/bin/java -> <home>
  const home = path.dirname(path.dirname(first));
  return looksLikeJdk(home) ? home : null;
}

/**
 * @returns {{ home: string, bin: string, source: string }}
 * @throws 찾지 못하면 본 자리를 전부 적은 오류를 던진다
 */
export function requireJavaHome() {
  const looked = [];

  const declared = process.env.JAVA_HOME;
  if (declared) {
    if (looksLikeJdk(declared)) return { home: declared, bin: path.join(declared, "bin"), source: "JAVA_HOME" };
    looked.push(`JAVA_HOME=${declared} (bin/${exeName("java")} 없음)`);
  } else {
    looked.push("JAVA_HOME (설정되지 않음)");
  }

  const onPath = javaHomeFromPath();
  if (onPath) return { home: onPath, bin: path.join(onPath, "bin"), source: "PATH" };
  looked.push("PATH 의 java (없음)");

  for (const candidate of bundledCandidates()) {
    if (looksLikeJdk(candidate)) return { home: candidate, bin: path.join(candidate, "bin"), source: "Android Studio" };
    looked.push(candidate);
  }

  const error = new Error(
    ["java 를 찾지 못했습니다. 아래를 순서대로 봤습니다:", ...looked.map((line) => `  - ${line}`),
      "",
      "JDK 가 다른 곳에 있으면 JAVA_HOME 을 정해 두고 다시 부르면 됩니다."].join("\n"),
  );
  error.code = "JAVA_HOME_NOT_FOUND";
  throw error;
}

/**
 * 찾은 JDK 를 이 프로세스와 자식 프로세스에 얹는다.
 * 부모 셸은 건드리지 않는다 -- 이 프로세스 한정이다.
 */
export function useJava() {
  const java = requireJavaHome();
  process.env.JAVA_HOME = java.home;
  process.env.PATH = `${java.bin}${path.delimiter}${process.env.PATH ?? ""}`;
  return java;
}

/** JDK 안의 실행 파일 절대 경로. keytool 처럼 PATH 에 없을 것을 직접 부를 때 쓴다. */
export const javaTool = (java, name) => path.join(java.bin, exeName(name));
