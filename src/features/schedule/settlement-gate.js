/**
 * 옛 빌드가 옛 차감 규칙으로 확정하는 것을 막는다.
 *
 * ── 왜 필요한가 ──
 * 차감 계산은 전부 기기에서 돈다 (planPassSelection). 서버가 하는 일은
 * 규칙으로 쓰기를 받아 주는 것뿐이고, 규칙은 "어느 회원권에서 빼야 했는가"를
 * 모른다. 그래서 업데이트하지 않은 폰은 **옛 규칙으로 계산한 차감을 계속
 * 원장에 박을 수 있다.** 원장은 append-only 라 그것을 되돌리는 것은 대표뿐이다.
 *
 * 2026-10-01 에 기준이 "출석 인원" 에서 "수업 종류" 로 바뀌었다. 같은 듀엣
 * 수업을 새 빌드는 2:1 에서, 옛 빌드는 1:1 에서 뺀다 -- 어느 폰으로 눌렀는지에
 * 따라 회원의 잔여와 강사의 급여가 갈린다.
 *
 * ── 이 파일이 하는 것과 못 하는 것 ──
 * 여기는 **화면을 막는 자리**다. 옛 빌드는 이 코드를 아예 갖고 있지 않으므로
 * 이것만으로는 옛 빌드를 막지 못한다. 진짜로 막는 것은 규칙이고, 그것은 모든
 * 강사가 새 빌드를 받은 뒤에 켤 수 있다 (docs 참고). 이 파일은 그 전환을
 * 준비하는 쪽이다 -- 다음에 규칙이 또 바뀔 때는 이 장치가 미리 서 있다.
 *
 * ── 열어 두고 실패한다 ──
 * 설정 문서를 못 읽거나 빌드 번호를 못 읽으면 **막지 않는다.** 네트워크가
 * 흔들렸다고 센터 전체가 확정을 못 하게 되는 쪽이, 한 번 더 옛 규칙으로
 * 차감되는 쪽보다 나쁘다. 진짜 차단은 규칙이 한다.
 */

/** 확정을 막을 것인가. 코드 없는 "할 수 없습니다" 를 남기지 않는다. */
export const SETTLEMENT_GATE = Object.freeze({
  /** 확정해도 된다. 설정이 없거나 읽히지 않는 경우도 여기다 -- 열어 두고 실패한다. */
  ALLOWED: "allowed",
  /** 이 빌드가 센터가 정한 최소보다 낮다. */
  OUTDATED: "outdated",
});

/** 화면 문구. 무엇을 해야 하는지까지 말한다. */
export const SETTLEMENT_GATE_LABEL = Object.freeze({
  [SETTLEMENT_GATE.OUTDATED]: "앱을 업데이트해 주세요. 이 버전은 회원권 차감 기준이 달라 확정할 수 없습니다.",
});

const text = (value) => String(value ?? "").trim();

/**
 * 빌드 번호를 숫자로. 못 읽으면 null 이다 -- 0 으로 바꾸지 않는다.
 *
 * 0 으로 바꾸면 "읽지 못했다" 가 "아주 낮은 빌드" 가 되어, 번호를 못 읽는
 * 기기가 전부 차단된다. 모르는 것은 모르는 것으로 둔다.
 *
 * @param {unknown} value
 * @returns {number | null}
 */
export function buildNumberOf(value) {
  const raw = text(value);
  if (!raw) return null;
  /* "1.1.30 (64)" 같은 라벨이 들어오는 자리가 아니다. 번호만 받는다 --
     라벨을 여기서 쪼개면 형식이 바뀌는 날 조용히 다른 숫자를 읽는다. */
  if (!/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * 플랫폼마다 번호 체계가 다르다. **하나로 비교하지 않는다.**
 *
 * 안드로이드 versionCode 와 iOS 의 CFBundleVersion 은 서로 다른 수열이고,
 * 웹은 빌드마다 올라가는 또 다른 번호다. 최소값을 하나로 두면 한 플랫폼을
 * 막으려다 다른 플랫폼을 통째로 막거나, 막아야 할 쪽을 놓친다.
 *
 * @param {unknown} config runtimeConfig/settlement 문서
 * @param {string} platform "web" | "android" | "ios"
 * @returns {number | null}
 */
export function minBuildFor(config, platform) {
  const key = text(platform).toLowerCase();
  if (!key || !config || typeof config !== "object") return null;
  const table = config.minBuilds;
  if (!table || typeof table !== "object") return null;
  return buildNumberOf(table[key]);
}

/**
 * 이 기기가 지금 확정해도 되는가.
 *
 * @param {{ platform?: string, build?: unknown, config?: unknown }} input
 * @returns {{ state: string, minBuild?: number, build?: number }}
 */
export function settlementGate(input = {}) {
  const minBuild = minBuildFor(input.config, input.platform);
  // 센터가 최소를 정하지 않았다. 막을 근거가 없다.
  if (minBuild === null) return { state: SETTLEMENT_GATE.ALLOWED };

  const build = buildNumberOf(input.build);
  // 번호를 못 읽었다. 모르는 것으로 막지 않는다 -- 위 머리말 참고.
  if (build === null) return { state: SETTLEMENT_GATE.ALLOWED };

  if (build >= minBuild) return { state: SETTLEMENT_GATE.ALLOWED };
  return { state: SETTLEMENT_GATE.OUTDATED, minBuild, build };
}

/** 확정 버튼을 잠글 것인가. 화면이 이 하나만 물어보면 되게 한다. */
export const blocksSettlement = (gate) => gate?.state === SETTLEMENT_GATE.OUTDATED;
