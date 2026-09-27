/**
 * 강사 기기가 지금 몇 번 빌드인가.
 *
 * ── 왜 필요한가 ──
 * 규칙으로 회원 범위를 좁히는 순간, **낡은 앱은 통째로 멈춘다** -- 조건 없는
 * 목록 읽기를 규칙이 거부하기 때문이다. 그러니 "강사 전원이 새 앱을 쓰고
 * 있는가" 를 알기 전에는 그 규칙을 누를 수 없다.
 *
 * 지금은 그것을 알 방법이 없다. 대표는 감으로 누르거나, 누르고 나서 강사들의
 * 전화를 받는다. 이 파일이 그 사이에 선다.
 *
 * ── 무엇을 남기는가 ──
 * `memberships/{org}_{uid}` 에 세 칸만 쓴다. 역할도 지점도 급여도 여기서
 * 움직이지 않고, 규칙이 그 셋 말고는 거부한다.
 *
 *   appVersion   "1.1.29"
 *   appBuild     "62"
 *   lastSeenAt   마지막으로 앱을 연 시각 (서버 시계)
 *
 * 기기 식별자도 OS 버전도 남기지 않는다. 여기서 답해야 하는 질문은 "이 사람이
 * 새 앱을 쓰는가" 하나뿐이고, 나머지는 그 질문에 필요하지 않다.
 */

const text = (value) => String(value ?? "").trim();

/** 이 간격보다 오래됐으면 다시 쓴다. */
export const SEEN_REFRESH_HOURS = 12;

const HOUR_MS = 60 * 60 * 1000;

const timeOf = (value) => {
  if (value === undefined || value === null || value === "") return NaN;
  if (value instanceof Date) return value.getTime();
  if (typeof value.toDate === "function") {
    try { return value.toDate().getTime(); } catch (_error) { return NaN; }
  }
  if (typeof value === "number") return value;
  return new Date(String(value)).getTime();
};

/**
 * 지금 써야 하는가.
 *
 * **앱을 열 때마다 쓰지 않는다.** 쓰기 하나가 memberships 를 건드리고, 강사
 * 여섯이 하루에 열 번씩 열면 그것이 그대로 비용이 된다. 버전이 바뀌었거나
 * 반나절이 지났을 때만 쓴다.
 *
 * @param {{ current: {version: string, build: string},
 *   stored: {appVersion?: string, appBuild?: string, lastSeenAt?: any},
 *   now?: Date, refreshHours?: number }} input
 */
export function shouldReportVersion(input = {}) {
  const version = text(input.current?.version);
  const build = text(input.current?.build);
  /* 버전을 모르면 쓰지 않는다. 빈 값을 남기면 대표 화면에 "알 수 없음" 이
     뜨는데, 그것은 앱을 안 연 사람과 구별되지 않는다. */
  if (!version || !build) return false;

  const stored = input.stored || {};
  if (text(stored.appVersion) !== version) return true;
  if (text(stored.appBuild) !== build) return true;

  const now = input.now instanceof Date ? input.now : new Date();
  const refreshHours = Number.isFinite(input.refreshHours) ? input.refreshHours : SEEN_REFRESH_HOURS;
  const seen = timeOf(stored.lastSeenAt);
  /* 시각을 못 읽으면 쓴다. 못 읽는 값 때문에 영영 안 쓰는 것보다 한 번 더
     쓰는 편이 낫다. */
  if (!Number.isFinite(seen)) return true;
  return now.getTime() - seen >= refreshHours * HOUR_MS;
}

/** 빌드 번호 비교. 숫자가 아니면 비교하지 않는다 (아래 판정이 "모름" 으로 간다). */
const buildNumber = (value) => {
  const found = Number.parseInt(text(value), 10);
  return Number.isInteger(found) && found >= 0 ? found : null;
};

/** 강사 한 줄이 어느 상태인가. 심각한 순서다. */
export const VERSION_STATE = Object.freeze({
  /** 앱을 한 번도 안 열었거나 기록이 없다. */
  UNKNOWN: "unknown",
  /** 기준보다 낮다. 규칙을 켜면 이 사람의 앱이 멈춘다. */
  OUTDATED: "outdated",
  READY: "ready",
});

/**
 * 강사별 앱 버전 줄.
 *
 * @param {Array<any>} instructors `listInstructors` 가 돌려준 것
 * @param {{ minimumBuild: number|string }} options
 */
export function instructorVersionRows(instructors, options = {}) {
  const minimum = buildNumber(options.minimumBuild);
  return (Array.isArray(instructors) ? instructors : [])
    .filter(Boolean)
    .map((item) => {
      const build = buildNumber(item.appBuild);
      const name = text(item.displayName) || text(item.name);
      const userId = text(item.userId);
      let state = VERSION_STATE.UNKNOWN;
      if (build !== null && minimum !== null) {
        state = build >= minimum ? VERSION_STATE.READY : VERSION_STATE.OUTDATED;
      }
      return {
        userId,
        name: name || `알 수 없음 (${userId.slice(0, 6)}…)`,
        version: text(item.appVersion),
        build: text(item.appBuild),
        lastSeenAt: Number.isFinite(timeOf(item.lastSeenAt)) ? new Date(timeOf(item.lastSeenAt)) : null,
        state,
      };
    })
    .sort((left, right) => {
      /* 문제가 있는 줄이 위로. 대표가 보는 순간 할 일이 먼저 보인다. */
      const rank = (row) => (row.state === VERSION_STATE.OUTDATED ? 0
        : row.state === VERSION_STATE.UNKNOWN ? 1 : 2);
      return rank(left) - rank(right) || left.name.localeCompare(right.name, "ko");
    });
}

/**
 * 지금 규칙을 켜도 되는가.
 *
 * **모르는 사람이 한 명이라도 있으면 안 된다.** "아직 안 열었다" 와 "낡았다"
 * 는 규칙 앞에서 같은 결과를 낸다 -- 그 사람의 앱이 멈춘다.
 *
 * @param {Array<ReturnType<typeof instructorVersionRows>[number]>} rows
 */
export function rulesReadiness(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const outdated = list.filter((row) => row.state === VERSION_STATE.OUTDATED).length;
  const unknown = list.filter((row) => row.state === VERSION_STATE.UNKNOWN).length;
  const ready = list.filter((row) => row.state === VERSION_STATE.READY).length;
  return { total: list.length, ready, outdated, unknown, safe: list.length > 0 && outdated === 0 && unknown === 0 };
}

/** 대표에게 한 줄로 말한다. */
export function readinessMessage(readiness, minimumBuild) {
  const target = text(minimumBuild) || "?";
  if (!readiness?.total) return "강사가 없습니다.";
  if (readiness.safe) return `강사 ${readiness.total}명 모두 ${target} 이상입니다. 규칙을 켜도 됩니다.`;
  const parts = [];
  if (readiness.outdated) parts.push(`낡은 앱 ${readiness.outdated}명`);
  if (readiness.unknown) parts.push(`확인 안 됨 ${readiness.unknown}명`);
  /* "확인 안 됨" 을 안전한 쪽으로 세지 않는다. 규칙 앞에서는 낡은 앱과 같은
     결과가 나온다 -- 그 사람의 화면이 멈춘다. */
  return `${parts.join(" · ")}. 이 강사들이 ${target} 이상으로 업데이트한 뒤에 규칙을 켭니다.`;
}
