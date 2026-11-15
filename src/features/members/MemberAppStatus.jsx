import { useCallback, useEffect, useMemo, useState } from 'react';
import { APP_STATUS, APP_STATUS_COPY, countByStatus, memberAppRows } from './member-app-status.js';
import './member-app-status.css';

/* 더보기 › 보니따 앱 설치 현황 (대표 · 총괄). 명부와 서버의 앱 사용 기록을 잇는다 (member-app-status.js).
   명부를 못 읽으면 아무것도 지어내지 않고 말한다. 서버만 못 읽으면 "연결 여부" 까지는 명부로 보여 준다. */
const FILTERS = [['all', '전체'], [APP_STATUS.NONE, '연결 안 함'], [APP_STATUS.LINKED, '앱 확인 전'], [APP_STATUS.APP, '앱 사용']];

export default function MemberAppStatus({ organizationId, loadClients, loadLocations, fetchStatus, initialState = null }) {
  const [clients, setClients] = useState(initialState?.clients || []);
  const [locations, setLocations] = useState(initialState?.locations || []);
  const [usage, setUsage] = useState(initialState?.usage || []);
  const [loading, setLoading] = useState(!initialState);
  const [rosterError, setRosterError] = useState(initialState?.rosterError || '');
  const [usageError, setUsageError] = useState(initialState?.usageError || '');
  const [filter, setFilter] = useState('all'), [query, setQuery] = useState(''), [place, setPlace] = useState('');

  const reload = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true); setRosterError(''); setUsageError('');
    const [roster, places, status] = await Promise.allSettled([loadClients(), loadLocations(), fetchStatus({ organizationId })]);
    if (roster.status === 'fulfilled') setClients(roster.value || []); else setRosterError(String(roster.reason?.code || roster.reason?.message || 'unknown'));
    if (places.status === 'fulfilled') setLocations(places.value || []);
    if (status.status === 'fulfilled') setUsage(status.value?.members || []);
    else setUsageError(String(status.reason?.details?.code || status.reason?.code || status.reason?.message || 'unknown'));
    setLoading(false);
  }, [organizationId, loadClients, loadLocations, fetchStatus]);
  useEffect(() => { if (!initialState) reload(); }, [reload, initialState]);

  const rows = useMemo(() => memberAppRows(clients, usageError ? [] : usage), [clients, usage, usageError]);
  const scoped = rows.filter((row) => !place || row.locationId === place);
  const counts = countByStatus(scoped);
  const shown = scoped.filter((row) => (filter === 'all' || row.status === filter) && (!query.trim() || row.name.includes(query.trim())));
  const placeName = (id) => locations.find((item) => item.id === id)?.name || '';

  return <section className="mas" aria-label="보니따 앱 설치 현황">
    <div className="mas-head">
      <div><strong>보니따 앱 설치 현황</strong><small>회원 앱 계정과 이어졌는지, 휴대폰 앱에서 켠 기록이 있는지 봐요.</small></div>
      <button type="button" onClick={reload} disabled={loading}>{loading ? '확인 중…' : '새로고침'}</button>
    </div>
    {rosterError ? <p className="mas-alert" role="alert">회원 명부를 읽지 못했어요. (코드 {rosterError})</p> : null}
    {usageError ? <p className="mas-alert" role="alert">앱 사용 기록을 읽지 못해 연결 여부만 보여요. (코드 {usageError})</p> : null}
    {!rosterError ? <>
      <div className="mas-counts">
        {FILTERS.map(([key, title]) => <button type="button" key={key} aria-pressed={filter === key} onClick={() => setFilter(key)} className={`mas-count is-${key}`}>
          <b>{counts[key]}</b><span>{title}</span></button>)}
      </div>
      <div className="mas-tools">
        <input type="search" aria-label="회원 이름 검색" placeholder="회원 이름 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
        {locations.length > 1 ? <select aria-label="지점" value={place} onChange={(e) => setPlace(e.target.value)}>
          <option value="">모든 지점</option>{locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select> : null}
      </div>
      {loading && !rows.length ? <p className="mas-empty" role="status">확인하고 있어요…</p>
        : shown.length ? <ul className="mas-list">{shown.map((row) => <li key={row.id}>
          <div className="mas-who"><strong>{row.name}</strong><small>{[placeName(row.locationId), row.detail].filter(Boolean).join(' · ')}</small></div>
          <span className={`mas-badge is-${APP_STATUS_COPY[row.status].tone}`}>{APP_STATUS_COPY[row.status].label}</span>
        </li>)}</ul>
        : <p className="mas-empty">조건에 맞는 회원이 없어요.</p>}
      <p className="mas-note">"앱 확인 전" 은 안 깔았다는 뜻이 아니에요 -- 웹으로만 봤거나, 예전 앱을 알림 없이 쓰는 중일 수 있어요. 회원이 새 앱을 한 번 켜면 "앱 사용 중" 으로 바뀌어요.</p>
    </> : null}
  </section>;
}
