/**
 * 지금 쓰고 있는 강사 이름을 **대표가 정한 것으로 확정한다.** 한 번 쓰는 통로다.
 *
 * ── 왜 필요한가 ──
 * 2026-10-10 까지 강사 앱은 열릴 때마다 로그인 계정 이름을 소속 문서에 덮어
 * 썼다. 그래서 대표가 고친 이름이 매번 되돌아갔고, 급여 집계도 그 이름으로
 * 섰다 ("e asy").
 *
 * 고친 뒤로는 displayNameBy 가 "대표가 정했다" 를 말하고, 그 표시가 있으면
 * 아무도 덮지 못한다 (firestore.foundation.rules 의 nameSetByOwner). 그런데
 * **이미 있는 소속에는 그 표시가 없다.** 표시가 붙는 길은 둘뿐이다: 대표가
 * 이름을 다시 저장하거나, 새로 붙이거나.
 *
 * 강사가 열 명이면 대표가 열 번 들어가 저장해야 한다는 뜻이다. 그 열 번 중
 * 한 번을 빠뜨리면 그 사람만 계속 되돌아가고, 왜 그 사람만인지는 아무도 모른다.
 * 그래서 한 번에 찍는 통로를 둔다.
 *
 * ── 이름을 바꾸지 않는다 ──
 * **지금 적혀 있는 이름을 그대로 확정한다.** 고르거나 추측하지 않는다 --
 * 되돌아간 상태로 굳은 이름("e asy")이 있다면 그것을 확정해 버리는 셈이지만,
 * 그 판단은 대표의 것이다. 미리보기가 이름을 그대로 보여주고, 아니면 강사
 * 관리에서 고친 뒤 다시 부른다.
 *
 * ── 재직 중인 사람만 ──
 * 퇴사한 소속은 건드리지 않는다. 그 사람은 앱을 열지 않으므로 되돌아갈 일이
 * 없고, 지난 급여에 붙은 이름을 지금 와서 확정할 이유도 없다.
 */

const text = (value) => String(value ?? "").trim();

/** 대표가 정했다고 적는 값. 규칙과 앱이 같은 글자를 본다. */
export const DISPLAY_NAME_BY_OWNER = "owner";

/** 왜 건너뛰는가. 건수만으로는 "왜 열 명 중 셋만 찍혔나" 에 답할 수 없다. */
export const NAME_SKIP = Object.freeze({
  /** 이미 대표가 정한 것으로 표시돼 있다. 두 번 찍을 것이 없다. */
  ALREADY: "already",
  /** 이름이 비어 있다. 찍어도 목록은 uid 로 서고, 로그인 동기화가 채울 길만 막힌다. */
  NO_NAME: "no_name",
  /** 재직 중이 아니다. 앱을 열지 않으므로 되돌아갈 일이 없다. */
  NOT_ACTIVE: "not_active",
});

/**
 * 무엇을 찍을 것인가. **읽기만 한다.**
 *
 * 미리보기와 실행이 같은 함수를 지난다 -- 둘이 갈라지면 대표가 본 목록과
 * 찍히는 목록이 달라지고, 이 작업은 되돌리는 문이 없다.
 *
 * @param {Array<any>} memberships 그 센터의 소속 문서 전부
 * @returns {{
 *   targets: Array<{ userId: string, displayName: string }>,
 *   skipped: Array<{ userId: string, displayName: string, reason: string }>,
 * }}
 */
export function planNameConfirmation(memberships) {
  const targets = [];
  const skipped = [];

  for (const membership of Array.isArray(memberships) ? memberships : []) {
    if (!membership) continue;
    const userId = text(membership.userId);
    if (!userId) continue;
    const displayName = text(membership.displayName);

    if (text(membership.status) !== "active") {
      skipped.push({ userId, displayName, reason: NAME_SKIP.NOT_ACTIVE });
      continue;
    }
    if (text(membership.displayNameBy) === DISPLAY_NAME_BY_OWNER) {
      skipped.push({ userId, displayName, reason: NAME_SKIP.ALREADY });
      continue;
    }
    /* 빈 이름을 확정하면 목록은 uid 로 선 채로 굳는다 -- 로그인 동기화가
       채울 길만 막고 얻는 것이 없다. 그 사람은 강사 관리에서 이름을 넣는다. */
    if (!displayName) {
      skipped.push({ userId, displayName: "", reason: NAME_SKIP.NO_NAME });
      continue;
    }
    targets.push({ userId, displayName });
  }

  return { targets, skipped };
}

/** 소속 문서에 더할 것. 이름은 건드리지 않는다 -- 표시 하나만 얹는다. */
export const nameConfirmationPatch = () => ({ displayNameBy: DISPLAY_NAME_BY_OWNER });
