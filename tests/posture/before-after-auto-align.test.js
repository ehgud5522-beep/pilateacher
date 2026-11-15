/* 두 사진 자동 맞춤 (auto-align.js). 계산은 순수 함수라 여기서 숫자로 고정한다.
   실제 사진에서 자세 점이 얼마나 잘 잡히는지는 테스트로 알 수 없다 -- 실기기 확인 대상이다. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ALIGN_ERROR, ALIGN_ZOOM_MAX, alignError, alignMessage, autoAlign, bodyFrame } from '../../src/features/photos/auto-align.js';

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');
const CELL = { cellW: 562, cellH: 749 };
const PHOTO = { width: 900, height: 1200 };

/* 서 있는 사람: 가운데 cx, 코 높이 top, 발목 높이 bottom. */
function person({ cx = 0.5, top = 0.2, bottom = 0.9, ankles = true, visibility = 0.9 } = {}) {
  const marks = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0 }));
  const span = bottom - top, put = (index, x, y, v = visibility) => { marks[index] = { x, y, visibility: v }; };
  put(0, cx, top);
  put(11, cx - 0.08, top + span * 0.2); put(12, cx + 0.08, top + span * 0.2);
  put(23, cx - 0.06, top + span * 0.55); put(24, cx + 0.06, top + span * 0.55);
  if (ankles) { put(27, cx - 0.05, bottom); put(28, cx + 0.05, bottom); }
  return marks;
}
const shot = (options) => ({ frame: bodyFrame(person(options)), ...PHOTO });
/* 맞춘 뒤 칸 안에서 몸이 어디에 얼마나 크게 놓이는지 다시 계산한다 (drawCover 와 같은 식). */
function placed(photo, align, basis) {
  const scale = Math.max(CELL.cellW / photo.width, CELL.cellH / photo.height) * align.zoom;
  const w = photo.width * scale, h = photo.height * scale, part = photo.frame[basis];
  return {
    length: part.length * h,
    x: CELL.cellW / 2 + (part.cx - 0.5) * w + align.x * CELL.cellW / 100,
    y: CELL.cellH / 2 + (part.cy - 0.5) * h + align.y * CELL.cellH / 100,
    left: (CELL.cellW - w) / 2 + align.x * CELL.cellW / 100, top: (CELL.cellH - h) / 2 + align.y * CELL.cellH / 100, w, h,
  };
}
const near = (a, b, tolerance = 1.5) => assert.ok(Math.abs(a - b) <= tolerance, `${a} ≉ ${b}`);

test('a person shot from farther away is enlarged to the size of the closer one', () => {
  const photos = [shot({ top: 0.3, bottom: 0.8 }), shot({ top: 0.15, bottom: 0.9 })];
  const result = autoAlign(photos, CELL);
  assert.equal(result.basis, 'full');
  assert.equal(result.align[1].zoom, 1, 'the larger one is left alone');
  near(result.align[0].zoom, 1.5, 0.01);
  const [a, b] = photos.map((p, i) => placed(p, result.align[i], 'full'));
  near(a.length, b.length); near(a.x, b.x); near(a.y, b.y);
  assert.equal(result.exact, true);
});

test('it never shrinks a photo and never leaves an empty band at the edge of the cell', () => {
  const cases = [
    [shot({ cx: 0.3, top: 0.25, bottom: 0.75 }), shot({ cx: 0.7, top: 0.1, bottom: 0.95 })],
    [shot({ cx: 0.5, top: 0.4, bottom: 0.7 }), shot({ cx: 0.45, top: 0.12, bottom: 0.92 })],
    [shot({ cx: 0.2 }), shot({ cx: 0.8 })],
  ];
  for (const photos of cases) {
    const { align } = autoAlign(photos, CELL);
    photos.forEach((p, i) => {
      assert.ok(align[i].zoom >= 1 && align[i].zoom <= ALIGN_ZOOM_MAX, `zoom ${align[i].zoom}`);
      const at = placed(p, align[i], 'full');
      assert.ok(at.left <= 0.6 && at.left + at.w >= CELL.cellW - 0.6, `horizontal band: ${at.left} .. ${at.left + at.w}`);
      assert.ok(at.top <= 0.6 && at.top + at.h >= CELL.cellH - 0.6, `vertical band: ${at.top} .. ${at.top + at.h}`);
    });
  }
});

test('when the framing differs too much it does what it can and says it is not exact', () => {
  // 같은 크기로 찍혔는데 한 명은 왼쪽 끝, 한 명은 오른쪽 끝 -- 빈 띠 없이 같은 자리에 둘 수 없다.
  const result = autoAlign([shot({ cx: 0.2 }), shot({ cx: 0.8 })], CELL);
  assert.equal(result.exact, false);
  // 너무 멀리서 찍힌 사진은 3배까지만 키운다.
  const tiny = autoAlign([shot({ top: 0.45, bottom: 0.6 }), shot({ top: 0.1, bottom: 0.9 })], CELL);
  assert.equal(tiny.align[0].zoom, ALIGN_ZOOM_MAX);
  assert.equal(tiny.exact, false);
});

test('upper-body photos are matched by torso length instead', () => {
  const photos = [shot({ ankles: false, top: 0.2, bottom: 0.9 }), shot({ top: 0.1, bottom: 0.9 })];
  const result = autoAlign(photos, CELL);
  assert.equal(result.basis, 'torso', 'one photo without ankles puts both on the torso');
  const [a, b] = photos.map((p, i) => placed(p, result.align[i], 'torso'));
  near(a.length, b.length);
});

test('already matching photos are left as they are', () => {
  // 칸과 사진 비율이 같으면 옮길 여유가 없다 -- 아무것도 바뀌지 않는다.
  const result = autoAlign([shot(), shot()], { cellW: 600, cellH: 800 });
  assert.deepEqual(result.align, [{ zoom: 1, x: 0, y: 0 }, { zoom: 1, x: 0, y: 0 }]);
});

test('no person and no visible body are different failures, and low-confidence points do not count', () => {
  assert.throws(() => bodyFrame(null), { code: ALIGN_ERROR.NO_PERSON });
  assert.throws(() => bodyFrame([]), { code: ALIGN_ERROR.NO_PERSON });
  assert.throws(() => bodyFrame(person({ visibility: 0.2 })), { code: ALIGN_ERROR.NO_BODY });
  // 한쪽 어깨 · 골반만 보이는 측면 사진도 된다.
  const side = person(); side[11].visibility = 0.1; side[23].visibility = 0.1;
  assert.ok(bodyFrame(side).full);
});

test('each failure has its own sentence, names the photo, and unknown ones keep a code', () => {
  const texts = [
    alignMessage(alignError(ALIGN_ERROR.NO_PERSON, 0)),
    alignMessage(alignError(ALIGN_ERROR.NO_BODY, 1)),
    alignMessage(alignError(ALIGN_ERROR.MODEL, 0)),
    alignMessage(new Error('boom')),
  ];
  assert.equal(new Set(texts).size, 4);
  assert.match(texts[0], /BEFORE 사진에서 사람을/);
  assert.match(texts[1], /AFTER 사진에서 어깨와 골반/);
  assert.match(texts[2], /인터넷 연결/);
  assert.match(texts[3], /\(코드 align\/unknown\)/, 'never a bare "오류가 발생했습니다"');
  // 네트워크 문구는 네트워크 코드에만 붙는다.
  assert.doesNotMatch(texts[0] + texts[1] + texts[3], /인터넷/);
});

test('the screen keeps the old alignment on failure, offers undo, and photos never leave the device', async () => {
  const [album, app, model] = await Promise.all([read('src/features/photos/BeforeAfterAlbum.jsx'), read('src/App.jsx'), read('src/features/photos/auto-align.js')]);
  const start = album.indexOf('const runAuto = async');
  const run = album.slice(start, album.indexOf('const setAlignValue', start));
  // setAlign 은 성공 길에만 있다.
  assert.equal((run.match(/setAlign\(/g) || []).length, 1);
  assert.ok(run.indexOf('setAlign(result.align)') < run.indexOf('} catch (e) {'));
  assert.match(run, /catch \(cause\) \{ throw alignError\(ALIGN_ERROR\.MODEL, i, cause\); \}/, 'a failed model download is a network-type failure');
  assert.match(album, /setAlign\(auto\.before\)/, '되돌리기');
  assert.match(album, /\{detectPose && <div className="ba-auto">/, 'no button where no detector is wired');
  // 진단: 코드 · 단계 · 시간만. 원본 오류는 deviceError 로 함께 남는다.
  assert.match(app, /const logAlbumAlign = \(event, details, error\) => deviceLog\(event, \{ feature: "before_after_align", stage: "auto_align", \.\.\.details, \.\.\.\(error \? deviceError\(error\) : \{\}\) \}\);/);
  assert.doesNotMatch(run, /memberId|member\.name|photoKey|\.src\b/, 'no member or photo identity in the log call');
  // 계산 모듈은 네트워크를 쓰지 않는다. 인식은 App.jsx 의 기기 내 인식기 하나뿐.
  assert.doesNotMatch(model, /fetch\(|XMLHttpRequest|httpsCallable|import\(/);
  assert.match(app, /async function detectAlbumPose\(image\) \{\s*\r?\n\s*const landmarker = await loadLandmarker\(\);/);
});
