"use strict";
const reasons = new Set(['photo/invalid-id', 'photo/move-pending', 'photo/scope-immutable', 'photo/legacy-link-review-required', 'photo/scope-required', 'photo/access-denied']);
const present = (value) => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(value);
/* 값은 남기지 않는다. 있다 / 없다만 -- photo/scope-required 가 센터 id 가 비어서인지 회원 id 가
   비어서인지 갈라야 원인을 추측 없이 확정한다 (2026-11-14, 대표 폰의 403 을 추측으로 좁혀야 했다). */
function photoAccessRejection(error, input = {}) {
  return {
    stage: 'prepare_access',
    reasonCode: reasons.has(error?.message) ? error.message : 'photo/access-check-failed',
    hasPhotoId: present(input?.photoId),
    hasOrganizationId: present(input?.organizationId),
    hasClientId: present(input?.clientId),
  };
}
module.exports = { photoAccessRejection };
