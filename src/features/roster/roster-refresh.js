/**
 * 센터 회원 명단을 언제 다시 읽는가 (2026-11-04, 1단계).
 *
 * ── 왜 ──
 * 명단은 앱을 열 때와 수업 확정 · 되돌리기 뒤에만 읽었다. FC가 회원을 등록하고
 * 회원권을 발급해도 강사 폰은 앱을 껐다 켜기 전까지 그 회원을 몰랐다 -- 수업
 * 등록의 회원 선택에도, 회원 검색에도 없었다.
 *
 * ── 다시 읽는 때 ──
 *   회원 선택 시트를 열 때          연속으로 열면 10초에 한 번
 *   회원 목록 · 시트를 당겨서        같은 10초 제한
 *   앱이 30초 이상 비활성이었다가 돌아올 때
 *
 * ── 무엇을 다시 읽는가 (가벼운 갱신) ──
 * 회원 문서(강사는 담당 회원만 -- clientScopeFor 그대로)와 **마지막으로 읽은
 * 뒤에 발급된 회원권**만. 앱을 열 때의 전체 읽기는 회원권 · 누적 · 상품 전부라
 * 강사 한 명에게 2천 건이 넘는다. 새 회원이 나타나는 데 필요한 것은 그 둘뿐이다.
 *
 * 판정만 순수 함수로 둔다. 읽기와 시계는 부르는 쪽이 한다.
 */

/** 연속 갱신 사이의 최소 간격. */
export const ROSTER_REFRESH_MIN_MS = 10 * 1000;

/** 이만큼 비활성이었다가 돌아오면 갱신한다. */
export const ROSTER_RESUME_AFTER_MS = 30 * 1000;

/**
 * 발급 시각 비교의 여유. 기기 시계와 서버 시계가 어긋나도 그 사이에 발급된
 * 회원권을 놓치지 않게 조금 앞에서부터 읽는다 -- 겹쳐 읽은 것은 id 로 합친다.
 */
export const ROSTER_SINCE_MARGIN_MS = 2 * 60 * 1000;

const ms = (value) => {
  /* Number(null) 은 0 이다 -- 그대로 두면 "아직 안 읽음" 이 1970년에 읽은 것이 된다. */
  if (value === null || value === undefined || value === "") return NaN;
  if (value instanceof Date) return value.getTime();
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
};

/**
 * 지금 다시 읽어도 되는가. 읽는 중이면 아니다 -- 두 읽기가 겹치면 늦게 온 옛
 * 결과가 새 결과를 덮는다.
 *
 * @param {{ lastAt?: number | Date | null, now: number | Date, inFlight?: boolean, force?: boolean }} input
 */
export function shouldRefreshRoster({ lastAt = null, now, inFlight = false, force = false }) {
  if (inFlight) return false;
  if (force) return true;
  const last = ms(lastAt);
  if (!Number.isFinite(last)) return true;
  return ms(now) - last >= ROSTER_REFRESH_MIN_MS;
}

/**
 * 돌아왔을 때 갱신할 만큼 오래 비활성이었는가.
 *
 * @param {{ hiddenAt?: number | Date | null, now: number | Date }} input
 */
export function shouldRefreshOnResume({ hiddenAt = null, now }) {
  const hidden = ms(hiddenAt);
  if (!Number.isFinite(hidden)) return false;
  return ms(now) - hidden >= ROSTER_RESUME_AFTER_MS;
}

/**
 * 가벼운 갱신 결과를 들고 있던 명단에 합친다.
 *
 * 회원은 **새로 읽은 것으로 바꾼다** -- 빠진 회원(담당이 넘어간 회원)도 빠져야
 * 한다. 회원권은 id 로 합친다 -- 새로 발급된 것만 읽었으므로 나머지는 그대로다.
 *
 * @param {{ passes: Array<any> }} current
 * @param {{ clients: Array<any>, passes: Array<any> }} fresh
 */
export function mergeRosterRefresh(current, fresh) {
  const byId = new Map((Array.isArray(current?.passes) ? current.passes : []).map((pass) => [String(pass?.id || ""), pass]));
  for (const pass of Array.isArray(fresh?.passes) ? fresh.passes : []) byId.set(String(pass?.id || ""), pass);
  return {
    clients: Array.isArray(fresh?.clients) ? fresh.clients : [],
    passes: [...byId.values()],
  };
}

/** 발급 시각으로 거를 시작점. 마지막 읽기보다 여유만큼 앞. @param {number | Date | null} lastAt */
export function passesSince(lastAt) {
  const last = ms(lastAt);
  return Number.isFinite(last) ? new Date(last - ROSTER_SINCE_MARGIN_MS) : null;
}

/**
 * 가벼운 갱신 한 번. 읽기는 주입받는다 -- 화면과 테스트가 같은 길을 탄다.
 *
 * 간격 제한에 걸리면 **읽지 않는다** (status "throttled"). 읽기가 실패하면 들고
 * 있던 명단을 그대로 돌려준다 -- 빈 명단은 "센터에 회원이 없다" 로 읽힌다.
 *
 * @param {{
 *   readClients: () => Promise<Array<any>>,
 *   readPassesSince: (since: Date | null) => Promise<Array<any>>,
 *   current: { clients: Array<any>, passes: Array<any> },
 *   lastAt?: number | null, loadedAt?: number | null, inFlight?: boolean, force?: boolean,
 *   now: () => number, onStart?: (startedAt: number) => void,
 * }} input
 */
export async function refreshRosterOnce(input) {
  const startedAt = input.now();
  if (!shouldRefreshRoster({ lastAt: input.lastAt, now: startedAt, inFlight: input.inFlight, force: input.force })) {
    return { status: input.inFlight ? "in_flight" : "throttled", ...input.current, startedAt };
  }
  /* 읽기로 가기로 정한 그 자리(await 전)에서 알린다. 부르는 쪽이 읽는 중 표시를
     세워야 같은 순간의 둘째 호출이 in_flight 로 끝난다. */
  input.onStart?.(startedAt);
  try {
    const [clients, passes] = await Promise.all([
      input.readClients(),
      input.readPassesSince(passesSince(input.loadedAt ?? null)),
    ]);
    return { status: "refreshed", ...mergeRosterRefresh(input.current, { clients, passes }), startedAt, read: clients.length + passes.length };
  } catch (error) {
    return { status: "failed", ...input.current, startedAt, error };
  }
}

/**
 * "마지막 갱신 N분 전". 1분이 안 되면 "방금 갱신", 한 시간이 넘으면 시간으로.
 *
 * @param {number | Date | null} at @param {number | Date} now
 */
export function lastUpdatedLabel(at, now) {
  const at$ = ms(at);
  if (!Number.isFinite(at$)) return "";
  const minutes = Math.max(0, Math.floor((ms(now) - at$) / 60000));
  if (minutes < 1) return "방금 갱신";
  if (minutes < 60) return `마지막 갱신 ${minutes}분 전`;
  return `마지막 갱신 ${Math.floor(minutes / 60)}시간 전`;
}
