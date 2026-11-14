const stages = new Set(['prepare_access', 'original_metadata', 'original_upload', 'original_verify', 'image_upload', 'manifest_write', 'delete']);
const reasons = new Set(['scope-required', 'access-denied', 'access-check-failed', 'invalid-id', 'move-pending', 'scope-immutable', 'legacy-link-review-required', 'path-mismatch', 'original-required', 'original-conflict', 'original-checksum', 'account-changed', 'manifest-missing']);
export async function photoStage(stage, errorDomain, operation) {
  try { return await operation(); }
  catch (cause) {
    const error = new Error(cause?.message || 'photo/unknown', { cause });
    Object.assign(error, { code: cause?.code, details: cause?.details, photoStage: cause?.photoStage || stage, photoDomain: cause?.photoDomain || errorDomain });
    throw error;
  }
}
export function photoFailure(error, task = {}, context = {}) {
  const rawCode = String(error?.code || '');
  const errorCode = /^(?:(?:functions|storage|firestore|backup|auth)\/)?[a-z][a-z-]{0,60}$/.test(rawCode) ? rawCode : 'unknown';
  const candidate = String(error?.details?.reasonCode || error?.details?.code || error?.message || '').match(/\bphoto\/([a-z-]+)\b/)?.[1];
  const reasonCode = reasons.has(candidate) ? `photo/${candidate}` : '';
  const shortCode = errorCode.split('/').at(-1);
  const permission = ['permission-denied', 'unauthorized', 'unauthenticated'].includes(shortCode) || ['access-denied', 'scope-required'].includes(candidate);
  const transient = !permission && !reasonCode && ['unavailable', 'deadline-exceeded', 'network-request-failed', 'retry-limit-exceeded', 'timeout', 'operation-timeout', 'resource-exhausted', 'too-many-requests'].includes(shortCode);
  const stage = stages.has(error?.photoStage) ? error.photoStage : task.action === 'delete' ? 'delete' : 'prepare_access';
  const declaredDomain = ['firebase_functions', 'firebase_storage', 'firestore'].includes(error?.photoDomain) ? error.photoDomain : null;
  const errorDomain = errorCode.startsWith('functions/') ? 'firebase_functions' : errorCode.startsWith('storage/') ? 'firebase_storage' : declaredDomain || (stage === 'manifest_write' || stage === 'delete' ? 'firestore' : 'firebase_functions');
  return { feature: 'photo_backup', stage, errorDomain, errorCode, reasonCode,
    category: permission ? 'permission' : transient ? 'network' : 'other', retryable: transient,
    photoIdPrefix: String(task.photoId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 8),
    hasOrganizationId: Boolean(context.organizationId), hasClientId: Boolean(context.clientId),
    appBuild: String(context.appBuild || 'unknown'), platform: String(context.platform || 'unknown') };
}
export function photoFailureLabel(failure) {
  const category = { permission: '권한', network: '네트워크·일시 장애', other: '기타' }[failure.category] || '기타';
  return `${category} (${failure.errorCode || 'unknown'}${failure.reasonCode ? ` · ${failure.reasonCode}` : ''})`;
}
