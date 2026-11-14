import TeacherPhotoSharing from './TeacherPhotoSharing.jsx';
import { photoFailureLabel } from '../backup/photo-errors.js';
import { useEffect, useRef, useState } from 'react';
import { ALBUM_VIEWS, DEFAULT_EDIT, albumPhotos, chronologicalPair, exifDate, photoKey } from './album-model.js';
import { albumDraft } from './album-drafts.js';
import { renderAlbumPhoto } from './album-render.js';
import './album.css';
import { ArrowLeft, ChevronRight, ImageOff, ImagePlus, Images, Search, X } from 'lucide-react';
import { usePhotoGestures } from './photo-gestures.js';
import { createContext, useContext } from 'react';
import { createPortal } from 'react-dom';
import { COMMENT_MAX, brandFor, drawComparisonCard } from './comparison-card.js';

/* 펜 · 자 표시를 그리는 함수. 그리는 코드(drawAnnotationMark)가 App.jsx 에 있어 위에서 받는다. */
const MarkContext = createContext(null);
/* 표시가 있는 사진은 표시를 그린 틀(3:4 cover)을 먼저 만든다 (album-render.js markedFrame).
   앨범에서 한 번도 편집하지 않은 옛 자세 사진은 회전 · 확대 · 위치가 그 틀 안에 들어가므로
   앨범 편집으로 또 적용하지 않는다 -- 두 번 돌리면 선과 사진이 어긋난다. */
function renderInput(photo, draw, edits) {
  const marks = draw && Array.isArray(photo.marks) && photo.marks.length ? photo.marks : null;
  if (!marks) return [edits, null];
  const legacy = { ...DEFAULT_EDIT, rotate: photo.rot || 0, zoom: photo.scale || 1, x: photo.x || 0, y: photo.y || 0 };
  const untouched = !edits || Object.keys(legacy).every((k) => Number(edits[k] ?? DEFAULT_EDIT[k]) === Number(legacy[k]));
  return untouched
    ? [DEFAULT_EDIT, { marks, draw, transform: { rot: photo.rot, scale: photo.scale, x: photo.x, y: photo.y } }]
    : [edits, { marks, draw }];
}

const label = (view) => ALBUM_VIEWS.find(([key]) => key === view)?.[1] || '기타';
const today = () => new Date().toLocaleDateString('sv-SE');
const Button = ({ children, ...props }) => <button type="button" {...props}>{children}</button>;
function ImportPreview({ item }) {
  const [src, setSrc] = useState('');
  useEffect(() => { const url = URL.createObjectURL(item.file); setSrc(url); return () => URL.revokeObjectURL(url); }, [item.file]);
  return src ? <img className="ba-import-preview" src={src} alt="등록할 사진 미리보기" /> : null;
}
function Photo({ photo, edits, onTransform, className = '' }) {
  const gestures = usePhotoGestures(edits || photo.albumEdit || DEFAULT_EDIT, onTransform);
  const ref = useRef(null);
  const [error, setError] = useState(false);
  const draw = useContext(MarkContext);
  useEffect(() => {
    let active = true;
    setError(false);
    const [e, overlay] = renderInput(photo, draw, edits || photo.albumEdit);
    renderAlbumPhoto(photo.src, e, 900, overlay).then((c) => {
      if (!active || !ref.current) return;
      ref.current.width = c.width; ref.current.height = c.height;
      ref.current.getContext('2d').drawImage(c, 0, 0);
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [photo, photo.src, photo.albumEdit, photo.marks, edits, draw]);
  // 사진 칸 안에 작게. 긴 문장이 칸을 덮으면 목록이 고장 난 화면처럼 보인다 -- 전체 문장은 읽어 주는 이름으로 남긴다.
  return error ? <span className={`ba-photo-error ${className}`} role="img" aria-label="사진을 불러오지 못했습니다. 백업 복원을 확인하세요." title="사진을 불러오지 못했습니다. 백업 복원을 확인하세요."><ImageOff size={20} strokeWidth={1.6} aria-hidden="true" /><span>사진 없음</span></span> : <canvas {...gestures} style={onTransform ? { touchAction: 'none' } : undefined} ref={ref} role="img" aria-label={`${photo.date} ${label(photo.view)} 사진`} className={className} />;
}
function Range({ title, value, min, max, step = 1, onChange }) {
  return <label className="ba-range">{title}<input type="range" aria-label={title} value={value} min={min} max={max} step={step} onChange={(e) => onChange(Number(e.target.value))} /><output>{Number(value).toFixed(step < 1 ? 2 : 0)}</output></label>;
}
function Compare({ photos, initialPhotos, onClose, onExport, onShare, brand }) {
  const draw = useContext(MarkContext);
  const [images, setImages] = useState(null);
  const [comment, setComment] = useState('');
  const [pair, setPair] = useState(() => chronologicalPair(initialPhotos));
  const [mode, setMode] = useState('side');
  const [split, setSplit] = useState(50);
  const [target, setTarget] = useState(0);
  const [align, setAlign] = useState([{ zoom: 1, x: 0, y: 0 }, { zoom: 1, x: 0, y: 0 }]);
  const [guides, setGuides] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const ref = useRef(null);
  const gestures = usePhotoGestures(align[target], (next) => setAlign((old) => old.map((p, i) => i === target ? next : p)));
  useEffect(() => {
    let active = true;
    setReady(false);
    setImages(null);
    Promise.all(pair.map((p) => { const [e, overlay] = renderInput(p, draw, p.albumEdit); return renderAlbumPhoto(p.src, e, 1400, overlay); })).then((loaded) => {
      if (active) { setImages(loaded); setError(''); }
    }).catch(() => { if (active) setError('사진을 불러오지 못했습니다. 원본을 복원한 후 다시 시도하세요.'); });
    return () => { active = false; };
  }, [pair, draw]);
  /* 사진을 읽는 일과 카드를 그리는 일을 나눈다. 코멘트를 칠 때마다, 슬라이더를 움직일 때마다
     사진을 다시 읽으면 손이 늦는다. 화면에 보이는 카드가 곧 저장되는 이미지다 (comparison-card.js). */
  useEffect(() => {
    if (!images || !ref.current) return;
    drawComparisonCard(ref.current, { images, pair, mode, align, split, guides, brand, comment });
    setReady(true);
  }, [images, pair, mode, split, align, guides, brand, comment]);
  return <section className="ba-compare-page"><div className="ba-toolbar"><Button aria-label="앨범으로" onClick={onClose}><ArrowLeft size={22} /></Button><h2>비포애프터 비교</h2><Button onClick={() => { setPair(([a,b]) => [b,a]); setAlign(([a,b]) => [b,a]); }}>위치 교체</Button></div>

    {pair[0].view !== pair[1].view && <p role="status">{label(pair[0].view)}과 {label(pair[1].view)} 사진은 정확한 체형 비교가 어려울 수 있습니다.</p>}
    <div className="ba-photo-labels"><strong>BEFORE</strong><strong>AFTER</strong></div>
    <canvas {...gestures} style={{ touchAction: 'none' }} ref={ref} className="ba-comparison" role="img" aria-label="비포애프터 비교 이미지" />
    {mode === 'overlay' && <Range title="겹침 슬라이더" value={split} min={0} max={100} onChange={setSplit} />}
    <label className="ba-comment"><span>강사 코멘트 <small>{comment.length}/{COMMENT_MAX}</small></span><textarea rows={3} maxLength={COMMENT_MAX} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="이번 변화에 대한 한마디 · 비교 이미지 아래에 함께 저장돼요" /><small>회원 이름이나 연락처는 적지 않는 것을 권해요. 이미지는 앱 밖으로 나가면 지울 수 없어요.</small></label>
    <div className="ba-photo-dates"><span>{pair[0].date}</span><span>{pair[1].date}</span></div><details><summary>확대 · 정렬</summary><label>정렬할 사진<select value={target} onChange={(e) => setTarget(Number(e.target.value))}><option value={0}>BEFORE</option><option value={1}>AFTER</option></select></label>
    {[['zoom', '확대 / 축소', 0.5, 3, 0.05], ['x', '좌우 위치', -50, 50, 1], ['y', '상하 위치', -50, 50, 1]].map(([key, title, min, max, step]) => <Range key={key} title={title} value={align[target][key]} min={min} max={max} step={step} onChange={(v) => setAlign((old) => old.map((a, i) => i === target ? { ...a, [key]: v } : a))} />)}
    </details><details><summary>비교 사진 변경</summary>    <div className="ba-toolbar">{pair.map((p, i) => <label key={i}>{i ? 'AFTER' : 'BEFORE'}<select value={photoKey(p)} onChange={(e) => { const chosen = photos.find((x) => photoKey(x) === e.target.value); setPair((old) => old.map((x, index) => index === i ? chosen : x)); }}>{photos.map((x, index) => <option disabled={photoKey(pair[1 - i]) === photoKey(x)} key={photoKey(x)} value={photoKey(x)}>{x.date} · {label(x.view)} · {index + 1}</option>)}</select></label>)}</div></details>    <div className="ba-toolbar"><Button aria-pressed={mode === 'side'} onClick={() => setMode('side')}>나란히</Button><Button aria-pressed={mode === 'overlay'} onClick={() => setMode('overlay')}>슬라이더</Button><label><input type="checkbox" checked={guides} onChange={(e) => setGuides(e.target.checked)} /> 기준선</label></div>
    {onShare && <Button onClick={() => onShare(pair, { mode, align, split })}>비교 결과 공유하기</Button>}{error && <p role="alert">{error}</p>}<Button className="ba-primary ba-export" disabled={!ready} onClick={() => onExport(ref.current)}>비교 이미지 저장</Button>
  </section>;
}
export default function BeforeAfterAlbum({ accountId, members, photos, selectedId, onSelect, onImport, onPatch, onDelete, hub, onExport, backupStatus, onRetry, onAnalyze, sharingApi, organizationId, markup, drawMarks }) {
  const [markupPhoto, setMarkupPhoto] = useState(null);
  const cancelEditRef = useRef(() => {});
  const [sharing, setSharing] = useState(null), [sharingEnabled, setSharingEnabled] = useState(false);
  useEffect(() => { let active = true; setSharingEnabled(false); setSharing(null); if (sharingApi) sharingApi({ action: 'capability', role: 'teacher' }).then((r) => { if (active) setSharingEnabled(r.enabled); }).catch(() => {}); return () => { active = false; }; }, [sharingApi, accountId]);
  useEffect(() => { setSharing(null); }, [selectedId]);
  const [query, setQuery] = useState(''); const [filter, setFilter] = useState('all');
  const [view, setView] = useState('all'); const [oldest, setOldest] = useState(false);
  const [selected, setSelected] = useState([]); const [comparing, setComparing] = useState(false);
  const [preview, setPreview] = useState(null); const [tool, setTool] = useState('crop');
  const [ai, setAi] = useState(false); const [editing, setEditing] = useState(null);
  const [edit, setEdit] = useState({ ...DEFAULT_EDIT }); const [date, setDate] = useState(''); const [direction, setDirection] = useState('custom'); const [owner, setOwner] = useState('');
  const [draft, setDraft] = useState(null); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const picker = useRef(null); const writes = useRef(Promise.resolve());
  const dialog = useRef(null);
  useEffect(() => {
    if (!editing && !preview) return;
    const previous = document.activeElement;
    const node = dialog.current;
    if (!node) return;
    const focusable = () => [...node.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),summary')].filter((el) => el.getClientRects().length);
    focusable()[0]?.focus();
    const keydown = (event) => {
      if (event.key === 'Escape' && !busy) { if (editing) cancelEditRef.current(); else setPreview(null); }
      if (event.key !== 'Tab') return;
      const items = focusable(), first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    node.addEventListener('keydown', keydown);
    return () => { node.removeEventListener('keydown', keydown); if (previous?.isConnected) previous.focus(); };
  }, [editing, preview, busy]);
  const member = members.find((m) => m.id === selectedId);
  const all = albumPhotos(photos[selectedId]);
  const persist = (value) => {
    setDraft(value);
    writes.current = writes.current.catch(() => {}).then(() => albumDraft(accountId, value ? 'put' : 'delete', value));
    return writes.current;
  };
  useEffect(() => { let active = true; albumDraft(accountId, 'get').then((value) => { if (active && value) { setDraft(value); setMessage('기기에 보관한 작업을 복구했습니다.'); } }).catch(() => setMessage('임시 저장소를 열지 못했습니다. 저장 공간을 확인하세요.')); return () => { active = false; }; }, [accountId]);
  useEffect(() => { setSelected([]); setPreview(null); setComparing(false); setAi(false); setEditing(null); }, [selectedId]);
  const run = async (fn) => { setBusy(true); setMessage('저장 중'); try { await fn(); } catch (error) { setMessage(error.message || '저장 실패 · 임시 작업을 유지했습니다.'); } finally { setBusy(false); } };
  const importFiles = (files) => run(async () => {
    const items = [];
    for (const file of files) {
      if (!file.type.startsWith('image/')) throw new Error('이미지 파일만 선택해 주세요.');
      const bytes = await file.arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
      const found = exifDate(bytes);
      items.push({ file, hash, date: found || today(), dateSource: found ? 'exif' : 'fallback', view: 'custom' });
    }
    await persist({ kind: 'import', memberId: member?.id || '', items });
    setMessage('기기에 임시 저장됨 · 회원과 촬영 날짜를 확인하세요.');
  });
  const openEditor = (p) => { setEditing(p); setEdit({ ...DEFAULT_EDIT, ...p.albumEdit }); setDate(p.date || today()); setDirection(p.view); setOwner(member.id); };
  const editorValue = (changes = {}) => ({ kind: 'edit', memberId: member.id, photo: { id: editing.id, bucket: editing.bucket }, edit, date, direction, owner, ...changes });
  const saveEdit = () => run(async () => { if (owner !== member.id && !window.confirm("연결된 촬영 세트·분석 결과·비교 기록을 함께 이동합니다. 계속할까요?")) { setMessage("이동을 취소했습니다."); return; } await writes.current; if (await onPatch(member.id, editing, { albumEdit: edit, albumDate: date, albumView: direction }, owner) === false) throw new Error('저장 실패 · 편집 초안을 보관했습니다.'); await persist(null); setEditing(null); setMessage('기기에 저장했습니다.'); });
  /* 취소는 편집 초안도 지운다. 전에는 창만 닫고 초안을 남겨서, 초안이 있는 동안 모든 [편집]이
     잠겼다 -- "편집이 한 번밖에 안 된다" 의 원인. 바꾼 것이 있으면 버릴지 먼저 묻는다. */
  const cancelEdit = () => {
    if (!editing) return;
    const start = { ...DEFAULT_EDIT, ...editing.albumEdit };
    const dirty = Object.keys(start).some((k) => Number(edit[k]) !== Number(start[k]))
      || date !== (editing.date || today()) || direction !== editing.view || owner !== member?.id;
    if (dirty && !window.confirm('저장하지 않은 편집을 버릴까요?')) return;
    persist(null).catch(() => setMessage('편집 초안을 지우지 못했습니다. 다시 시도해 주세요.'));
    setEditing(null);
  };
  cancelEditRef.current = cancelEdit;
  const displayed = all.filter((p) => view === 'all' || p.view === view).sort((a, b) => oldest ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date));
  if (sharing && member) return <div className="ba-root"><TeacherPhotoSharing api={sharingApi} organizationId={organizationId} member={member} selectedPhotos={sharing.photos} comparisonConfig={sharing.comparisonConfig} onClose={() => setSharing(null)} /></div>;
  return <MarkContext.Provider value={drawMarks || null}><div className="ba-root">
    {sharingEnabled && member && <Button onClick={() => setSharing({ photos: all.filter((p) => selected.includes(photoKey(p))) })}>사진 공유하기 · 공유 기록</Button>}
    <input ref={picker} hidden type="file" accept="image/*" multiple onChange={(e) => { const files = [...e.target.files]; e.target.value = ''; if (files.length) importFiles(files); }} />
    {!comparing && <header className="ba-header">{member && <Button className="ba-icon" aria-label="회원 목록으로" onClick={() => onSelect(null)}><ArrowLeft size={22} /></Button>}<div>{member && <span className="ba-eyebrow">비포애프터</span>}<h1>{member ? member.name : '비포애프터'}</h1><p>{member ? `최근 촬영 ${all[0]?.date || '없음'} · ${all.length}장` : '회원의 변화를 사진으로 기록하세요.'}</p></div><Button className="ba-icon ba-primary" aria-label="사진 추가" disabled={busy || !!draft} onClick={() => picker.current.click()}><ImagePlus size={16} aria-hidden="true" />사진 추가</Button></header>}
    {message && !comparing && <p role="status" className="ba-notice">{message}</p>}
    {(backupStatus?.state === 'error' || backupStatus?.photoFailures?.length > 0) && <div className="ba-sync" role="status"><div>
      <p>이번 처리 성공 {backupStatus.processedPhotos || 0}장 · 실패 {backupStatus.photoFailures?.length || 0}장 · 기기 사진은 유지됩니다.</p>
      {(backupStatus.photoFailures || []).map((failure, index) => <p key={index}>사진 {failure.photoIdPrefix || '식별 불가'} · {photoFailureLabel(failure)} · {failure.stage}</p>)}
      {backupStatus.batchFailure && <p>백업 기록 저장 · {photoFailureLabel(backupStatus.batchFailure)}</p>}
      {!backupStatus.photoFailures?.length && !backupStatus.batchFailure && <p>실패 원인 확인 필요 (unknown)</p>}
    </div><Button onClick={onRetry}>다시 시도</Button></div>}
    {draft?.kind === 'import' && <section className="ba-panel"><h2>사진 {draft.items.length}장 등록</h2><input aria-label="등록할 회원 검색" placeholder="회원 이름 검색" value={query} onChange={(e) => setQuery(e.target.value)} /><select aria-label="등록할 회원" value={draft.memberId} disabled={busy} onChange={(e) => persist({ ...draft, memberId: e.target.value }).catch(() => setMessage('임시 저장 실패'))}><option value="">회원을 선택하세요</option>{members.filter((m) => m.id === draft.memberId || m.name?.includes(query)).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
      {draft.items.map((item, i) => <div className="ba-toolbar ba-import-row" key={`${item.hash}_${i}`}><ImportPreview item={item} /><span>사진 {i + 1}{item.dateSource === 'fallback' ? ' · 촬영일 확인 필요' : ''}</span><input aria-label={`사진 ${i + 1} 촬영 날짜`} type="date" value={item.date} disabled={busy} onChange={(e) => persist({ ...draft, items: draft.items.map((x, n) => n === i ? { ...x, date: e.target.value } : x) }).catch(() => setMessage('임시 저장 실패'))} /><select aria-label={`사진 ${i + 1} 방향`} value={item.view} disabled={busy} onChange={(e) => persist({ ...draft, items: draft.items.map((x, n) => n === i ? { ...x, view: e.target.value } : x) }).catch(() => setMessage('임시 저장 실패'))}>{ALBUM_VIEWS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>)}
      <Button disabled={busy || !draft.memberId || draft.items.some((x) => !x.date)} onClick={() => run(async () => { await writes.current; await onImport(draft); const id = draft.memberId; await persist(null); onSelect(id); setMessage('사진 저장 완료 · AI 분석은 선택 사항입니다.'); })} className="ba-primary">사진 저장</Button><Button disabled={busy} onClick={() => { if (window.confirm('등록하지 않은 임시 사진을 버릴까요?')) persist(null).catch(() => setMessage('임시 사진 삭제 실패')); }}>등록 취소</Button></section>}
    {draft?.kind === 'edit' && !editing && <Button onClick={() => { const m = members.find((x) => x.id === draft.memberId); const p = albumPhotos(photos[draft.memberId]).find((x) => x.id === draft.photo.id && x.bucket === draft.photo.bucket); if (!m || !p) { setMessage('초안의 회원 또는 사진에 접근할 수 없습니다.'); return; } if (selectedId !== m.id) { onSelect(m.id); return; } openEditor(p); setEdit(draft.edit); setDate(draft.date); setDirection(draft.direction); setOwner(draft.owner); }}>저장되지 않은 편집 이어하기</Button>}
    {draft?.kind === 'edit' && !editing && <Button className="ba-text" onClick={() => { if (window.confirm('저장하지 않은 편집을 버릴까요? 사진은 그대로입니다.')) persist(null).then(() => setMessage('편집 초안을 버렸습니다.')).catch(() => setMessage('편집 초안을 지우지 못했습니다.')); }}>편집 초안 버리기</Button>}
    {!member ? <>
      <div className="ba-filterbar"><label className="ba-search"><Search size={15} aria-hidden="true" /><input aria-label="회원 이름 검색" placeholder="회원 이름 검색" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
      <div className="ba-chips" aria-label="회원 필터">{[['all', '전체'], ['photos', '사진 있음'], ['compare', '비교 가능']].map(([k, l]) => <Button key={k} aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</Button>)}</div></div>
      <div className="ba-members">{members.filter((m) => m.name?.includes(query)).map((m) => ({ m, items: albumPhotos(photos[m.id]) })).filter(({ items }) => filter === 'all' || items.length >= (filter === 'compare' ? 2 : 1)).map(({ m, items }) => <Button className="ba-member" key={m.id} onClick={() => onSelect(m.id)}><span className="ba-avatar">{items[0]?.src ? <Photo photo={items[0]} /> : <ImagePlus size={22} />}</span><span className="ba-member-info"><strong>{m.name}</strong><small>{items[0]?.date || '아직 촬영한 사진이 없어요'}{items.length > 0 && ` · ${items.length}장`}</small></span>{items.length >= 2 && <span className="ba-badge">비교 가능</span>}<ChevronRight size={18} aria-hidden="true" /></Button>)}</div>
      {!members.some((m) => m.name?.includes(query) && (filter === 'all' || albumPhotos(photos[m.id]).length >= (filter === 'compare' ? 2 : 1))) && <p className="ba-no-results">조건에 맞는 회원이 없습니다.</p>}
    </> : <>
      {ai ? <><Button onClick={() => setAi(false)}><ArrowLeft size={18} /> 앨범으로</Button><p>AI 분석은 선택 기능입니다. 자세와 구도에 따라 정확도가 달라질 수 있습니다.</p>{hub(member.id, null)}</> : comparing ? <Compare onShare={sharingEnabled ? (photos, comparisonConfig) => setSharing({ photos, comparisonConfig }) : undefined} photos={all} initialPhotos={all.filter((p) => selected.includes(photoKey(p)))} onClose={() => setComparing(false)} onExport={onExport} brand={brandFor(organizationId)} /> : <>
        {all.length > 0 ? <><div className="ba-toolbar ba-album-filters"><select aria-label="촬영 방향 필터" value={view} onChange={(e) => setView(e.target.value)}><option value="all">모든 방향</option>{ALBUM_VIEWS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select><select aria-label="사진 정렬" value={String(oldest)} onChange={(e) => setOldest(e.target.value === 'true')}><option value="false">최신 순</option><option value="true">오래된 순</option></select><Button className="ba-text" onClick={() => setAi(true)}>분석 기록</Button></div>
        {[...new Set(displayed.map((p) => p.date))].map((day) => <section className="ba-day" key={day}><h2>{day || '날짜 미확인'}<span>{displayed.filter((p) => p.date === day).length}장</span></h2><div className="ba-grid">{displayed.filter((p) => p.date === day).map((p) => <article key={photoKey(p)} className={selected.includes(photoKey(p)) ? 'is-selected' : ''}><Button className="ba-thumb" aria-label={`${p.date} ${label(p.view)} 사진 보기`} onClick={() => setPreview(p)}><Photo photo={p} /></Button><span className="ba-direction">{label(p.view)}</span><label className="ba-select"><input type="checkbox" aria-label={`${p.date} ${label(p.view)} 비교 선택`} checked={selected.includes(photoKey(p))} onChange={(e) => setSelected((old) => e.target.checked ? [...old, photoKey(p)] : old.filter((x) => x !== photoKey(p)))} /></label></article>)}</div></section>)}
        {!displayed.length && <p className="ba-no-results">이 방향의 사진은 아직 없습니다.</p>}
        </> : <div className="ba-empty"><span className="ba-empty-icon"><Images size={32} strokeWidth={1.5} /></span><h2>아직 등록된 사진이 없습니다.</h2><p>첫 사진을 추가하고<br />회원의 변화를 기록해 보세요.</p><Button className="ba-primary" disabled={busy || !!draft} onClick={() => picker.current.click()}><ImagePlus size={18} />사진 추가하기</Button>{(photos[member.id]?.poses || []).length > 0 && <Button onClick={() => setAi(true)}>기존 분석 기록</Button>}</div>}
        {selected.length > 0 && <div className="ba-selection" aria-label="선택 사진 작업"><div><strong>{selected.length}장 선택</strong><Button aria-label="선택 해제" onClick={() => setSelected([])}><X size={18} /></Button></div>{selected.length === 1 && <><Button disabled={!!draft || busy} onClick={() => openEditor(all.find((p) => photoKey(p) === selected[0]))}>편집</Button>{markup && <Button disabled={busy} onClick={() => setMarkupPhoto(all.find((p) => photoKey(p) === selected[0]))}>펜 · 자</Button>}<Button disabled={busy} onClick={() => run(async () => { await onAnalyze(member.id, all.find((p) => photoKey(p) === selected[0])); setAi(true); setMessage('선택 사진으로 분석을 준비했습니다.'); })}>AI 분석</Button><Button className="ba-danger" disabled={busy || !!draft} onClick={() => { if (window.confirm('선택한 사진을 삭제할까요? 분석 결과는 유지됩니다.')) run(async () => { if (await onDelete(member.id, all.find((p) => photoKey(p) === selected[0])) === false) throw new Error('사진 삭제 실패'); setSelected([]); setMessage('사진을 삭제했습니다.'); }); }}>삭제</Button></>}{selected.length === 2 && <Button className="ba-primary" onClick={() => setComparing(true)}>비포애프터 비교</Button>}{selected.length > 2 && <span>비교할 사진 2장을 선택해 주세요.</span>}</div>}
      </>}
      {preview && !editing && <section ref={dialog} className="ba-viewer ba-panel" role="dialog" aria-modal="true" aria-label="사진 상세"><div className="ba-toolbar"><h2>{preview.date} · {label(preview.view)}</h2><Button aria-label="사진 상세 닫기" onClick={() => setPreview(null)}><X size={22} /></Button></div><Photo photo={preview} className="ba-edit-preview" /><div className="ba-toolbar"><Button disabled={!!draft || busy} onClick={() => { openEditor(preview); setPreview(null); }}>편집</Button>{markup && <Button disabled={busy} onClick={() => { setMarkupPhoto(preview); setPreview(null); }}>펜 · 자</Button>}<Button className="ba-primary" onClick={() => { setSelected((old) => old.includes(photoKey(preview)) ? old : [...old, photoKey(preview)]); setPreview(null); }}>사진 선택</Button></div></section>}
      {editing && <section ref={dialog} className="ba-editor ba-panel" role="dialog" aria-modal="true" aria-label="사진 편집"><div className="ba-toolbar"><Button disabled={busy} onClick={cancelEdit}>취소</Button><h2>사진 편집</h2><Button className="ba-primary" disabled={busy || !date} onClick={saveEdit}>저장</Button></div><Photo photo={editing} edits={edit} onTransform={(next) => { setEdit(next); persist(editorValue({ edit: next })).catch(() => setMessage("편집 임시 저장 실패")); }} className="ba-edit-preview" /><details className="ba-metadata"><summary>촬영 정보 · 회원 변경</summary><label>촬영 날짜<input type="date" value={date} onChange={(e) => { setDate(e.target.value); persist(editorValue({ date: e.target.value })).catch(() => setMessage('편집 임시 저장 실패')); }} /></label><label>방향<select value={direction} onChange={(e) => { setDirection(e.target.value); persist(editorValue({ direction: e.target.value })).catch(() => setMessage('편집 임시 저장 실패')); }}>{ALBUM_VIEWS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label><label>회원<select value={owner} onChange={(e) => { setOwner(e.target.value); persist(editorValue({ owner: e.target.value })).catch(() => setMessage('편집 임시 저장 실패')); }}>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
        </details><div className="ba-chips ba-tools">{[['crop', '자르기'], ['rotate', '회전'], ['align', '정렬'], ['brightness', '밝기']].map(([key, title]) => <Button key={key} aria-pressed={tool === key} onClick={() => setTool(key)}>{title}</Button>)}</div>
        {[['crop', '자르기 (가장자리)', 0, 70, 1], ['rotate', '회전 / 수평', -180, 180, 1], ['zoom', '확대', 0.5, 3, 0.05], ['x', '좌우 위치', -50, 50, 1], ['y', '상하 위치', -50, 50, 1], ['brightness', '밝기', 0.3, 2, 0.05]].filter(([key]) => key === tool || (tool === 'align' && ['zoom', 'x', 'y'].includes(key))).map(([key, title, min, max, step]) => <Range key={key} title={title} value={edit[key]} min={min} max={max} step={step} onChange={(v) => { const next = { ...edit, [key]: v }; setEdit(next); persist(editorValue({ edit: next })).catch(() => setMessage('편집 임시 저장 실패')); }} />)}
        <div className="ba-toolbar"><Button onClick={() => { setEdit({ ...DEFAULT_EDIT }); persist(editorValue({ edit: { ...DEFAULT_EDIT } })).catch(() => setMessage('편집 임시 저장 실패')); }}>편집 처음으로</Button></div>
      </section>}
      {/* 펜 · 자 · 화살표 · 손메모 -- 예전 자세 기록의 표시 편집기를 그대로 연다 (App.jsx PostureCanvas).
          본문(body)에 띄운다. 앨범 안(.ba-root 는 isolation)에 두면 아래 탭 막대가 편집기 버튼을 가린다. */}
      {markupPhoto && markup && typeof document !== 'undefined' && createPortal(markup({ photo: markupPhoto, memberId: member.id, onDone: () => setMarkupPhoto(null) }), document.body)}
    </>}
  </div></MarkContext.Provider>;
}
