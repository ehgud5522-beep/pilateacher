/* 비포애프터 개편 (2026-11-15 대표 지적 여섯 가지).
   ① 카드가 너무 핫핑크 ② 사진 배열이 왼쪽으로 쏠림 ③ 기준선이 중복 선택처럼 보이고 무엇을 골라도 같음
   ④ 확대하면 자도 커짐(ruler-tool-handles.test.js) ⑤ 손메모 크기 자유롭게 ⑥ 손메모 기울기 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  ANNOTATION_TEXT_HANDLE_GAP, ANNOTATION_TEXT_SCALE_MAX, ANNOTATION_TEXT_SCALE_MIN,
  annotationFontSize, annotationTextCenter, annotationTextRotation, annotationTextScale,
  applyAnnotationDrag, hitTestAnnotation, hitTestAnnotations, snapAnnotationRotation, transformAnnotationText,
} from '../../src/features/posture/posture-annotations.js';

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');
const editor = async () => {
  const source = await read('src/App.jsx');
  const start = source.indexOf('function PostureCanvas(');
  return source.slice(start, source.indexOf('function MemberList(', start));
};

const VIEW = { width: 300, height: 400 };
const measure = (text, font) => String(text).length * Number(/(\d+(?:\.\d+)?)px/.exec(font)[1]) * 0.5;
const memo = (extra = {}) => ({ id: 'memo', tool: 'text', fontStyle: 'handwriting', width: 4, pts: [{ x: 0.3, y: 0.4 }], label: '골반 정렬', ...extra });
const near = (a, b, tolerance = 0.5) => assert.ok(Math.abs(a - b) <= tolerance, `${a} ≉ ${b}`);

/* ------------------------------ ⑤ ⑥ 손메모 ------------------------------ */

test('an old memo without scale or rot is drawn exactly as before', () => {
  assert.equal(annotationTextScale(memo()), 1);
  assert.equal(annotationTextRotation(memo()), 0);
  assert.equal(annotationFontSize(memo(), 1), 32, 'width 4 handwriting → 32px, unchanged');
  assert.equal(annotationFontSize(memo({ scale: 2 }), 1), 64);
});

test('scale is bounded and rotation is normalised to -180..180', () => {
  assert.equal(annotationTextScale({ scale: 99 }), ANNOTATION_TEXT_SCALE_MAX);
  assert.equal(annotationTextScale({ scale: 0.01 }), ANNOTATION_TEXT_SCALE_MIN);
  assert.equal(annotationTextScale({ scale: 'x' }), 1);
  assert.equal(annotationTextRotation({ rot: 270 }), -90);
  assert.equal(annotationTextRotation({ rot: -190 }), 170);
});

test('rotation snaps to level and upright when close, and nowhere else', () => {
  assert.equal(snapAnnotationRotation(2.4), 0);
  assert.equal(snapAnnotationRotation(88), 90);
  assert.equal(snapAnnotationRotation(-91.5), -90);
  assert.equal(snapAnnotationRotation(12), 12);
});

test('resizing and tilting keep the memo where it is -- the centre does not move', () => {
  const before = annotationTextCenter(memo(), VIEW, measure, 1);
  for (const change of [{ scale: 2.5 }, { rot: 40 }, { scale: 0.6, rot: -120 }]) {
    const next = transformAnnotationText(memo(), change, VIEW, measure, 1);
    const after = annotationTextCenter(next, VIEW, measure, 1);
    near(after.x, before.x); near(after.y, before.y);
  }
});

test('dragging the corner handle scales the memo by how far the finger moved from the centre', () => {
  const mark = memo();
  const centre = annotationTextCenter(mark, VIEW, measure, 1);
  const origin = { x: (centre.x + 40) / VIEW.width, y: centre.y / VIEW.height };
  const twice = { x: (centre.x + 80) / VIEW.width, y: centre.y / VIEW.height };
  const next = applyAnnotationDrag(mark, { kind: 'resize-text', origin }, twice, VIEW, { measureText: measure, fontScale: 1 });
  near(next.scale, 2, 0.01);
  // 손가락을 가운데로 가져가도 글자가 사라지지 않는다.
  const tiny = applyAnnotationDrag(mark, { kind: 'resize-text', origin }, { x: centre.x / VIEW.width, y: centre.y / VIEW.height }, VIEW, { measureText: measure, fontScale: 1 });
  assert.equal(tiny.scale, ANNOTATION_TEXT_SCALE_MIN);
});

test('dragging the top handle tilts the memo by the angle the finger swept', () => {
  const mark = memo();
  const centre = annotationTextCenter(mark, VIEW, measure, 1);
  const at = (deg, r = 50) => ({ x: (centre.x + r * Math.cos(deg * Math.PI / 180)) / VIEW.width, y: (centre.y + r * Math.sin(deg * Math.PI / 180)) / VIEW.height });
  const next = applyAnnotationDrag(mark, { kind: 'rotate-text', origin: at(-90) }, at(-60), VIEW, { measureText: measure, fontScale: 1 });
  near(next.rot, 30, 0.01);
  // 이미 30° 기운 손메모를 28.5° 되돌리면 1.5° 가 남는다 -- 수평에 붙는다. (가운데는 그 손메모의 것으로 다시 잰다)
  const tilted = memo({ rot: 30 });
  const pivot = annotationTextCenter(tilted, VIEW, measure, 1);
  const around = (deg, r = 50) => ({ x: (pivot.x + r * Math.cos(deg * Math.PI / 180)) / VIEW.width, y: (pivot.y + r * Math.sin(deg * Math.PI / 180)) / VIEW.height });
  const level = applyAnnotationDrag(tilted, { kind: 'rotate-text', origin: around(-60) }, around(-88.5), VIEW, { measureText: measure, fontScale: 1 });
  assert.equal(level.rot, 0, 'close to level snaps to level');
});

test('a tilted memo is hit where it is drawn, not where it used to be', () => {
  const flat = memo(), tilted = memo({ rot: 90 });
  const bounds = annotationTextCenter(flat, VIEW, measure, 1).bounds;
  // 글자 오른쪽 끝: 눕힌 글자에서는 그 자리가 비어 있고, 대신 기준점 아래쪽에 글자가 있다.
  const rightEnd = { x: (bounds.left + bounds.width - 4) / VIEW.width, y: (bounds.top + 10) / VIEW.height };
  const below = { x: (bounds.left - 10) / VIEW.width, y: (bounds.top + bounds.width - 4) / VIEW.height };
  assert.ok(hitTestAnnotation(flat, rightEnd, VIEW, { measureText: measure }));
  assert.equal(hitTestAnnotation(tilted, rightEnd, VIEW, { measureText: measure }), null);
  assert.ok(hitTestAnnotation(tilted, below, VIEW, { measureText: measure }));
});

test('only the selected memo has handles, and they win over a mark lying on top', () => {
  const mark = memo();
  const bounds = annotationTextCenter(mark, VIEW, measure, 1).bounds;
  const corner = { x: (bounds.left + bounds.width + 7) / VIEW.width, y: (bounds.top + bounds.height + 6) / VIEW.height };
  const top = { x: (bounds.left + bounds.width / 2) / VIEW.width, y: (bounds.top - 6 - ANNOTATION_TEXT_HANDLE_GAP) / VIEW.height };
  assert.equal(hitTestAnnotation(mark, corner, VIEW, { measureText: measure, selectedId: 'memo' }).part, 'resize');
  assert.equal(hitTestAnnotation(mark, top, VIEW, { measureText: measure, selectedId: 'memo' }).part, 'rotate');
  assert.equal(hitTestAnnotation(mark, top, VIEW, { measureText: measure }), null, 'an unselected memo has no invisible handle');
  assert.equal(hitTestAnnotation(mark, top, VIEW, { measureText: measure, selectedId: 'memo', includeHandles: false }), null, 'the eraser ignores handles');
  const arrow = { id: 'arrow', tool: 'arrow', width: 3, pts: [{ x: corner.x - 0.1, y: corner.y }, { x: corner.x + 0.1, y: corner.y }] };
  const hit = hitTestAnnotations([mark, arrow], corner, VIEW, { tools: ['arrow', 'text'], measureText: measure, selectedId: 'memo' });
  assert.equal(hit.markId, 'memo'); assert.equal(hit.part, 'resize');
});

test('the editor wires the handles, the two-finger gesture and undo', async () => {
  const source = await editor();
  assert.match(source, /editable\.part === "resize" \? "resize-text" : editable\.part === "rotate" \? "rotate-text" : "move-text"/);
  assert.match(source, /selectedId: selectedMarkId, measureText: measureCanvasText/);
  // 고른 손메모 위의 두 손가락은 사진 확대가 아니라 손메모 변형이다.
  assert.match(source, /memoPinch\.current = \{ markId: chosen\.id, original: chosen, before: marksRef\.current/);
  assert.match(source, /if \(memoPinch\.current && ptrs\.current\.size >= 2\) \{[\s\S]*?transformAnnotationText\(g\.original/);
  // 손을 떼면 한 번의 되돌리기로 남고, 취소되면 원래대로.
  assert.match(source, /if \(e\?\.type === "pointercancel"\) replaceMarks\(g\.before\);\s*\r?\n\s*else if \(JSON\.stringify\(marksRef\.current\) !== JSON\.stringify\(g\.before\)\) \{\s*\r?\n\s*setUndoStack/);
  // 손잡이는 화면 기준 크기 -- 확대해도 손가락으로 잡힌다.
  assert.match(source, /const k = 1 \/ zoom, padX = 7 \* k, padY = 6 \* k;/);
});

test('both renderers tilt the memo around the same point', async () => {
  const source = await read('src/App.jsx');
  assert.match(source, /ctx\.translate\(start\.x, start\.y\);\s*\r?\n\s*if \(textRot\) ctx\.rotate\(\(textRot \* Math\.PI\) \/ 180\);/);
  assert.match(source, /transform=\{textRot \? `rotate\(\$\{textRot\} \$\{start\.x\} \$\{start\.y\}\)` : undefined\}/);
});

/* -------------------------------- ③ 기준선 -------------------------------- */

test('a guide line moves along one axis only', () => {
  const shoulder = { id: 'g', tool: 'hline', guide: 'shoulder', pts: [{ x: 0.5, y: 0.28 }] };
  assert.deepEqual(applyAnnotationDrag(shoulder, { kind: 'move-guide' }, { x: 0.9, y: 0.4 }, VIEW).pts, [{ x: 0.5, y: 0.4 }]);
  const spine = { id: 's', tool: 'vline', guide: 'spine', pts: [{ x: 0.5, y: 0.5 }] };
  assert.deepEqual(applyAnnotationDrag(spine, { kind: 'move-guide' }, { x: 0.62, y: 0.1 }, VIEW).pts, [{ x: 0.62, y: 0.5 }]);
});

test('choosing a guide places that named line at once; the same name is never placed twice', async () => {
  const [source, canvas] = await Promise.all([read('src/App.jsx'), editor()]);
  for (const [key, label] of [['shoulder', '어깨선'], ['pelvis', '골반선'], ['knee', '무릎선'], ['ankle', '발목선'], ['spine', '중심선']]) {
    assert.match(source, new RegExp(`\\{ key: "${key}", label: "${label}", tool: "[hv]line", at: \\{`));
  }
  const start = canvas.indexOf('const prepareGuide =');
  const body = canvas.slice(start, canvas.indexOf('const toggleRuler =', start));
  assert.match(body, /const existing = marksRef\.current\.find\(\(mark\) => mark\.guide === kind\);/);
  assert.match(body, /if \(existing\) \{\s*\r?\n\s*commitMarks\(\(items\) => items\.filter\(\(mark\) => mark\.guide !== kind\)\);/);
  assert.match(body, /guide: kind, label: preset\.label/);
  assert.match(body, /setSelectedMarkId\(id\);/);
  // 전에는 무엇을 골라도 setTool(hline) 뿐이었다.
  assert.doesNotMatch(body, /setTool\(/);
});

test('a guide chip is lit only when its line is on the photo -- no rows pre-highlighted', async () => {
  const canvas = await editor();
  assert.match(canvas, /const placed = marks\.some\(\(mark\) => mark\.guide === item\.key\);/);
  assert.match(canvas, /aria-pressed=\{placed\}/);
  assert.doesNotMatch(canvas, /index < 2 \? TINT/, 'the first two rows are no longer painted as if chosen');
  assert.doesNotMatch(canvas, /위치는 다음 화면에서 지정/);
});

test('guide mode drags lines and never draws', async () => {
  const canvas = await editor();
  assert.match(canvas, /if \(tool === "guide"\) \{[\s\S]*?tools: \["hline", "vline"\][\s\S]*?kind: "move-guide"[\s\S]*?\r?\n\s{6}return;\r?\n\s{4}\}/);
  assert.match(canvas, /const active = k === "ruler" \? Boolean\(ruler\) : tool === k;/);
});

test('named guides carry their name in both renderers, from one shared position', async () => {
  const source = await read('src/App.jsx');
  assert.equal((source.match(/function guideTagBox\(/g) || []).length, 1);
  assert.equal((source.match(/const tag = guideTagBox\(mark, start/g) || []).length, 2, 'canvas and SVG');
  assert.match(source, /mark\.guide && mark\.label && !options\.hideLabel/);
});

/* ------------------------------ ① 카드 색감 ------------------------------ */

test('the card is warm paper with one muted rose -- no neon pink, no glow', async () => {
  const source = await read('src/features/photos/comparison-card.js');
  for (const gone of ['#FF1493', '#E8317F', 'rgba(255,20,147', 'rgba(232,49,127', 'rgba(255,111,170', '#141017', 'createRadialGradient']) {
    assert.ok(!source.includes(gone), `${gone} is gone`);
  }
  assert.match(source, /const PAPER = '#FBF8F5';/);
  assert.match(source, /const ROSE = '#C8557D';/);
  // 사진 위 기준선은 분홍이 아니라 흰 점선.
  assert.match(source, /ctx\.setLineDash\(\[12, 10\]\); ctx\.strokeStyle = 'rgba\(255,255,255,\.88\)'/);
});

/* ------------------------------ ② 배치 ------------------------------ */

test('the album is one continuous grid instead of one left-hanging photo per day', async () => {
  const [album, css] = await Promise.all([read('src/features/photos/BeforeAfterAlbum.jsx'), read('src/features/photos/album.css')]);
  assert.match(album, /displayed\.length > 0 && <div className="ba-grid">\{displayed\.map\(/);
  assert.doesNotMatch(album, /new Set\(displayed\.map/, 'no per-day or per-month sections');
  assert.match(album, /<b>\{shortDate\(p\.date\)\}<\/b>/, 'each photo carries its own date');
  assert.match(css, /\.ba-grid\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\);gap:8px/);
  // "공유 기록" 이 화면 맨 위를 가로지르는 큰 버튼이던 것을 걷었다.
  assert.doesNotMatch(css, /\.ba-root>button:first-child/);
});

test('the share screen never shows the member id, and the member view does not repeat the caption', async () => {
  const [teacher, member] = await Promise.all([read('src/features/photos/TeacherPhotoSharing.jsx'), read('member/src/styles.css')]);
  assert.doesNotMatch(teacher, /회원 식별번호/);
  assert.doesNotMatch(teacher, /\{member\.orgClientId \|\|/);
  assert.match(teacher, /센터 회원과 연결이 필요해요/);
  assert.match(member, /\.ba-member-card figcaption \{ display: none; \}/);
});
