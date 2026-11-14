/* 이 회원에게 카드를 보낼 수 있는가 (2026-11-15 대표: "강사들이 편리함을 느껴야 해").
   전에는 카드를 다 만들고 [공유하기] 를 누른 뒤에야 "회원앱에서 사진 공유 동의를 확인해 주세요" 가 떴다.
   이제 앨범을 열 때 서버에 묻고(teacherConsent), 막힌 이유와 회원에게 보낼 안내 문구를 먼저 보여 준다.

   상태는 서버가 주는 넷 + 모름 하나. 모름(unknown)은 막지 않는다 -- 옛 서버이거나 잠깐 못 읽은 것이고,
   그때는 지금까지처럼 보내 보고 서버가 답하게 둔다. */
export const SHARE_STATES = Object.freeze(['ready', 'consent_needed', 'not_linked', 'not_open']);

export const shareState = (value) => SHARE_STATES.includes(value) ? value : 'unknown';

/** 회원이 쓰는 앱 이름. 보니따 센터만 "보니따 앱", 그 밖에는 "회원 앱". */
export const memberAppName = (organizationId) => String(organizationId || '') === 'bonita' ? '보니따 앱' : '회원 앱';

/** 앨범 머리에 붙는 짧은 표시. 모름이면 아무것도 붙이지 않는다. */
export function shareBadge(state) {
  return {
    ready: { label: '앱 공유 가능', tone: 'good' },
    consent_needed: { label: '회원 동의 필요', tone: 'warn' },
    not_linked: { label: '앱 미연결', tone: 'muted' },
    not_open: { label: '앱 공유 준비 중', tone: 'muted' },
  }[state] || null;
}

/**
 * 보낼 수 없을 때의 이유와 다음 걸음. 보낼 수 있거나 모르면 null.
 * message 가 있으면 회원에게 그대로 보낼 수 있는 문구다 -- 회원 이름 · 연락처는 넣지 않는다.
 */
export function shareBlocker(state, appName = '회원 앱') {
  if (state === 'consent_needed') {
    return {
      title: '회원님의 사진 공유 동의가 필요해요',
      help: `${appName}에서 회원님이 한 번 동의하면 바로 보낼 수 있어요. 아래 문구를 회원님께 보내 주세요. 그동안은 [이미지 저장]으로 보낼 수 있어요.`,
      message: `안녕하세요 회원님 :) 수업 변화 사진을 앱으로 보내드리려고 해요.\n${appName} → 비포애프터 탭에서 '사진 공유 동의'를 눌러 주시면 바로 보내드릴게요.`,
    };
  }
  if (state === 'not_linked') {
    return {
      title: `회원님이 ${appName}에 연결되어 있지 않아요`,
      help: `회원님이 ${appName}에 가입하고 센터 회원 정보와 연결되면 앱으로 보낼 수 있어요. 지금은 [이미지 저장]으로 보내 주세요.`,
      message: '',
    };
  }
  if (state === 'not_open') {
    return {
      title: '이 회원님에게는 앱 공유가 아직 열리지 않았어요',
      help: '앱 공유는 순서대로 열고 있어요. 열어야 하면 대표님께 말씀해 주세요. 지금은 [이미지 저장]으로 보내 주세요.',
      message: '',
    };
  }
  return null;
}
