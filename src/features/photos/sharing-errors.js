const reasons = new Set(('card-too-large card-not-jpeg card-hash-mismatch card-comment-too-long card-dimensions card-dates card-conflict card-changed card-not-ready consent-required member-required member-not-linked teacher-access-revoked disabled update-required unsupported-type invalid-selection request-conflict not-found revoked confirmation-required invalid-action sign-in-required temporarily-unavailable photo-not-ready photo-changed image-format').split(' ').map((r) => `share/${r}`));
export function sharingDiagnostic(error, context = {}) {
  const candidate = error?.details?.reasonCode || error?.message;
  const reasonCode = reasons.has(candidate) ? candidate : 'share/unknown';
  const raw = String(error?.code || 'unknown');
  const errorCode = /^(?:functions\/)?[a-z][a-z-]{0,60}$/.test(raw) ? raw : 'unknown';
  const stage = ['capture', 'prepare', 'activate', 'revoke', 'read', 'detail', 'media', 'teacherList', 'memberList', 'consent', 'consentStatus', 'capability'].includes(context.action) ? context.action : 'unknown';
  return { feature: 'before_after_share', stage, errorDomain: stage === 'capture' ? 'canvas' : 'firebase_functions', errorCode, reasonCode,
    shareIdPrefix: String(context.shareId || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8), bytes: Number.isFinite(context.bytes) ? context.bytes : 0,
    appBuild: String(context.appBuild || 'unknown').slice(0, 40), platform: ['web', 'ios', 'android'].includes(context.platform) ? context.platform : 'web' };
}
export function sharingMessage(error) {
  const d = sharingDiagnostic(error), r = d.reasonCode;
  const messages = {
    'share/card-too-large': '비교 카드가 4MB를 초과합니다.', 'share/card-not-jpeg': 'JPEG 비교 카드가 아닙니다.',
    'share/card-hash-mismatch': '카드 전송 내용이 일치하지 않습니다.', 'share/card-comment-too-long': '강사 코멘트는 120자까지 가능합니다.',
    'share/card-dimensions': '카드 크기를 확인해 주세요.', 'share/card-dates': '두 사진의 촬영 날짜를 확인해 주세요.',
    'share/consent-required': '회원앱에서 사진 공유 동의를 확인해 주세요.', 'share/member-not-linked': '회원앱 계정 연결을 확인할 수 없습니다.',
    'share/teacher-access-revoked': '이 회원의 사진 공유 권한이 없습니다.', 'share/sign-in-required': '다시 로그인해 주세요.',
    'share/revoked': '취소된 공유입니다.', 'share/disabled': '비포애프터 공유는 아직 준비 중입니다.',
    'share/update-required': '앱을 최신 버전으로 업데이트해 주세요.', 'share/unsupported-type': '완성된 비교 카드만 새로 공유할 수 있습니다.',
  };
  const fallback = /unavailable|deadline-exceeded|network/.test(d.errorCode) || error?.message === 'offline' ? '네트워크 연결을 확인한 뒤 다시 시도해 주세요.' : /permission-denied/.test(d.errorCode) ? '공유 접근 권한이 없습니다.' : '공유 자료를 처리하지 못했습니다.';
  return `${messages[r] || fallback} (코드 ${d.errorCode}${r !== 'share/unknown' ? ` · ${r}` : ''})`;
}
export function logSharingFailure(error, input) {
  const details = sharingDiagnostic(error, input);
  console.info('[PilaTeacher/device] before_after_share_failed', details);
  return details;
}
