/**
 * 기기 명부 청소 — 담당이 아닌 회원을 이 기기에서 지운다.
 *
 * ── 지우는 것이 생각보다 적다 ──
 * `db.members` 는 센터 회원 전체의 사본이 아니다. **강사가 무언가 쓸 때만**
 * 행이 생긴다. 회원 탭의 "전체 106명" 은 화면을 만들 때 계산한 값이고 어디에도
 * 저장되지 않는다 -- 조회를 좁히는 순간 그 106 은 저절로 사라진다.
 *
 * 그러니 여기서 지우는 것은 "강사가 만진 남의 회원" 뿐이다.
 *
 * ── 지우면 안 되는 것 ──
 * 1. **센터와 연결되지 않은 로컬 회원.** 그 회원은 이 기기에만 있고, 지우면
 *    센터 어디에도 남지 않는다.
 * 2. **기록이 센터에 다 올라가지 않은 회원.** 특히 **사진**이 위험하다 --
 *    사진은 기기의 별도 저장소에 있고 클라우드 사진 백업은 선택 기능이다.
 *    켜지 않은 강사의 회원을 지우면 그 사진은 어디에도 없다.
 *
 * 검사에 걸린 회원은 지우지 않고 **숨긴다**. 이미 있는 비파괴 수단이고
 * (`hiddenClientIds`), 목록은 짧아지고 데이터는 그대로 남으며 되돌릴 수 있다.
 *
 * 설계 전체는 docs/instructor-scope-plan.md 의 "A. 기기 명부 청소와 백업".
 */

import { ROSTER_SOURCE } from "../roster/roster-bridge.js";

const text = (value) => String(value ?? "").trim();

/** 한 회원을 어떻게 할 것인가. */
export const PRUNE_ACTION = Object.freeze({
  /** 기기에서 지운다. 센터에 그대로 있고 기록도 올라가 있다. */
  REMOVE: "remove",
  /** 지우지 않고 화면에서만 감춘다. 되돌릴 수 있다. */
  HIDE: "hide",
  /** 그대로 둔다. */
  KEEP: "keep",
});

/**
 * 이 회원을 어떻게 할 것인가.
 *
 * @param {any} member 병합된 명부의 한 줄
 * @param {{ myClientIds: Set<string>|Array<string>, isBackedUp?: (clientId: string) => boolean }} scope
 *   myClientIds 지금 내 담당으로 내려온 조직 회원
 *   isBackedUp  이 회원의 기록과 사진이 센터에 다 올라갔는가. **주지 않으면
 *               아무것도 지우지 않는다** -- 모르면 지우지 않는 쪽이 맞다.
 */
export function pruneDecision(member, scope = {}) {
  const mine = scope.myClientIds instanceof Set ? scope.myClientIds : new Set(scope.myClientIds || []);
  const isBackedUp = typeof scope.isBackedUp === "function" ? scope.isBackedUp : () => false;

  /* 센터와 연결되지 않은 회원은 건드리지 않는다. 이 기기에만 있는 사람이고,
     지우면 센터 어디에도 남지 않는다. */
  if (member?.rosterSource === ROSTER_SOURCE.LOCAL_ONLY) return PRUNE_ACTION.KEEP;

  const clientId = text(member?.orgClientId);
  if (!clientId) return PRUNE_ACTION.KEEP;
  /* 내 담당이면 지울 이유가 없다. */
  if (mine.has(clientId)) return PRUNE_ACTION.KEEP;

  /* 여기까지 왔으면 "센터에 있지만 내 담당이 아닌 회원" 이다.
     기록이 다 올라가 있어야 지운다 -- 아니면 숨기기만 한다. */
  return isBackedUp(clientId) ? PRUNE_ACTION.REMOVE : PRUNE_ACTION.HIDE;
}

/**
 * 청소 계획. **아무것도 바꾸지 않는다** -- 무엇을 할지만 정한다.
 *
 * @param {Array<any>} roster 병합된 명부
 * @param {{ myClientIds?: any, isBackedUp?: (clientId: string) => boolean }} scope
 * @returns {{ remove: Array<any>, hide: Array<string>, keep: number, unlinked: number }}
 *   remove 기기에서 지울 회원 (레거시 id 로 지운다)
 *   hide   숨길 조직 clientId
 */
export function planRosterPrune(roster, scope = {}) {
  const plan = { remove: [], hide: [], keep: 0, unlinked: 0 };
  for (const member of (Array.isArray(roster) ? roster : []).filter(Boolean)) {
    const action = pruneDecision(member, scope);
    if (action === PRUNE_ACTION.REMOVE) plan.remove.push(member);
    else if (action === PRUNE_ACTION.HIDE) plan.hide.push(text(member.orgClientId));
    else {
      plan.keep += 1;
      if (member.rosterSource === ROSTER_SOURCE.LOCAL_ONLY) plan.unlinked += 1;
    }
  }
  return plan;
}

/**
 * 이 회원의 기록이 센터에 다 올라갔는가.
 *
 * **사진이 제일 위험하다.** 수업 기록은 회원 객체 안에 있고 목표·인바디는
 * 센터에 쌓이지만, 사진은 기기의 별도 저장소에 있고 클라우드 사진 백업은
 * 선택이다. 켜지 않았으면 그 사진은 이 기기에만 있다.
 *
 * @param {any} member
 * @param {{ photoIdsFor: (member: any) => Array<string>, backedUpPhotoIds: Set<string>|Array<string>,
 *   photoBackupEnabled: boolean }} input
 */
export function recordsAreSafe(member, input = {}) {
  /* 사진 백업이 꺼져 있으면 사진이 하나라도 있는 회원은 안전하지 않다.
     올라갈 길이 아예 없기 때문이다. */
  const photoIds = typeof input.photoIdsFor === "function" ? input.photoIdsFor(member) || [] : [];
  if (photoIds.length === 0) return true;
  if (!input.photoBackupEnabled) return false;

  const backedUp = input.backedUpPhotoIds instanceof Set
    ? input.backedUpPhotoIds
    : new Set(input.backedUpPhotoIds || []);
  return photoIds.every((id) => backedUp.has(text(id)));
}

/** 청소 결과를 강사에게 한 번 말한다. */
export function pruneMessage(plan) {
  const removed = plan?.remove?.length || 0;
  const hidden = plan?.hide?.length || 0;
  if (!removed && !hidden) return "";
  const parts = [];
  if (removed) parts.push(`담당이 아닌 회원 ${removed}명을 이 기기에서 정리했어요`);
  /* 숨긴 것을 "정리했다" 에 섞지 않는다. 지운 것과 숨긴 것은 되돌릴 수
     있는지가 다르고, 강사가 그 차이를 알아야 대표에게 물을 수 있다. */
  if (hidden) parts.push(`${hidden}명은 아직 센터에 안 올라간 기록이 있어 감춰만 뒀어요`);
  return `${parts.join(". ")} (센터 기록은 그대로)`;
}

/** 사본이 살아 있는 기간. */
export const SNAPSHOT_KEEP_DAYS = 90;

/**
 * 청소 직전의 사본. **이 쓰기가 성공해야만 지운다.**
 *
 * 지우는 것은 기록이 이미 센터에 있는 회원뿐이지만, 강사가 그 회원에게 적어 둔
 * 레거시 수업 기록은 그 기기와 그 사람의 백업에만 있다 -- 되돌릴 자리가 없으면
 * 지울 수 없다.
 *
 * 담는 것은 **지울 회원뿐**이다. 명부 전체를 담으면 문서 하나가 금세 한계에
 * 닿고, 그때 실패하는 것은 사본이 아니라 청소 전체다.
 *
 * @param {Array<any>} members 지울 회원
 * @param {{ userId: string, organizationId: string, now?: Date }} input
 */
export function snapshotPayload(members, input = {}) {
  const rows = (Array.isArray(members) ? members : []).filter(Boolean);
  const now = input.now instanceof Date ? input.now : new Date();
  return {
    organizationId: text(input.organizationId),
    userId: text(input.userId),
    /* 사진은 담지 않는다. 바이너리가 들어가면 문서가 터지고, 애초에 사진이
       안 올라간 회원은 지우지 않으므로 여기 오지 않는다. */
    members: rows.map((member) => ({ ...member, src: undefined, blob: undefined })),
    clientIds: rows.map((member) => text(member.orgClientId)).filter(Boolean),
    expireAt: new Date(now.getTime() + SNAPSHOT_KEEP_DAYS * 24 * 60 * 60 * 1000),
  };
}

/** 사본 문서의 id. 하루에 한 번이면 덮어쓰기 시도가 규칙에 막혀 두 번 안 지운다. */
export function snapshotId(userId, now = new Date()) {
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return `${text(userId)}_${day}`;
}
