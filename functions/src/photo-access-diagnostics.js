"use strict";
const reasons = new Set(['photo/invalid-id', 'photo/move-pending', 'photo/scope-immutable', 'photo/legacy-link-review-required', 'photo/scope-required', 'photo/access-denied']);
function photoAccessRejection(error) {
  return { stage: 'prepare_access', reasonCode: reasons.has(error?.message) ? error.message : 'photo/access-check-failed' };
}
module.exports = { photoAccessRejection };
