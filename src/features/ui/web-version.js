/**
 * 웹의 새 버전 알림 (2026-10-31, 동기화 1단계).
 *
 * ── 왜 ──
 * 센터 PC 는 탭을 며칠씩 열어 둔다. 새 버전을 배포해도 그 탭은 옛 코드로 돈다.
 * 동기화 1단계부터 서버 규칙이 일정 쓰기에 수정 번호를 요구하므로, **옛 탭의 일정
 * 저장은 거절된다.** 그 탭이 거절을 "권한 없음" 으로만 보이면 강사는 무엇을 해야
 * 할지 모른다. 그래서 빌드 번호(dist/version.json)를 주기적으로 견주어, 다르면
 * "새 버전이 나왔어요 [새로고침]" 을 띄운다.
 *
 * ── 이 장치가 못 하는 것 ──
 * **이 코드가 들어가기 전의 탭은 이것을 갖고 있지 않다.** 그 탭에는 이 안내가 뜨지
 * 않는다 -- 이번 배포 직후 센터 PC 탭을 한 번씩 새로고침해야 하는 이유다. 그 뒤로는
 * 새 배포마다 탭이 스스로 안다.
 *
 * 판정만 순수 함수로 둔다. 읽기는 부르는 쪽이 한다.
 */

const text = (value) => String(value ?? "").trim();

export const WEB_VERSION_CHECK_MS = 5 * 60 * 1000;

/**
 * 새 버전이 나왔는가. 내 번호가 없으면(개발 서버 · 네이티브) 묻지 않는다.
 * 서버 번호를 못 읽었으면 아니라고 한다 -- 네트워크가 흔들렸다고 새로고침을 시키지 않는다.
 */
export function isNewerWebBuild(currentBuild, deployedBuild) {
  const current = text(currentBuild);
  const deployed = text(deployedBuild);
  return Boolean(current) && Boolean(deployed) && current !== deployed;
}

/** 일정 쓰기가 거절됐을 때 옛 탭 때문인지. 새 번호가 확인됐을 때만 그렇게 말한다. */
export function staleTabMessage({ errorCode, newerBuildAvailable }) {
  if (newerBuildAvailable && text(errorCode) === "permission-denied") {
    return "이 화면이 옛 버전이라 일정을 저장하지 못했어요. 새로고침해 주세요. (코드 permission-denied)";
  }
  return "";
}

/** 배포된 빌드 번호를 읽는다. 못 읽으면 빈 문자열. */
export async function fetchDeployedWebBuild(fetcher = globalThis.fetch) {
  try {
    const response = await fetcher(`/version.json?t=${Date.now()}`, { cache: "no-store" });
    if (!response?.ok) return "";
    const body = await response.json();
    return text(body?.build);
  } catch {
    return "";
  }
}
