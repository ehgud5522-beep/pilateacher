/* 보니따 앱 설치 현황 (2026-11-15 대표: "누가 아직 안 깔았는지 깔았는지 확인하는 거 더보기에").
 *
 * 명부(clients)와 서버의 앱 사용 기록(memberAppStatus)을 한 줄씩 잇는다. 상태는 셋:
 *   app    -- 휴대폰 앱을 쓴다 (알림을 허락한 기기가 있거나, 앱에서 켠 기록이 있다)
 *   linked -- 회원 앱 계정과 이어졌지만 휴대폰 앱 기록이 없다 (웹으로만 봤거나, 옛 앱을 알림 없이 쓰는 중)
 *   none   -- 아직 이어지지 않았다 (가입 전 · 연결 전)
 * "linked" 를 "안 깔았다" 고 말하지 않는다 -- 옛 앱(1.1.3 이하)은 켠 기록을 남기지 않으므로 알림을 끈 채 쓰면 여기서 보이지 않는다.
 */
export const APP_STATUS = Object.freeze({ APP: 'app', LINKED: 'linked', NONE: 'none' });

export const APP_STATUS_COPY = Object.freeze({
  app: { label: '앱 사용 중', tone: 'good' },
  linked: { label: '연결됨 · 앱 확인 전', tone: 'warn' },
  none: { label: '아직 연결 안 함', tone: 'muted' },
});

const PLATFORM_NAME = { ios: '아이폰', android: '안드로이드', web: '웹' };
const text = (value) => String(value ?? '').trim();

/** 'YYYY-MM-DDTHH…' → '11.14' (한국 시각). 못 읽으면 빈 문자열. */
export function shortSeen(iso) {
  const ms = Date.parse(iso || '');
  if (!Number.isFinite(ms)) return '';
  const kst = new Date(ms + 9 * 3600 * 1000);
  return `${kst.getUTCMonth() + 1}.${kst.getUTCDate()}`;
}

/**
 * @param {{ id: string, name?: string, userId?: string, archived?: boolean, locationId?: string }[]} clients 명부
 * @param {{ clientId: string, app: boolean, platforms: string[], notifications: boolean, lastSeenAt: string, lastPlatform: string }[]} usage 서버 답
 */
export function memberAppRows(clients, usage) {
  const byClient = new Map((usage || []).map((item) => [text(item?.clientId), item]));
  return (clients || [])
    .filter((client) => client && client.archived !== true && !client.deletedAt && text(client.id))
    .map((client) => {
      const linked = Boolean(text(client.userId));
      const use = linked ? byClient.get(text(client.id)) : null;
      const status = !linked ? APP_STATUS.NONE : use?.app ? APP_STATUS.APP : APP_STATUS.LINKED;
      const parts = [];
      if (status === APP_STATUS.APP) parts.push((use.platforms || []).map((p) => PLATFORM_NAME[p] || p).join(' · '));
      if (use?.lastSeenAt) parts.push(`마지막 ${shortSeen(use.lastSeenAt)}${use.lastPlatform ? ` ${PLATFORM_NAME[use.lastPlatform] || use.lastPlatform}` : ''}`);
      if (status === APP_STATUS.APP && !use.notifications) parts.push('알림 꺼짐');
      if (status === APP_STATUS.LINKED && !use?.lastSeenAt) parts.push('앱에서 켠 기록이 아직 없어요');
      return { id: text(client.id), name: text(client.name) || '(이름 없음)', locationId: text(client.locationId), status, detail: parts.filter(Boolean).join(' · ') };
    })
    // 아직 연결 안 한 회원부터 -- 대표가 연락할 사람이 위에 오게.
    .sort((a, b) => order(a.status) - order(b.status) || a.name.localeCompare(b.name, 'ko'));
}
const order = (status) => ({ none: 0, linked: 1, app: 2 })[status] ?? 3;

export function countByStatus(rows) {
  const counts = { all: rows.length, app: 0, linked: 0, none: 0 };
  for (const row of rows) counts[row.status] += 1;
  return counts;
}
