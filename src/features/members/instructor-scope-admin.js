/**
 * 대표가 보는 "담당 강사 재계산 · 점검" 화면의 말과 판정.
 *
 * ── 왜 미리보기가 먼저인가 ──
 * 재계산은 되돌리는 문이 없다. 눌렀는데 백 명이 바뀌면 그 백 명이 맞는지
 * 확인할 방법이 그 자리에 없다. 그래서 **먼저 세어 보여 주고**, 대표가 그
 * 숫자를 보고 누른다. 미리보기는 아무것도 쓰지 않는다 (서버의 dryRun).
 *
 * ── 화면이 판정을 만들지 않는다 ──
 * "괜찮은가" 를 여기서 한 번만 정한다. 버튼 옆 문구와 목록의 경고가 서로
 * 다른 기준을 쓰면, 대표는 둘 중 어느 것을 믿어야 할지 알 수 없다.
 */

const count = (value) => (Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0);

/** 점검 결과가 말하는 것. 심각한 순서다. */
export const SCOPE_HEALTH = Object.freeze({
  /** 운영중인데 담당이 빈 회원이 있다. 그 회원은 아무 강사에게도 안 보인다. */
  MISSING: "missing",
  /** 한 명도 채워지지 않았다. 채우기가 아직 안 돌았다는 뜻이다. */
  NOT_FILLED: "not_filled",
  OK: "ok",
});

/**
 * 점검 결과를 한 줄로 읽는다.
 *
 * @param {{ clients?: number, withInstructors?: number, emptyActive?: number }} tally
 */
export function scopeHealth(tally) {
  const clients = count(tally?.clients);
  const withInstructors = count(tally?.withInstructors);
  const emptyActive = count(tally?.emptyActive);
  /* 회원이 있는데 한 명도 안 채워졌으면 "빠진 회원이 많다" 가 아니라 "아직
     안 돌았다" 이다. 대표가 할 일이 다르다 -- 앞은 재계산, 뒤도 재계산이지만
     문구가 같으면 이 둘을 구별할 수 없다. */
  if (clients > 0 && withInstructors === 0) return SCOPE_HEALTH.NOT_FILLED;
  if (emptyActive > 0) return SCOPE_HEALTH.MISSING;
  return SCOPE_HEALTH.OK;
}

/**
 * 점검 결과 문구. 빈 회원이 몇 명인지가 제일 중요한 숫자다.
 */
export function scopeHealthMessage(tally) {
  const health = scopeHealth(tally);
  if (health === SCOPE_HEALTH.NOT_FILLED) {
    return "아직 한 번도 계산되지 않았습니다. 재계산을 먼저 눌러 주세요.";
  }
  if (health === SCOPE_HEALTH.MISSING) {
    /* 이름을 적지 않는다. 대표가 볼 화면이지만 이 문구는 진단에도 남는다. */
    return `운영중인 회원 ${count(tally.emptyActive)}명에게 담당 강사가 없습니다. 재계산을 눌러 주세요.`;
  }
  return "모든 운영중 회원에게 담당 강사가 있습니다.";
}

/**
 * 미리보기 문구. **아무것도 바뀌지 않는 경우를 따로 말한다** -- "0명이
 * 바뀝니다" 를 보고 누르면 아무 일도 안 일어나고, 대표는 실패로 읽는다.
 *
 * @param {{ scanned?: number, wouldUpdate?: number, failed?: number }} preview
 */
export function rebuildPreviewMessage(preview) {
  const scanned = count(preview?.scanned);
  const wouldUpdate = count(preview?.wouldUpdate);
  const failed = count(preview?.failed);
  if (failed > 0) {
    return `회원 ${scanned}명 중 ${failed}명을 읽지 못했습니다. 다시 시도해 주세요.`;
  }
  if (wouldUpdate === 0) return `회원 ${scanned}명 모두 이미 맞습니다. 바뀌는 것이 없습니다.`;
  return `회원 ${scanned}명 중 ${wouldUpdate}명의 담당 강사가 바뀝니다.`;
}

/** 실행이 끝난 뒤. 센 것과 쓴 것을 함께 말한다. */
export function rebuildDoneMessage(result) {
  const updated = count(result?.updated);
  const failed = count(result?.failed);
  if (failed > 0) return `${updated}명을 고쳤고 ${failed}명은 실패했습니다.`;
  if (updated === 0) return "바뀐 회원이 없습니다.";
  return `${updated}명의 담당 강사를 다시 계산했습니다.`;
}

/**
 * 강사별 담당 회원 수에 이름을 붙인다. 이름을 모르면 uid 를 짧게 보여준다 --
 * 빈칸으로 두면 어느 줄이 누구인지 알 수 없다.
 *
 * @param {Array<{ instructorId: string, clients: number }>} rows
 * @param {Array<any>} instructors
 */
export function instructorScopeRows(rows, instructors = []) {
  const nameById = new Map((Array.isArray(instructors) ? instructors : [])
    .filter(Boolean)
    .map((item) => [
      String(item.userId || item.id || ""),
      String(item.displayName || item.name || ""),
    ]));
  return (Array.isArray(rows) ? rows : []).filter(Boolean).map((row) => {
    const instructorId = String(row.instructorId || "");
    const name = nameById.get(instructorId) || "";
    return {
      instructorId,
      name: name || `알 수 없음 (${instructorId.slice(0, 6)}…)`,
      clients: count(row.clients),
      known: Boolean(name),
    };
  });
}
