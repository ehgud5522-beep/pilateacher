import { captureShareCard } from './share-card-payload.js';
import { sharingMessage, logSharingFailure } from './sharing-errors.js';
import TeacherPhotoSharing from './TeacherPhotoSharing.jsx';
import { photoFailureLabel } from '../backup/photo-errors.js';
import { useEffect, useRef, useState } from 'react';
import { ALBUM_PARTS, ALBUM_VIEWS, DEFAULT_EDIT, albumGroup, albumLabel as photoLabel, albumPhotos, chronologicalPair, exifDate, ghostCandidate, photoKey, suggestPair } from './album-model.js';
import { memberAppName, shareBadge, shareBlocker, shareState as normalShareState } from './share-readiness.js';
import { albumDraft } from './album-drafts.js';
import { renderAlbumPhoto } from './album-render.js';
import './album.css';
import { ArrowLeft, Camera, ChevronRight, Copy, ImageOff, ImagePlus, Images, Search, Sparkles, Wand2, X } from 'lucide-react';
import { usePhotoGestures } from './photo-gestures.js';
import { createContext, useContext } from 'react';
import { createPortal } from 'react-dom';
import { CARD_ACCENTS, CARD_THEMES, COMMENT_MAX, brandFor, cardStyle, drawComparisonCard } from './comparison-card.js';
/* 카드 꾸미기는 이 기기에 기억한다 -- 강사마다 한 번 고르면 다음 카드도 같은 색. 못 읽으면 기본값(흰색 · 핫핑크). */
const CARD_STYLE_KEY = 'pilateacher.beforeAfter.cardStyle.v1';
const readCardStyle = () => { try { return cardStyle(JSON.parse(globalThis.localStorage?.getItem(CARD_STYLE_KEY) || 'null')); } catch { return cardStyle(null); } };
const writeCardStyle = (value) => { try { globalThis.localStorage?.setItem(CARD_STYLE_KEY, JSON.stringify(value)); } catch { /* 기억 못 해도 이번 카드는 그대로 */ } };
import { ALIGN_ERROR, alignError, alignMessage, autoAlign, bodyFrame } from './auto-align.js';

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

const today = () => new Date().toLocaleDateString('sv-SE');
/* 앨범은 날짜로 끊지 않고 한 판으로 잇는다 (2026-11-15 대표: "배열이 왼쪽으로 쏠려 있음").
   날마다(또는 달마다) 줄을 끊으면 한 번에 한 장 찍는 회원은 줄마다 사진 하나만 왼쪽에 붙고 오른쪽이 빈다 --
   실제로 대부분이 그렇게 찍는다. 날짜는 사진 위에 쓴다. */
const shortDate = (date) => { const [y, m, d] = String(date || '').slice(0, 10).split('-'); return y && m && d ? `${y.slice(2)}.${m}.${d}` : '날짜 미확인'; };
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
  return error ? <span className={`ba-photo-error ${className}`} role="img" aria-label="사진을 불러오지 못했습니다. 백업 복원을 확인하세요." title="사진을 불러오지 못했습니다. 백업 복원을 확인하세요."><ImageOff size={20} strokeWidth={1.6} aria-hidden="true" /><span>사진 없음</span></span> : <canvas {...gestures} style={onTransform ? { touchAction: 'none' } : undefined} ref={ref} role="img" aria-label={`${photo.date} ${photoLabel(photo)} 사진`} className={className} />;
}
function Range({ title, value, min, max, step = 1, onChange }) {
  return <label className="ba-range">{title}<input type="range" aria-label={title} value={value} min={min} max={max} step={step} onChange={(e) => onChange(Number(e.target.value))} /><output>{Number(value).toFixed(step < 1 ? 2 : 0)}</output></label>;
}
function Compare({ photos, initialPhotos, onClose, onExport, onShare, brand, blocker, detectPose, onAlignLog }) {
  const draw = useContext(MarkContext);
  const layout = useRef(null);
  const [auto, setAuto] = useState({ state: 'idle', text: '', before: null });
  const [copied, setCopied] = useState('');
  /* 복사가 막힌 기기(권한 · 옛 웹뷰)에서는 문구를 펼쳐 보여 준다 -- 길게 눌러 복사할 수 있게. */
  const copyGuide = async () => {
    try { await navigator.clipboard.writeText(blocker.message); setCopied('done'); }
    catch { setCopied('manual'); }
  };
  const [images, setImages] = useState(null);
  const [comment, setComment] = useState('');
  const [pair, setPair] = useState(() => chronologicalPair(initialPhotos));
  const [mode, setMode] = useState('side');
  const [split, setSplit] = useState(50);
  const [target, setTarget] = useState(0);
  const [align, setAlign] = useState([{ zoom: 1, x: 0, y: 0 }, { zoom: 1, x: 0, y: 0 }]);
  const [guides, setGuides] = useState(false);
  const [look, setLook] = useState(readCardStyle);
  const changeLook = (patchValue) => setLook((old) => { const next = cardStyle({ ...old, ...patchValue }); writeCardStyle(next); return next; });
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
    layout.current = drawComparisonCard(ref.current, { images, pair, mode, align, split, guides, brand, comment, style: look });
    setReady(true);
  }, [images, pair, mode, split, align, guides, brand, comment, look]);
  const swap = () => { setPair(([x, y]) => [y, x]); setAlign(([x, y]) => [y, x]); setAuto({ state: 'idle', text: '', before: null }); };
  /* 자동 맞춤: 기기 안에서 두 사진의 자세 점을 찾아 키와 자리를 맞춘다 (auto-align.js). 사진은 밖으로 나가지 않는다.
     실패해도 지금 맞춰 둔 값은 건드리지 않는다. 성공하면 [되돌리기] 로 직전 값으로 돌아갈 수 있다. */
  const runAuto = async () => {
    if (!images || !layout.current || auto.state === 'busy') return;
    setAuto({ state: 'busy', text: '', before: null });
    const started = Date.now();
    try {
      const frames = [];
      for (let i = 0; i < images.length; i++) {
        let landmarks;
        try { landmarks = await detectPose(images[i]); }
        catch (cause) { throw alignError(ALIGN_ERROR.MODEL, i, cause); }
        try { frames.push({ frame: bodyFrame(landmarks), width: images[i].width, height: images[i].height }); }
        catch (e) { throw alignError(e.code || ALIGN_ERROR.UNKNOWN, i, e); }
      }
      const result = autoAlign(frames, layout.current);
      const before = align;
      setAlign(result.align);
      const basis = result.basis === 'full' ? '키' : '몸통 길이';
      setAuto({ state: 'done', before, text: result.exact ? `두 사진의 ${basis}와 위치를 맞췄어요. 어긋나 보이면 사진을 끌어 고치세요.` : `두 사진의 ${basis}를 최대한 맞췄어요. 찍은 구도 차이가 커서 조금 어긋날 수 있어요 -- 사진을 끌어 고치세요.` });
      onAlignLog?.('album_auto_align_done', { basis: result.basis, exact: result.exact, ms: Date.now() - started });
    } catch (e) {
      setAuto({ state: 'failed', text: alignMessage(e), before: null });
      onAlignLog?.('album_auto_align_failed', { errorCode: e?.code || ALIGN_ERROR.UNKNOWN, photoIndex: e?.index ?? -1, ms: Date.now() - started }, e?.cause || e);
    }
  };
  const setAlignValue = (key, value) => setAlign((old) => old.map((item, i) => i === target ? { ...item, [key]: value } : item));
  const moved = align[target].zoom !== 1 || align[target].x !== 0 || align[target].y !== 0;
  /* 순서 (2026-11-15): 카드 → 보는 방식 → 사진 맞추기 → 코멘트 → 내보내기. 위에서 아래로 한 번에 끝난다.
     전에는 맞출 사진을 접힌 칸 안의 선택 상자로 골라야 했다 -- 이제 BEFORE · AFTER 를 눌러 고르고 사진을 바로 끈다. */
  return <section className="ba-compare-page"><div className="ba-toolbar"><Button aria-label="앨범으로" onClick={onClose}><ArrowLeft size={22} /></Button><h2>변화 카드</h2></div>
    <ol className="ba-steps" aria-label="카드 만드는 순서"><li>사진 확인</li><li>한마디</li><li>{onShare && !blocker ? '보내기' : '저장'}</li></ol>
    {albumGroup(pair[0]) !== albumGroup(pair[1]) && <p role="status" className="ba-notice">{photoLabel(pair[0])}과 {photoLabel(pair[1])} 사진은 정확한 체형 비교가 어려울 수 있습니다.</p>}
    <canvas {...gestures} style={{ touchAction: 'none' }} ref={ref} className="ba-comparison" role="img" aria-label="비포애프터 비교 이미지" />
    <div className="ba-compare-controls">
      <div className="ba-segment" role="group" aria-label="비교 방식"><Button aria-pressed={mode === 'side'} onClick={() => setMode('side')}>나란히</Button><Button aria-pressed={mode === 'overlay'} onClick={() => setMode('overlay')}>슬라이더</Button></div>
      <Button aria-pressed={guides} onClick={() => setGuides((v) => !v)}>기준선</Button>
      <Button onClick={swap}>좌우 바꾸기</Button>
    </div>
    {mode === 'overlay' && <Range title="겹침 위치" value={split} min={0} max={100} onChange={setSplit} />}
    <div className="ba-align">
      <div className="ba-align-row"><span>맞출 사진</span><div className="ba-segment" role="group" aria-label="맞출 사진">{['BEFORE', 'AFTER'].map((name, i) => <Button key={name} aria-pressed={target === i} onClick={() => setTarget(i)}>{name}</Button>)}</div>
        <Button className="ba-text" disabled={!moved} onClick={() => setAlign((old) => old.map((item, i) => i === target ? { zoom: 1, x: 0, y: 0 } : item))}>처음으로</Button></div>
      {detectPose && <div className="ba-auto"><Button className="ba-auto-run" disabled={!ready || auto.state === 'busy'} onClick={runAuto}><Wand2 size={16} aria-hidden="true" />{auto.state === 'busy' ? '맞추는 중…' : '자동으로 맞추기'}</Button>
        {auto.state === 'done' && auto.before && <Button className="ba-text" onClick={() => { setAlign(auto.before); setAuto({ state: 'idle', text: '', before: null }); }}>되돌리기</Button>}
        {auto.state === 'busy' && <small role="status">처음에는 자세 인식 도구를 받느라 조금 걸려요.</small>}
        {auto.text && <small role={auto.state === 'failed' ? 'alert' : 'status'} className={auto.state === 'failed' ? 'is-failed' : ''}>{auto.text}</small>}</div>}
      <small>고른 사진을 카드 위에서 손가락으로 끌고, 두 손가락으로 벌려 크기를 맞추세요.</small>
      <details><summary>숫자로 세밀하게 맞추기</summary>
        {[['zoom', '확대 / 축소', 0.5, 3, 0.05], ['x', '좌우 위치', -50, 50, 1], ['y', '상하 위치', -50, 50, 1]].map(([key, title, min, max, step]) => <Range key={key} title={title} value={align[target][key]} min={min} max={max} step={step} onChange={(v) => setAlignValue(key, v)} />)}
      </details>
      <details><summary>비교 사진 바꾸기</summary><div className="ba-pair">{pair.map((p, i) => <label key={i}>{i ? 'AFTER' : 'BEFORE'}<select value={photoKey(p)} onChange={(e) => { const chosen = photos.find((x) => photoKey(x) === e.target.value); setPair((old) => old.map((x, index) => index === i ? chosen : x)); }}>{photos.map((x, index) => <option disabled={photoKey(pair[1 - i]) === photoKey(x)} key={photoKey(x)} value={photoKey(x)}>{x.date} · {photoLabel(x)} · {index + 1}</option>)}</select></label>)}</div></details>
    </div>
    <div className="ba-look" aria-label="카드 꾸미기">
      <div className="ba-look-row"><span>바탕</span><div className="ba-segment" role="group" aria-label="카드 바탕">{Object.entries(CARD_THEMES).map(([key, theme]) => <Button key={key} aria-pressed={look.theme === key} onClick={() => changeLook({ theme: key })}><i className="ba-look-chip" style={{ background: theme.bg }} aria-hidden="true" />{theme.label}</Button>)}</div></div>
      <div className="ba-look-row"><span>{brand ? '로고 색' : '포인트 색'}</span><div className="ba-swatches" role="group" aria-label={brand ? '로고 색' : '포인트 색'}>{CARD_ACCENTS.map(([color, name]) => <button type="button" key={color} className="ba-swatch" aria-pressed={look.accent === color} aria-label={name} title={name} onClick={() => changeLook({ accent: color })} style={{ background: color }} />)}</div></div>
    </div>
    <label className="ba-comment"><span>강사 코멘트 <small>{comment.length}/{COMMENT_MAX}</small></span><textarea rows={3} maxLength={COMMENT_MAX} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="이번 변화에 대한 한마디 · 비교 이미지 아래에 함께 저장돼요" /><small>회원 이름이나 연락처는 적지 않는 것을 권해요. 이미지는 앱 밖으로 나가면 지울 수 없어요.</small></label>
    {error && <p role="alert" className="ba-notice">{error}</p>}
    {onShare && blocker && <div className="ba-share-gate" role="status"><strong>{blocker.title}</strong><p>{blocker.help}</p>
      {blocker.message && <Button onClick={copyGuide}><Copy size={15} aria-hidden="true" />회원에게 보낼 안내 문구 복사</Button>}
      {copied === 'done' && <small>복사했어요. 카카오톡 · 문자에 붙여넣어 보내 주세요.</small>}
      {copied === 'manual' && <textarea readOnly rows={3} aria-label="회원에게 보낼 안내 문구" value={blocker.message} onFocus={(e) => e.target.select()} />}
    </div>}
    <div className="ba-compare-actions">
      <Button className={onShare && !blocker ? 'ba-export' : 'ba-primary ba-export'} disabled={!ready} onClick={() => onExport(ref.current)}>이미지 저장</Button>
      {onShare && !blocker && <Button className="ba-primary ba-export" disabled={!ready} onClick={async () => { try { onShare(await captureShareCard(ref.current, pair, comment)); } catch (e) { logSharingFailure(e, { action: "capture", appBuild: globalThis.window?.PILATEACHER_VER }); setError(sharingMessage(e)); } }}>회원에게 공유</Button>}
    </div>
  </section>;
}
/* 센터 회원과 연결되지 않은 사진 (App.jsx unlinkedPhotos). 백업이 안 되고 앨범에도 안 보이던 사진.
   대표 · 총괄: 사진을 보고 회원을 지정하거나 백업에서 뺀다. 강사: 수만 보고 백업에서만 뺄 수 있다
   (담당이 바뀌어 권한이 회수된 회원 사진일 수 있어 보여 주지 않는다). 지우는 버튼은 없다. */
function UnlinkedPhotos({ entries, ownerView, members, onAssign, onExclude, busy, run, notify }) {
  const [open, setOpen] = useState(false);
  const [targets, setTargets] = useState({});
  const active = entries.filter((e) => e.photo.backupExcluded !== true);
  if (!entries.length || (!active.length && !open)) return null;
  const keyOf = (e) => `${e.memberKey}:${photoKey(e.photo)}`;
  return <section className="ba-unlinked" aria-label="센터 회원과 연결되지 않은 사진">
    <div className="ba-unlinked-head"><div><strong>센터 회원과 연결되지 않은 사진 {active.length}장</strong><small>회원이 지정되지 않아 백업되지 않아요. 사진은 기기에 그대로 있어요.</small></div>
      {ownerView ? <Button onClick={() => setOpen((v) => !v)}>{open ? '닫기' : '확인'}</Button>
        : <Button disabled={busy || !active.length} onClick={() => { if (window.confirm(`연결되지 않은 사진 ${active.length}장을 백업에서 뺄까요? 사진은 기기에 그대로 남아요.`)) run(async () => { if (await onExclude(active) === false) throw new Error('백업 제외 저장 실패'); notify('백업에서 뺐습니다. 사진은 기기에 그대로 있어요.'); }); }}>백업에서 빼기</Button>}</div>
    {!ownerView && <small className="ba-unlinked-note">담당이 바뀐 회원의 사진일 수 있어요. 회원을 다시 지정하려면 대표님께 문의해 주세요.</small>}
    {ownerView && open && <ul>{entries.map((e) => <li key={keyOf(e)} className={e.photo.backupExcluded ? 'is-excluded' : ''}>
      <span className="ba-unlinked-thumb">{e.photo.src ? <Photo photo={e.photo} /> : <ImageOff size={18} aria-hidden="true" />}</span>
      <div className="ba-unlinked-body"><span>{e.photo.date || '날짜 미확인'} · {photoLabel(e.photo)}{e.photo.backupExcluded ? ' · 백업에서 뺌' : ''}</span>
        <small>예전 회원 기록{e.oldName ? ` · ${e.oldName}` : ''}</small>
        <div className="ba-unlinked-actions"><select aria-label="옮길 센터 회원" value={targets[keyOf(e)] || ''} onChange={(ev) => setTargets((t) => ({ ...t, [keyOf(e)]: ev.target.value }))}><option value="">회원 선택</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
          <Button className="ba-primary" disabled={busy || !targets[keyOf(e)]} onClick={() => run(async () => { if (await onAssign(e.memberKey, e.photo, targets[keyOf(e)]) === false) throw new Error('사진을 옮기지 못했습니다. 사진은 그대로입니다.'); notify('사진을 옮겼습니다. 백업을 다시 시도합니다.'); })}>옮기기</Button>
          {!e.photo.backupExcluded && <Button disabled={busy} onClick={() => run(async () => { if (await onExclude([e]) === false) throw new Error('백업 제외 저장 실패'); notify('백업에서 뺐습니다. 사진은 기기에 그대로 있어요.'); })}>백업에서 빼기</Button>}</div></div>
    </li>)}</ul>}
  </section>;
}
export default function BeforeAfterAlbum({ accountId, members, photos, selectedId, onSelect, onImport, onPatch, onDelete, hub, onExport, backupStatus, onRetry, onAnalyze, sharingApi, organizationId, markup, drawMarks, detectPose, onAlignLog, capture, unlinked = [], unlinkedOwnerView = false, onAssignUnlinked, onExcludeUnlinked }) {
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
  /* 이 회원에게 보낼 수 있는지 앨범을 열 때 미리 묻는다. 못 읽으면 'unknown' -- 막지 않고 지금까지처럼 둔다. */
  const [shareState, setShareState] = useState('');
  const memberKey = member?.id || '', memberClientId = member?.orgClientId || '';
  useEffect(() => {
    setShareState('');
    if (!sharingApi || !sharingEnabled || !memberKey) return undefined;
    if (!memberClientId) { setShareState('not_linked'); return undefined; }
    let active = true;
    sharingApi({ action: 'teacherConsent', organizationId, clientId: memberClientId })
      .then((r) => { if (active) setShareState(normalShareState(r?.status)); })
      .catch((e) => { if (active) { setShareState('unknown'); logSharingFailure(e, { action: 'teacherConsent', appBuild: globalThis.window?.PILATEACHER_VER }); } });
    return () => { active = false; };
  }, [sharingApi, sharingEnabled, memberKey, memberClientId, organizationId, sharing]);
  const badge = sharingEnabled ? shareBadge(shareState) : null;
  /* 지난 사진에 맞춰 찍기. 겹쳐 보일 사진은 앨범 편집(자르기 · 회전)을 적용한 모습이다 -- 카드에 들어갈 모습과 같아야 맞춘 보람이 있다.
     펜 · 자 표시는 뺀다. 겹칠 사진을 못 읽어도 촬영은 연다(겹침 없이). */
  const [shooting, setShooting] = useState(null);
  const [part, setPart] = useState('');
  const ghostBase = capture ? ghostCandidate(all) : null;
  const startShot = async (p) => {
    let src = '';
    try { const [e] = renderInput(p, null, p.albumEdit); src = (await renderAlbumPhoto(p.src, e, 1080)).toDataURL('image/jpeg', 0.85); }
    catch { setMessage('지난 사진을 불러오지 못해 겹쳐 보기 없이 촬영합니다.'); }
    setPreview(null);
    setShooting({ view: p.view, part: p.part || '', ghost: src ? { src, label: shortDate(p.date) } : null });
  };
  /* 찍은 사진은 회원 · 날짜(오늘) · 방향(겹친 사진과 같은 방향)을 이미 알므로 확인 칸 없이 바로 저장한다.
     저장에 실패하면 false -- 촬영 화면이 방금 찍은 사진을 쥔 채 남아 다시 시도할 수 있다. */
  const saveShot = async (blob, shotView) => {
    try {
      const file = new File([blob], `capture_${Date.now()}.jpg`, { type: blob.type || 'image/jpeg' });
      const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
      const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
      await onImport({ kind: 'import', memberId: member.id, items: [{ file, hash, date: today(), dateSource: 'capture', view: shotView, part: shooting?.part || '' }] });
      notify('사진을 저장했습니다. [변화 카드 만들기]로 바로 비교해 보세요.');
      return true;
    } catch (error) { setMessage(error?.message || '사진 저장 실패 · 촬영 화면에서 다시 시도해 주세요.'); return false; }
  };
  const startCard = () => { const pair = suggestPair(all); if (pair.length === 2) { setSelected(pair.map(photoKey)); setComparing(true); } };
  const persist = (value) => {
    setDraft(value);
    writes.current = writes.current.catch(() => {}).then(() => albumDraft(accountId, value ? 'put' : 'delete', value));
    return writes.current;
  };
  useEffect(() => { let active = true; albumDraft(accountId, 'get').then((value) => { if (active && value) { setDraft(value); setMessage('기기에 보관한 작업을 복구했습니다.'); } }).catch(() => setMessage('임시 저장소를 열지 못했습니다. 저장 공간을 확인하세요.')); return () => { active = false; }; }, [accountId]);
  useEffect(() => { setSelected([]); setPreview(null); setComparing(false); setAi(false); setEditing(null); }, [selectedId]);
  /* 잘 끝났다는 알림은 4초 뒤 스스로 걷힌다 -- 남아 있으면 사진 판을 밀어 내린다. 실패 · 안내는 그대로 둔다. */
  const notifyTimer = useRef(0);
  const notify = (text) => {
    setMessage(text);
    clearTimeout(notifyTimer.current);
    notifyTimer.current = setTimeout(() => setMessage((current) => current === text ? '' : current), 4000);
  };
  useEffect(() => () => clearTimeout(notifyTimer.current), []);
  /* 사진 상세 · 편집 창은 본문(body)에 띄운다. 앨범 안(.ba-root 는 isolation)에 두면 아래 탭 막대(z-40)가
     창의 아랫부분을 덮는다 -- [사진 선택] 버튼이 잘린 원인. 클래스는 그대로 쓰도록 ba-root 로 한 겹 감싼다. */
  const layer = (node) => typeof document === 'undefined' ? node : createPortal(<div className="ba-root ba-layer">{node}</div>, document.body);
  /* 선택 띠는 머리 띠 바로 아래에 붙는다. 머리 띠 높이(이름 · 표시 줄)는 기기마다 달라 재서 넘긴다. */
  const rootRef = useRef(null), headerRef = useRef(null);
  useEffect(() => {
    const header = headerRef.current, root = rootRef.current;
    if (!header || !root || typeof ResizeObserver === 'undefined') return undefined;
    const sync = () => root.style.setProperty('--ba-head', `${Math.round(header.getBoundingClientRect().height)}px`);
    sync();
    const observer = new ResizeObserver(sync); observer.observe(header);
    return () => observer.disconnect();
  }, [comparing, selectedId]);
  /* 상세에서 [사진 선택] 을 누르면 그 사진을 화면 가운데로 옮기고 잠깐 반짝인다. 움직임 줄이기 설정이면 바로 옮긴다. */
  const tileRefs = useRef(new Map());
  const [focusKey, setFocusKey] = useState(''), [flashKey, setFlashKey] = useState('');
  /* 앨범 판(.ba-root)을 직접 굴린다. scrollIntoView 의 부드러운 이동은 웹뷰에 따라 시작도 안 하고 멈춘다 --
     그래서 부드럽게 굴리되 0.7초 안에 도착하지 못했으면 그 자리로 바로 옮긴다. 어느 쪽이든 사진은 화면 가운데에 온다. */
  useEffect(() => {
    if (!focusKey) return undefined;
    const tile = tileRefs.current.get(focusKey), scroller = rootRef.current;
    setFlashKey(focusKey); setFocusKey('');
    if (!tile || !scroller) return undefined;
    const box = tile.getBoundingClientRect(), frame = scroller.getBoundingClientRect();
    const top = Math.max(0, Math.min(scroller.scrollHeight - scroller.clientHeight,
      Math.round(scroller.scrollTop + (box.top + box.height / 2) - (frame.top + frame.height / 2))));
    const still = globalThis.window?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (typeof scroller.scrollTo === 'function') scroller.scrollTo({ top, behavior: still ? 'auto' : 'smooth' }); else scroller.scrollTop = top;
    const arrive = setTimeout(() => { if (Math.abs(scroller.scrollTop - top) > 2) scroller.scrollTop = top; }, 700);
    return () => clearTimeout(arrive);
  }, [focusKey]);
  // 반짝임은 따로 끈다 -- 위 효과가 focusKey 를 비우며 다시 돌 때 끄는 타이머까지 지우지 않게.
  useEffect(() => {
    if (!flashKey) return undefined;
    const timer = setTimeout(() => setFlashKey(''), 1100);
    return () => clearTimeout(timer);
  }, [flashKey]);
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
  const openEditor = (p) => { setEditing(p); setEdit({ ...DEFAULT_EDIT, ...p.albumEdit }); setDate(p.date || today()); setDirection(p.view); setPart(p.part || ''); setOwner(member.id); };
  const editorValue = (changes = {}) => ({ kind: 'edit', memberId: member.id, photo: { id: editing.id, bucket: editing.bucket }, edit, date, direction, part, owner, ...changes });
  const saveEdit = () => run(async () => { if (owner !== member.id && !window.confirm("연결된 촬영 세트·분석 결과·비교 기록을 함께 이동합니다. 계속할까요?")) { setMessage("이동을 취소했습니다."); return; } await writes.current; if (await onPatch(member.id, editing, { albumEdit: edit, albumDate: date, albumView: direction, albumPart: direction === 'custom' ? part : '' }, owner) === false) throw new Error('저장 실패 · 편집 초안을 보관했습니다.'); await persist(null); setEditing(null); notify('기기에 저장했습니다.'); });
  /* 취소는 편집 초안도 지운다. 전에는 창만 닫고 초안을 남겨서, 초안이 있는 동안 모든 [편집]이
     잠겼다 -- "편집이 한 번밖에 안 된다" 의 원인. 바꾼 것이 있으면 버릴지 먼저 묻는다. */
  const cancelEdit = () => {
    if (!editing) return;
    const start = { ...DEFAULT_EDIT, ...editing.albumEdit };
    const dirty = Object.keys(start).some((k) => Number(edit[k]) !== Number(start[k]))
      || date !== (editing.date || today()) || direction !== editing.view || part !== (editing.part || '') || owner !== member?.id;
    if (dirty && !window.confirm('저장하지 않은 편집을 버릴까요?')) return;
    persist(null).catch(() => setMessage('편집 초안을 지우지 못했습니다. 다시 시도해 주세요.'));
    setEditing(null);
  };
  cancelEditRef.current = cancelEdit;
  const displayed = all.filter((p) => view === 'all' || p.view === view || albumGroup(p) === view).sort((a, b) => oldest ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date));
  if (sharing && member) return <div className="ba-root"><TeacherPhotoSharing api={sharingApi} organizationId={organizationId} member={member} card={sharing.card} onClose={() => setSharing(null)} /></div>;
  return <MarkContext.Provider value={drawMarks || null}><div ref={rootRef} className="ba-root">
    <input ref={picker} hidden type="file" accept="image/*" multiple onChange={(e) => { const files = [...e.target.files]; e.target.value = ''; if (files.length) importFiles(files); }} />
    {!comparing && <header ref={headerRef} className="ba-header">{member && <Button className="ba-icon" aria-label="회원 목록으로" onClick={() => onSelect(null)}><ArrowLeft size={22} /></Button>}<div>{member && <span className="ba-eyebrow">비포애프터</span>}<h1>{member ? member.name : '비포애프터'}</h1><p>{member ? `최근 촬영 ${all[0]?.date || '없음'} · ${all.length}장` : '회원의 변화를 사진으로 기록하세요.'}{member && badge && <span className={`ba-ready is-${badge.tone}`}>{badge.label}</span>}</p></div><Button className="ba-icon ba-primary" aria-label="사진 추가" disabled={busy || !!draft} onClick={() => picker.current.click()}><ImagePlus size={16} aria-hidden="true" />사진 추가</Button></header>}
    {message && !comparing && <p role="status" className="ba-notice">{message}</p>}
    {(backupStatus?.state === 'error' || backupStatus?.photoFailures?.length > 0) && <div className="ba-sync" role="status"><div>
      <p>이번 처리 성공 {backupStatus.processedPhotos || 0}장 · 실패 {backupStatus.photoFailures?.length || 0}장 · 기기 사진은 유지됩니다.</p>
      {(backupStatus.photoFailures || []).map((failure, index) => <p key={index}>사진 {failure.photoIdPrefix || '식별 불가'} · {photoFailureLabel(failure)} · {failure.stage}</p>)}
      {backupStatus.batchFailure && <p>백업 기록 저장 · {photoFailureLabel(backupStatus.batchFailure)}</p>}
      {!backupStatus.photoFailures?.length && !backupStatus.batchFailure && <p>실패 원인 확인 필요 (unknown)</p>}
    </div><Button onClick={onRetry}>다시 시도</Button></div>}
    {draft?.kind === 'import' && <section className="ba-panel"><h2>사진 {draft.items.length}장 등록</h2><input aria-label="등록할 회원 검색" placeholder="회원 이름 검색" value={query} onChange={(e) => setQuery(e.target.value)} /><select aria-label="등록할 회원" value={draft.memberId} disabled={busy} onChange={(e) => persist({ ...draft, memberId: e.target.value }).catch(() => setMessage('임시 저장 실패'))}><option value="">회원을 선택하세요</option>{members.filter((m) => m.id === draft.memberId || m.name?.includes(query)).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
      {draft.items.map((item, i) => <div className="ba-toolbar ba-import-row" key={`${item.hash}_${i}`}><ImportPreview item={item} /><span>사진 {i + 1}{item.dateSource === 'fallback' ? ' · 촬영일 확인 필요' : ''}</span><input aria-label={`사진 ${i + 1} 촬영 날짜`} type="date" value={item.date} disabled={busy} onChange={(e) => persist({ ...draft, items: draft.items.map((x, n) => n === i ? { ...x, date: e.target.value } : x) }).catch(() => setMessage('임시 저장 실패'))} /><select aria-label={`사진 ${i + 1} 방향`} value={item.view} disabled={busy} onChange={(e) => persist({ ...draft, items: draft.items.map((x, n) => n === i ? { ...x, view: e.target.value } : x) }).catch(() => setMessage('임시 저장 실패'))}>{ALBUM_VIEWS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        {/* 방향이 "기타" 면 어느 부위인지 물어본다. 정하지 않아도 저장된다. */}
        {item.view === 'custom' && <select className="ba-import-part" aria-label={`사진 ${i + 1} 부위`} value={item.part || ''} disabled={busy} onChange={(e) => persist({ ...draft, items: draft.items.map((x, n) => n === i ? { ...x, part: e.target.value } : x) }).catch(() => setMessage('임시 저장 실패'))}><option value="">부위 (정하지 않음)</option>{ALBUM_PARTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}</div>)}
      <Button disabled={busy || !draft.memberId || draft.items.some((x) => !x.date)} onClick={() => run(async () => { await writes.current; await onImport(draft); const id = draft.memberId; await persist(null); onSelect(id); notify('사진을 저장했습니다.'); })} className="ba-primary">사진 저장</Button><Button disabled={busy} onClick={() => { if (window.confirm('등록하지 않은 임시 사진을 버릴까요?')) persist(null).catch(() => setMessage('임시 사진 삭제 실패')); }}>등록 취소</Button></section>}
    {draft?.kind === 'edit' && !editing && <Button onClick={() => { const m = members.find((x) => x.id === draft.memberId); const p = albumPhotos(photos[draft.memberId]).find((x) => x.id === draft.photo.id && x.bucket === draft.photo.bucket); if (!m || !p) { setMessage('초안의 회원 또는 사진에 접근할 수 없습니다.'); return; } if (selectedId !== m.id) { onSelect(m.id); return; } openEditor(p); setEdit(draft.edit); setDate(draft.date); setDirection(draft.direction); setPart(draft.part || ''); setOwner(draft.owner); }}>저장되지 않은 편집 이어하기</Button>}
    {draft?.kind === 'edit' && !editing && <Button className="ba-text" onClick={() => { if (window.confirm('저장하지 않은 편집을 버릴까요? 사진은 그대로입니다.')) persist(null).then(() => notify('편집 초안을 버렸습니다.')).catch(() => setMessage('편집 초안을 지우지 못했습니다.')); }}>편집 초안 버리기</Button>}
    {!member ? <>
      {onAssignUnlinked && onExcludeUnlinked && <UnlinkedPhotos entries={unlinked} ownerView={unlinkedOwnerView} members={members} onAssign={onAssignUnlinked} onExclude={onExcludeUnlinked} busy={busy} run={run} notify={setMessage} />}
      <div className="ba-filterbar"><label className="ba-search"><Search size={15} aria-hidden="true" /><input aria-label="회원 이름 검색" placeholder="회원 이름 검색" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
      <div className="ba-chips" aria-label="회원 필터">{[['all', '전체'], ['photos', '사진 있음'], ['compare', '비교 가능']].map(([k, l]) => <Button key={k} aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</Button>)}</div></div>
      <div className="ba-members">{members.filter((m) => m.name?.includes(query)).map((m) => ({ m, items: albumPhotos(photos[m.id]) })).filter(({ items }) => filter === 'all' || items.length >= (filter === 'compare' ? 2 : 1)).map(({ m, items }) => <Button className="ba-member" key={m.id} onClick={() => onSelect(m.id)}><span className="ba-avatar">{items[0]?.src ? <Photo photo={items[0]} /> : <ImagePlus size={22} />}</span><span className="ba-member-info"><strong>{m.name}</strong><small>{items[0]?.date || '아직 촬영한 사진이 없어요'}{items.length > 0 && ` · ${items.length}장`}</small></span>{items.length >= 2 && <span className="ba-badge">비교 가능</span>}<ChevronRight size={18} aria-hidden="true" /></Button>)}</div>
      {!members.some((m) => m.name?.includes(query) && (filter === 'all' || albumPhotos(photos[m.id]).length >= (filter === 'compare' ? 2 : 1))) && <p className="ba-no-results">조건에 맞는 회원이 없습니다.</p>}
    </> : <>
      {ai ? <><Button onClick={() => setAi(false)}><ArrowLeft size={18} /> 앨범으로</Button><p>AI 분석은 선택 기능입니다. 자세와 구도에 따라 정확도가 달라질 수 있습니다.</p>{hub(member.id, null)}</> : comparing ? <Compare detectPose={detectPose} onAlignLog={onAlignLog} blocker={sharingEnabled ? shareBlocker(shareState, memberAppName(organizationId)) : null} onShare={sharingEnabled ? (card) => setSharing({ card }) : undefined} photos={all} initialPhotos={all.filter((p) => selected.includes(photoKey(p)))} onClose={() => setComparing(false)} onExport={onExport} brand={brandFor(organizationId)} /> : <>
        {/* 처음 쓰는 강사에게는 이 버튼 하나가 길이다: 누르면 두 장이 골라진 채 카드 화면이 열린다. */}
        {all.length >= 2 && <Button className="ba-start" onClick={startCard}><span className="ba-start-icon"><Sparkles size={18} aria-hidden="true" /></span><span><strong>변화 카드 만들기</strong><small>처음 사진과 최근 사진으로 바로 시작해요</small></span><ChevronRight size={18} aria-hidden="true" /></Button>}
        {ghostBase && <Button className="ba-start ba-shot" disabled={busy || !!draft} onClick={() => startShot(ghostBase)}><span className="ba-start-icon"><Camera size={18} aria-hidden="true" /></span><span><strong>지난 사진에 맞춰 찍기</strong><small>{shortDate(ghostBase.date)} {photoLabel(ghostBase)} 사진을 겹쳐 보며 같은 구도로 찍어요</small></span><ChevronRight size={18} aria-hidden="true" /></Button>}
        {all.length === 1 && <p className="ba-start-hint">사진이 한 장 더 있으면 변화 카드를 만들 수 있어요.</p>}
        {all.length > 0 ? <>{selected.length > 0 ? <div className="ba-selection" role="toolbar" aria-label="선택 사진 작업"><div><strong>{selected.length}장 선택</strong><Button aria-label="선택 해제" onClick={() => setSelected([])}><X size={18} /></Button></div><div className="ba-selection-actions">{selected.length === 1 && <><Button disabled={!!draft || busy} onClick={() => openEditor(all.find((p) => photoKey(p) === selected[0]))}>편집</Button>{markup && <Button disabled={busy} onClick={() => setMarkupPhoto(all.find((p) => photoKey(p) === selected[0]))}>그리기</Button>}<Button disabled={busy} onClick={() => run(async () => { await onAnalyze(member.id, all.find((p) => photoKey(p) === selected[0])); setAi(true); notify('선택 사진으로 분석을 준비했습니다.'); })}>AI 분석</Button><Button className="ba-danger" disabled={busy || !!draft} onClick={() => { if (window.confirm('선택한 사진을 삭제할까요? 분석 결과는 유지됩니다.')) run(async () => { if (await onDelete(member.id, all.find((p) => photoKey(p) === selected[0])) === false) throw new Error('사진 삭제 실패'); setSelected([]); notify('사진을 삭제했습니다.'); }); }}>삭제</Button></>}{selected.length === 2 && <Button className="ba-primary" onClick={() => setComparing(true)}>변화 카드 만들기</Button>}{selected.length > 2 && <span>비교할 사진 2장을 선택해 주세요.</span>}</div></div> : <div className="ba-toolbar ba-album-filters"><select aria-label="촬영 방향 필터" value={view} onChange={(e) => setView(e.target.value)}><option value="all">모든 방향</option>{ALBUM_VIEWS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}{ALBUM_PARTS.filter(([k]) => all.some((p) => p.view === 'custom' && p.part === k)).map(([k, l]) => <option key={`custom:${k}`} value={`custom:${k}`}>부위 · {l}</option>)}</select><select aria-label="사진 정렬" value={String(oldest)} onChange={(e) => setOldest(e.target.value === 'true')}><option value="false">최신 순</option><option value="true">오래된 순</option></select><details className="ba-more"><summary>더보기</summary><div>{sharingEnabled && <Button onClick={() => setSharing({ card: null })}>공유 기록</Button>}<Button onClick={() => setAi(true)}>AI 분석 기록</Button></div></details></div>}
        {displayed.length > 0 && <div className="ba-grid">{displayed.map((p) => <article key={photoKey(p)} ref={(node) => { if (node) tileRefs.current.set(photoKey(p), node); else tileRefs.current.delete(photoKey(p)); }} className={[selected.includes(photoKey(p)) ? 'is-selected' : '', flashKey === photoKey(p) ? 'is-flash' : ''].filter(Boolean).join(' ')}><Button className="ba-thumb" aria-label={`${p.date} ${photoLabel(p)} 사진 보기`} onClick={() => setPreview(p)}><Photo photo={p} /></Button><span className="ba-direction"><b>{shortDate(p.date)}</b>{photoLabel(p)}</span><label className="ba-select"><input type="checkbox" aria-label={`${p.date} ${photoLabel(p)} 비교 선택`} checked={selected.includes(photoKey(p))} onChange={(e) => setSelected((old) => e.target.checked ? [...old, photoKey(p)] : old.filter((x) => x !== photoKey(p)))} /></label></article>)}</div>}
        {!displayed.length && <p className="ba-no-results">이 방향의 사진은 아직 없습니다.</p>}
        </> : <div className="ba-empty"><span className="ba-empty-icon"><Images size={32} strokeWidth={1.5} /></span><h2>아직 등록된 사진이 없습니다.</h2><p>첫 사진을 추가하고<br />회원의 변화를 기록해 보세요.</p><Button className="ba-primary" disabled={busy || !!draft} onClick={() => picker.current.click()}><ImagePlus size={18} />사진 추가하기</Button>{(photos[member.id]?.poses || []).length > 0 && <Button onClick={() => setAi(true)}>기존 분석 기록</Button>}{sharingEnabled && <Button onClick={() => setSharing({ card: null })}>공유 기록</Button>}</div>}
        
      </>}
      {preview && !editing && layer(<section ref={dialog} className="ba-viewer ba-panel" role="dialog" aria-modal="true" aria-label="사진 상세"><div className="ba-toolbar"><h2>{preview.date} · {photoLabel(preview)}</h2><Button aria-label="사진 상세 닫기" onClick={() => setPreview(null)}><X size={22} /></Button></div><Photo photo={preview} className="ba-edit-preview" /><div className="ba-toolbar"><Button disabled={!!draft || busy} onClick={() => { openEditor(preview); setPreview(null); }}>편집</Button>{markup && <Button disabled={busy} onClick={() => { setMarkupPhoto(preview); setPreview(null); }}>그리기</Button>}{capture && <Button disabled={busy || !!draft} onClick={() => startShot(preview)}><Camera size={15} aria-hidden="true" />맞춰 찍기</Button>}{/* 고르면 창을 닫고 그 사진으로 부드럽게 옮겨 가 반짝인다 -- 전에는 닫히기만 해서 무엇이 바뀌었는지 스크롤해서 찾아야 했다. */}
        <Button className="ba-primary" onClick={() => { const key = photoKey(preview); const chosen = selected.includes(key); setSelected((old) => chosen ? old.filter((x) => x !== key) : [...old, key]); setPreview(null); if (!chosen) setFocusKey(key); }}>{selected.includes(photoKey(preview)) ? '선택 해제' : '사진 선택'}</Button></div></section>)}
      {shooting && capture && capture({ member: { id: member.id, name: member.name }, view: shooting.view, ghost: shooting.ghost, onCaptured: saveShot, onPickFile: () => { setShooting(null); picker.current?.click(); }, onClose: () => setShooting(null) })}
      {editing && layer(<section ref={dialog} className="ba-editor ba-panel" role="dialog" aria-modal="true" aria-label="사진 편집"><div className="ba-toolbar"><Button disabled={busy} onClick={cancelEdit}>취소</Button><h2>사진 편집</h2><Button className="ba-primary" disabled={busy || !date} onClick={saveEdit}>저장</Button></div><Photo photo={editing} edits={edit} onTransform={(next) => { setEdit(next); persist(editorValue({ edit: next })).catch(() => setMessage("편집 임시 저장 실패")); }} className="ba-edit-preview" /><details className="ba-metadata"><summary>촬영 정보 · 회원 변경</summary><label>촬영 날짜<input type="date" value={date} onChange={(e) => { setDate(e.target.value); persist(editorValue({ date: e.target.value })).catch(() => setMessage('편집 임시 저장 실패')); }} /></label><label>방향<select value={direction} onChange={(e) => { setDirection(e.target.value); persist(editorValue({ direction: e.target.value })).catch(() => setMessage('편집 임시 저장 실패')); }}>{ALBUM_VIEWS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>{direction === 'custom' && <label>부위<select value={part} onChange={(e) => { setPart(e.target.value); persist(editorValue({ part: e.target.value })).catch(() => setMessage('편집 임시 저장 실패')); }}><option value="">정하지 않음</option>{ALBUM_PARTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>}<label>회원<select value={owner} onChange={(e) => { setOwner(e.target.value); persist(editorValue({ owner: e.target.value })).catch(() => setMessage('편집 임시 저장 실패')); }}>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
        </details><div className="ba-chips ba-tools">{[['crop', '자르기'], ['rotate', '회전'], ['align', '정렬'], ['brightness', '밝기']].map(([key, title]) => <Button key={key} aria-pressed={tool === key} onClick={() => setTool(key)}>{title}</Button>)}</div>
        {[['crop', '자르기 (가장자리)', 0, 70, 1], ['rotate', '회전 / 수평', -180, 180, 1], ['zoom', '확대', 0.5, 3, 0.05], ['x', '좌우 위치', -50, 50, 1], ['y', '상하 위치', -50, 50, 1], ['brightness', '밝기', 0.3, 2, 0.05]].filter(([key]) => key === tool || (tool === 'align' && ['zoom', 'x', 'y'].includes(key))).map(([key, title, min, max, step]) => <Range key={key} title={title} value={edit[key]} min={min} max={max} step={step} onChange={(v) => { const next = { ...edit, [key]: v }; setEdit(next); persist(editorValue({ edit: next })).catch(() => setMessage('편집 임시 저장 실패')); }} />)}
        <div className="ba-toolbar"><Button onClick={() => { setEdit({ ...DEFAULT_EDIT }); persist(editorValue({ edit: { ...DEFAULT_EDIT } })).catch(() => setMessage('편집 임시 저장 실패')); }}>편집 처음으로</Button></div>
      </section>)}
      {/* 그리기(기준선 · 자 · 펜 · 화살표 · 손메모) -- 예전 자세 기록의 표시 편집기를 그대로 연다 (App.jsx PostureCanvas).
          본문(body)에 띄운다. 앨범 안(.ba-root 는 isolation)에 두면 아래 탭 막대가 편집기 버튼을 가린다. */}
      {markupPhoto && markup && typeof document !== 'undefined' && createPortal(markup({ photo: markupPhoto, memberId: member.id, onDone: () => setMarkupPhoto(null) }), document.body)}
    </>}
  </div></MarkContext.Provider>;
}
