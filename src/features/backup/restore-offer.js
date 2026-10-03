/**
 * "이 계정의 기록을 불러올까요?" 를 **누구에게 띄우는가.**
 *
 * ── 왜 생겼는가 ──
 * 2026-10-04, 센터 소속 강사가 새 폰에서 1.1.31 을 열자 이 창이 떴다. 센터
 * 이전에 개인으로 쓰던 9/3 백업이었다. 띄운 조건에 **소속이 없었기 때문**이다:
 *
 *   클라우드에 기록이 있다 && 이 기기에 없다 && 아직 안 골랐다
 *
 * 센터 소속 강사의 기기가 비어 있는 것은 사고가 아니라 정상이다. 회원도
 * 회원권도 원장도 서버에 있고, 기기 `db.members` 는 그 회원을 건드릴 때에야
 * 한 줄씩 생긴다. 그래서 **새 폰이면 반드시 이 창이 뜬다.**
 *
 * ── 왜 "그냥 숨기기" 가 아닌가 ──
 * 물어볼 것이 남아 있는 동안 자동 백업이 통째로 멈춘다 (App 의
 * restoreBlockedRef). 창만 안 띄우면 그 강사는 백업되는 줄 알고 쓰는데 실제로는
 * 아무것도 안 올라간다. **묻지 않는 것과 멈추지 않는 것은 함께 가야 한다** --
 * 그래서 이 파일이 둘을 따로 돌려준다.
 *
 * ── 왜 "모르면 묻지 않는다" 인가 ──
 * 소속 조회는 계정을 읽은 **뒤에** 끝난다. 그 사이에 물어보면 센터 소속인지
 * 모르는 채로 묻는 것이고, 그것이 지금 난 일이다. 그래서 확실히 개인 모드일
 * 때만 묻는다. 조회가 실패한 상태(status "unknown")에서도 묻지 않는다 --
 * 틀리게 묻는 쪽이 안 묻는 쪽보다 나쁘다. 옛 기록은 지워지지 않고 메뉴에
 * 그대로 남아 있어서, 안 물어서 잃는 것은 없다.
 */

/** 이 계정에 무엇을 할 것인가. */
export const RESTORE_OFFER = Object.freeze({
  /** 소속을 아직 모른다. 묻지도 백업하지도 않는다 -- 길어야 조회 한 번이다. */
  WAIT: "wait",
  /** 개인 모드가 확실하다. 지금까지처럼 묻는다. */
  SHOW: "show",
  /** 물을 것이 없다. 조용히 자동 백업만 돈다. */
  SKIP: "skip",
});

/**
 * 센터에 속한 계정인가. **확실할 때만 참이다.**
 *
 * `ready` 가 아니면 아직 모르는 것이고, `status === "unknown"` 은 조회가
 * 실패한 것이다 (App 의 loadOrganizationContext). 둘 다 "센터가 아니다" 가
 * 아니라 "모른다" 이므로 여기서 참을 돌려주지 않는다.
 */
export function isCentreAccount(organization) {
  return Boolean(organization?.ready)
    && organization.isLegacy !== true
    && organization.status !== "unknown"
    && Boolean(String(organization.organizationId || "").trim());
}

/**
 * 창을 띄울 것인가.
 *
 * @param {{
 *   organization?: any,
 *   hasCloudData?: boolean, hasLocalData?: boolean, decisionMade?: boolean,
 * }} input
 * @returns {string} RESTORE_OFFER 중 하나
 */
export function restoreOfferDecision(input = {}) {
  /* 물을 것이 없는 경우부터 걷어낸다. 소속을 기다릴 이유도 없다. */
  if (!input.hasCloudData) return RESTORE_OFFER.SKIP;
  if (input.hasLocalData) return RESTORE_OFFER.SKIP;
  if (input.decisionMade) return RESTORE_OFFER.SKIP;

  const organization = input.organization;
  if (!organization?.ready) return RESTORE_OFFER.WAIT;
  /* 개인 모드가 확실할 때만 묻는다. 센터 소속도, 조회 실패도 묻지 않는다. */
  return organization.isLegacy === true ? RESTORE_OFFER.SHOW : RESTORE_OFFER.SKIP;
}

/**
 * 자동 백업을 멈춰야 하는가. **"묻지 않는다" 와 같은 뜻이 아니다.**
 *
 * 묻는 중이면 멈춘다 -- 사용자가 고르기도 전에 올리면 옛 기록 위에 새 기기의
 * 빈 내용을 덮는다. WAIT 도 멈추지만 소속 조회 한 번이면 끝나고, 실패해도
 * `unknown` 으로 끝나 SKIP 이 되므로 멈춘 채로 남지 않는다.
 *
 * **센터 소속이면 묻지 않고 멈추지도 않는다.** 이 백업 말고 사본이 없는 것이
 * 있다: 수업기록 원문, 사진 구성, 설정. 창만 숨기고 백업을 멈춰 두면 그
 * 강사는 백업되는 줄 알고 쓰는데 아무것도 안 올라간다.
 *
 * **개인 모드에서 "새로 시작" 을 고른 기기는 계속 멈춘다.** 올리면 16명짜리
 * 기록 위에 빈 기기를 덮는다. 덮어쓰기 보호가 막을 것이고 막히면 창이 다시
 * 뜨므로, 애초에 올리지 않는다. 거기서는 기기가 원본이라 이 판단이 맞다.
 *
 * @param {{
 *   decision?: string, organization?: any,
 *   hasCloudData?: boolean, hasLocalData?: boolean,
 * }} input
 */
export function backupPaused(input = {}) {
  if (input.decision === RESTORE_OFFER.SHOW || input.decision === RESTORE_OFFER.WAIT) return true;
  if (isCentreAccount(input.organization)) return false;
  return Boolean(input.hasCloudData) && !input.hasLocalData;
}

/**
 * 덮어쓰기 보호에 걸렸을 때 **밀어붙여도 되는가.**
 *
 * 보호 장치는 "기기 회원이 갑자기 줄었다" 를 사고로 본다
 * (cloud-backup.js 의 members_mass_decrease). 개인 모드에서는 맞는 판단이다 --
 * 기기가 원본이라 줄어든 것은 잃은 것이다.
 *
 * **센터 소속에서는 신호가 아니다.** 명부 원본이 서버에 있고 기기 쪽은 건드린
 * 회원만 한 줄씩 생기므로, 새 폰에서 적은 것이 정상이다. 여기서 막으면 백업이
 * 영영 안 되고, 같은 창이 다시 뜬다.
 *
 * 다만 밀어붙이기 전에 옛 백업을 따로 보관해야 한다 -- 그것이 "이전 폰 기록
 * 불러오기" 가 읽을 유일한 자리다. 보관을 부르는 쪽은 App 이고, 이 함수는
 * 판단만 한다.
 */
export function canOverwriteBackup(organization) {
  return isCentreAccount(organization);
}

/**
 * 불러오기 전에 보여 줄 전/후.
 *
 * 메뉴에서 부르는 "이전 폰 기록 불러오기" 는 사용자가 **찾아온** 길이라 묻지
 * 않고 바로 덮으면 안 된다. 기기에 이미 쓰던 내용이 있을 수 있고, 불러오기는
 * 병합이 아니라 통째 교체다.
 *
 * @param {{ local?: any, cloud?: any, photoCount?: number }} input
 */
export function restorePreview(input = {}) {
  const countOf = (data, key) => (Array.isArray(data?.[key]) ? data[key].length : 0);
  const local = input.local || {};
  const cloud = input.cloud || {};
  return {
    members: { before: countOf(local, "members"), after: countOf(cloud, "members") },
    sessions: { before: countOf(local, "schedule"), after: countOf(cloud, "schedule") },
    notes: {
      before: noteCount(local),
      after: noteCount(cloud),
    },
    photos: { before: null, after: Math.max(0, Number(input.photoCount) || 0) },
  };
}

/** 수업기록 원문의 수. 이 백업이 지키는 것 중 서버에 사본이 없는 것이다. */
function noteCount(data) {
  if (!Array.isArray(data?.members)) return 0;
  return data.members.reduce(
    (total, member) => total + (Array.isArray(member?.notes) ? member.notes.length : 0),
    0,
  );
}
