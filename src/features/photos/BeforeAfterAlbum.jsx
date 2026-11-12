import { useEffect, useRef, useState } from 'react';
import { ALBUM_VIEWS, DEFAULT_EDIT, albumPhotos, chronologicalPair, exifDate, photoKey } from './album-model.js';
import { albumDraft } from './album-drafts.js';
import { drawContained, renderAlbumPhoto } from './album-render.js';
import './album.css';
import { usePhotoGestures } from './photo-gestures.js';

const label = (view) => ALBUM_VIEWS.find(([key]) => key === view)?.[1] || '기타';
const today = () => new Date().toLocaleDateString('sv-SE');
const Button = ({ children, ...props }) => <button type="button" {...props}>{children}</button>;
function Photo({ photo, edits, onTransform, className = '' }) {
  const gestures = usePhotoGestures(edits || photo.albumEdit || DEFAULT_EDIT, onTransform);
  const ref = useRef(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    setError(false);
    renderAlbumPhoto(photo.src, edits || photo.albumEdit, 900).then((c) => {
      if (!active || !ref.current) return;
      ref.current.width = c.width; ref.current.height = c.height;
      ref.current.getContext('2d').drawImage(c, 0, 0);
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [photo.src, photo.albumEdit, edits]);
  return error ? <span>사진을 불러오지 못했습니다. 백업 복원을 확인하세요.</span> : <canvas {...gestures} style={onTransform ? { touchAction: 'none' } : undefined} ref={ref} role="img" aria-label={`${photo.date} ${label(photo.view)} 사진`} className={className} />;
}
function Range({ title, value, min, max, step = 1, onChange }) {
  return <label className="ba-range">{title}<input type="range" aria-label={title} value={value} min={min} max={max} step={step} onChange={(e) => onChange(Number(e.target.value))} /><output>{Number(value).toFixed(step < 1 ? 2 : 0)}</output></label>;
}
function Compare({ photos, initialPhotos, onClose, onExport }) {
  const [pair, setPair] = useState(() => chronologicalPair(initialPhotos));
  const [mode, setMode] = useState('side');
  const [split, setSplit] = useState(50);
  const [target, setTarget] = useState(0);
  const [align, setAlign] = useState([{ zoom: 1, x: 0, y: 0 }, { zoom: 1, x: 0, y: 0 }]);
  const [guides, setGuides] = useState(true);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const ref = useRef(null);
  const gestures = usePhotoGestures(align[target], (next) => setAlign((old) => old.map((p, i) => i === target ? next : p)));
  useEffect(() => {
    let active = true;
    setReady(false);
    Promise.all(pair.map((p) => renderAlbumPhoto(p.src, p.albumEdit))).then((images) => {
      if (!active || !ref.current) return;
      const c = ref.current; c.width = 1200; c.height = 1000;
      const ctx = c.getContext('2d'); ctx.fillStyle = '#15151b'; ctx.fillRect(0, 0, c.width, c.height);
      if (mode === 'side') images.forEach((img, i) => drawContained(ctx, img, i * 600, 50, 600, 900, align[i]));
      else {
        drawContained(ctx, images[0], 0, 50, 1200, 900, align[0]);
        ctx.save(); ctx.beginPath(); ctx.rect(split * 12, 50, 1200 - split * 12, 900); ctx.clip();
        drawContained(ctx, images[1], 0, 50, 1200, 900, align[1]); ctx.restore();
      }
      ctx.fillStyle = '#fff'; ctx.font = '24px sans-serif';
      ctx.fillText(`BEFORE · ${pair[0].date}`, 20, 34); ctx.fillText(`AFTER · ${pair[1].date}`, 620, 34);
      if (guides) { ctx.strokeStyle = '#ff3f8e'; ctx.lineWidth = 2; ctx.setLineDash([10, 10]); [275, 500, 725].forEach((y) => { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(1200, y); ctx.stroke(); }); }
      setReady(true); setError('');
    }).catch(() => { if (active) setError('사진을 불러오지 못했습니다. 원본을 복원한 후 다시 시도하세요.'); });
    return () => { active = false; };
  }, [pair, mode, split, align, guides]);
  return <section className="ba-panel"><div className="ba-toolbar"><h2>비포애프터 비교</h2><Button onClick={onClose}>앨범으로</Button></div>
    <div className="ba-toolbar">{pair.map((p, i) => <label key={i}>{i ? 'AFTER' : 'BEFORE'}<select value={photoKey(p)} onChange={(e) => { const chosen = photos.find((x) => photoKey(x) === e.target.value); setPair((old) => old.map((x, index) => index === i ? chosen : x)); }}>{photos.map((x, index) => <option disabled={photoKey(pair[1 - i]) === photoKey(x)} key={photoKey(x)} value={photoKey(x)}>{x.date} · {label(x.view)} · {index + 1}</option>)}</select></label>)}<Button onClick={() => { setPair(([a, b]) => [b, a]); setAlign(([a, b]) => [b, a]); }}>위치 교체</Button></div>
    {pair[0].view !== pair[1].view && <p role="status">{label(pair[0].view)}과 {label(pair[1].view)} 사진은 정확한 체형 비교가 어려울 수 있습니다.</p>}
    <div className="ba-toolbar"><Button aria-pressed={mode === 'side'} onClick={() => setMode('side')}>나란히</Button><Button aria-pressed={mode === 'overlay'} onClick={() => setMode('overlay')}>겹쳐 보기</Button><label><input type="checkbox" checked={guides} onChange={(e) => setGuides(e.target.checked)} /> 기준선</label></div>
    <canvas {...gestures} style={{ touchAction: 'none' }} ref={ref} className="ba-comparison" role="img" aria-label="비포애프터 비교 이미지" />
    {mode === 'overlay' && <Range title="겹침 슬라이더" value={split} min={0} max={100} onChange={setSplit} />}
    <label>정렬할 사진<select value={target} onChange={(e) => setTarget(Number(e.target.value))}><option value={0}>BEFORE</option><option value={1}>AFTER</option></select></label>
    {[['zoom', '확대 / 축소', 0.5, 3, 0.05], ['x', '좌우 위치', -50, 50, 1], ['y', '상하 위치', -50, 50, 1]].map(([key, title, min, max, step]) => <Range key={key} title={title} value={align[target][key]} min={min} max={max} step={step} onChange={(v) => setAlign((old) => old.map((a, i) => i === target ? { ...a, [key]: v } : a))} />)}
    {error && <p role="alert">{error}</p>}<Button disabled={!ready} onClick={() => onExport(ref.current)}>비교 이미지 저장</Button>
  </section>;
}
export default function BeforeAfterAlbum({ accountId, members, photos, selectedId, onSelect, onImport, onPatch, onDelete, hub, onExport, backupStatus, onRetry, onEnableBackup, onAnalyze }) {
  const [query, setQuery] = useState(''); const [filter, setFilter] = useState('all');
  const [view, setView] = useState('all'); const [oldest, setOldest] = useState(false);
  const [selected, setSelected] = useState([]); const [comparing, setComparing] = useState(false);
  const [ai, setAi] = useState(false); const [editing, setEditing] = useState(null);
  const [edit, setEdit] = useState({ ...DEFAULT_EDIT }); const [date, setDate] = useState(''); const [direction, setDirection] = useState('custom'); const [owner, setOwner] = useState('');
  const [draft, setDraft] = useState(null); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const picker = useRef(null); const writes = useRef(Promise.resolve());
  const member = members.find((m) => m.id === selectedId);
  const all = albumPhotos(photos[selectedId]);
  const persist = (value) => {
    setDraft(value);
    writes.current = writes.current.catch(() => {}).then(() => albumDraft(accountId, value ? 'put' : 'delete', value));
    return writes.current;
  };
  useEffect(() => { let active = true; albumDraft(accountId, 'get').then((value) => { if (active && value) { setDraft(value); setMessage('기기에 보관한 작업을 복구했습니다.'); } }).catch(() => setMessage('임시 저장소를 열지 못했습니다. 저장 공간을 확인하세요.')); return () => { active = false; }; }, [accountId]);
  useEffect(() => { setSelected([]); setComparing(false); setAi(false); setEditing(null); }, [selectedId]);
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
  const displayed = all.filter((p) => view === 'all' || p.view === view).sort((a, b) => oldest ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date));
  return <div className="ba-root">
    <input ref={picker} hidden type="file" accept="image/*" multiple onChange={(e) => { const files = [...e.target.files]; e.target.value = ''; if (files.length) importFiles(files); }} />
    <header className="ba-toolbar"><div><h1>{member ? `${member.name} · 비포애프터` : '비포애프터'}</h1><p>{member ? `최근 ${all[0]?.date || '촬영 없음'} · 총 ${all.length}장` : '회원의 변화를 사진으로 기록하고 비교하세요.'}</p></div>{member && <Button onClick={() => onSelect(null)}>목록</Button>}<Button disabled={busy || !!draft} onClick={() => picker.current.click()}>사진 추가</Button></header>
    {message && <p role="status" className="ba-notice">{message}</p>}
    <div className="ba-toolbar ba-sync"><span>{backupStatus?.state === 'error' ? '동기화 실패 · 기기 사진 유지' : backupStatus?.state === 'backing_up' ? '서버 저장 중 · 기기에 임시 저장됨' : backupStatus?.photoEnabled && backupStatus?.state === 'safe' && !backupStatus?.pendingPhotos ? '서버 저장 완료' : '기기에 임시 저장됨'}</span>{backupStatus?.photoEnabled ? <Button onClick={onRetry}>동기화 재시도</Button> : <Button onClick={onEnableBackup}>사진 백업 설정</Button>}</div>
    {draft?.kind === 'import' && <section className="ba-panel"><h2>사진 {draft.items.length}장 등록</h2><input aria-label="등록할 회원 검색" placeholder="회원 이름 검색" value={query} onChange={(e) => setQuery(e.target.value)} /><select aria-label="등록할 회원" value={draft.memberId} disabled={busy} onChange={(e) => persist({ ...draft, memberId: e.target.value }).catch(() => setMessage('임시 저장 실패'))}><option value="">회원을 선택하세요</option>{members.filter((m) => m.id === draft.memberId || m.name?.includes(query)).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
      {draft.items.map((item, i) => <div className="ba-toolbar" key={`${item.hash}_${i}`}><span>사진 {i + 1}{item.dateSource === 'fallback' ? ' · 촬영일 확인 필요' : ''}</span><input aria-label={`사진 ${i + 1} 촬영 날짜`} type="date" value={item.date} disabled={busy} onChange={(e) => persist({ ...draft, items: draft.items.map((x, n) => n === i ? { ...x, date: e.target.value } : x) }).catch(() => setMessage('임시 저장 실패'))} /><select aria-label={`사진 ${i + 1} 방향`} value={item.view} disabled={busy} onChange={(e) => persist({ ...draft, items: draft.items.map((x, n) => n === i ? { ...x, view: e.target.value } : x) }).catch(() => setMessage('임시 저장 실패'))}>{ALBUM_VIEWS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>)}
      <Button disabled={busy || !draft.memberId || draft.items.some((x) => !x.date)} onClick={() => run(async () => { await writes.current; await onImport(draft); const id = draft.memberId; await persist(null); onSelect(id); setMessage('사진 저장 완료 · AI 분석은 선택 사항입니다.'); })}>사진 저장</Button><Button disabled={busy} onClick={() => { if (window.confirm('등록하지 않은 임시 사진을 버릴까요?')) persist(null).catch(() => setMessage('임시 사진 삭제 실패')); }}>등록 취소</Button></section>}
    {draft?.kind === 'edit' && !editing && <Button onClick={() => { const m = members.find((x) => x.id === draft.memberId); const p = albumPhotos(photos[draft.memberId]).find((x) => x.id === draft.photo.id && x.bucket === draft.photo.bucket); if (!m || !p) { setMessage('초안의 회원 또는 사진에 접근할 수 없습니다.'); return; } if (selectedId !== m.id) { onSelect(m.id); return; } openEditor(p); setEdit(draft.edit); setDate(draft.date); setDirection(draft.direction); setOwner(draft.owner); }}>저장되지 않은 편집 이어하기</Button>}
    {!member ? <><input aria-label="회원 이름 검색" placeholder="회원 이름 검색" value={query} onChange={(e) => setQuery(e.target.value)} /><div className="ba-toolbar">{[['all', '전체 회원'], ['photos', '사진 있음'], ['compare', '비교 가능']].map(([k, l]) => <Button key={k} aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</Button>)}</div><div>{members.filter((m) => m.name?.includes(query)).map((m) => ({ m, items: albumPhotos(photos[m.id]) })).filter(({ items }) => filter === 'all' || items.length >= (filter === 'compare' ? 2 : 1)).map(({ m, items }) => <Button className="ba-member" key={m.id} onClick={() => onSelect(m.id)}>{items[0]?.src && <Photo photo={items[0]} />}<span><strong>{m.name}</strong><small>{items[0]?.date || '촬영 없음'} · {items.length}장 {items.length >= 2 ? '· 비교 가능' : ''}</small></span><span>{items.length ? '앨범 ›' : '사진 추가'}</span></Button>)}</div></> : <>
      <div className="ba-toolbar"><Button onClick={() => { setAi(false); setComparing(false); }}>사진 앨범</Button><Button disabled={selected.length !== 2} onClick={() => { setAi(false); setComparing(true); }}>선택한 2장 비교</Button><Button onClick={() => { setAi(true); setComparing(false); }}>AI 분석 · 기존 기록</Button>{selected.length === 1 && <Button onClick={() => run(async () => { await onAnalyze(member.id, all.find((p) => photoKey(p) === selected[0])); setAi(true); setMessage('선택한 사진으로 분석을 준비했습니다. 구도와 자세에 따라 정확도가 달라집니다.'); })}>선택 사진 AI 분석</Button>}</div>
      {ai ? <><p>AI는 선택 기능입니다. 촬영 자세와 구도가 다르면 결과가 부정확할 수 있습니다.</p>{hub(member.id, null)}</> : comparing ? <Compare photos={all} initialPhotos={all.filter((p) => selected.includes(photoKey(p)))} onClose={() => setComparing(false)} onExport={onExport} /> : <><div className="ba-toolbar"><select aria-label="촬영 방향 필터" value={view} onChange={(e) => setView(e.target.value)}><option value="all">모든 방향</option>{ALBUM_VIEWS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select><select aria-label="사진 정렬" value={String(oldest)} onChange={(e) => setOldest(e.target.value === 'true')}><option value="false">최신 순</option><option value="true">오래된 순</option></select><span>{selected.length}/2 선택</span></div>
        {!all.length && <p>사진 한 장부터 시작하세요. 갤러리에서 여러 장을 함께 가져올 수 있습니다.</p>}
        {[...new Set(displayed.map((p) => p.date))].map((day) => <section key={day}><h2>{day || '날짜 미확인'}</h2><div className="ba-grid">{displayed.filter((p) => p.date === day).map((p) => <article key={photoKey(p)}><label><input type="checkbox" aria-label={`${p.date} ${label(p.view)} 비교 선택`} checked={selected.includes(photoKey(p))} disabled={!selected.includes(photoKey(p)) && selected.length >= 2} onChange={(e) => setSelected((old) => e.target.checked ? [...old, photoKey(p)] : old.filter((x) => x !== photoKey(p)))} />{label(p.view)}</label><Button className="ba-thumb" onClick={() => { if (!draft) openEditor(p); else setMessage('기존 임시 작업을 먼저 완료하세요.'); }}><Photo photo={p} /></Button><Button disabled={!!draft || busy} onClick={() => openEditor(p)}>편집</Button></article>)}</div></section>)}</>}
      {editing && <section className="ba-editor ba-panel"><div className="ba-toolbar"><h2>사진 편집</h2><Button disabled={busy} onClick={() => setEditing(null)}>닫기</Button></div><Photo photo={editing} edits={edit} onTransform={(next) => { setEdit(next); persist(editorValue({ edit: next })).catch(() => setMessage("편집 임시 저장 실패")); }} className="ba-edit-preview" /><label>촬영 날짜<input type="date" value={date} onChange={(e) => { setDate(e.target.value); persist(editorValue({ date: e.target.value })).catch(() => setMessage('편집 임시 저장 실패')); }} /></label><label>방향<select value={direction} onChange={(e) => { setDirection(e.target.value); persist(editorValue({ direction: e.target.value })).catch(() => setMessage('편집 임시 저장 실패')); }}>{ALBUM_VIEWS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label><label>회원<select value={owner} onChange={(e) => { setOwner(e.target.value); persist(editorValue({ owner: e.target.value })).catch(() => setMessage('편집 임시 저장 실패')); }}>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
        {[['crop', '자르기 (가장자리)', 0, 70, 1], ['rotate', '회전 / 수평', -180, 180, 1], ['zoom', '확대', 0.5, 3, 0.05], ['x', '좌우 위치', -50, 50, 1], ['y', '상하 위치', -50, 50, 1], ['brightness', '밝기', 0.3, 2, 0.05]].map(([key, title, min, max, step]) => <Range key={key} title={title} value={edit[key]} min={min} max={max} step={step} onChange={(v) => { const next = { ...edit, [key]: v }; setEdit(next); persist(editorValue({ edit: next })).catch(() => setMessage('편집 임시 저장 실패')); }} />)}
        <div className="ba-toolbar"><Button onClick={() => { setEdit({ ...DEFAULT_EDIT }); persist(editorValue({ edit: { ...DEFAULT_EDIT } })).catch(() => setMessage('편집 임시 저장 실패')); }}>원본 복원</Button><Button disabled={busy || !date} onClick={saveEdit}>편집 저장</Button><Button disabled={busy} onClick={() => { if (window.confirm('이 사진을 삭제할까요? 연결된 분석 결과는 유지됩니다.')) run(async () => { if (await onDelete(member.id, editing) === false) throw new Error('사진 삭제 실패'); await persist(null); setEditing(null); setSelected([]); setMessage('사진을 삭제했습니다.'); }); }}>사진 삭제</Button></div>
      </section>}
    </>}
  </div>;
}
