/* 비포애프터 비교 카드 (2026-11-14 대표: "결과물이 너무 간단, 보니따 로고 자동, 고급스럽게").
   화면에 보이는 것이 곧 저장되는 이미지다 -- 같은 함수 하나로 그린다.

   색감 (2026-11-15 대표: "너무 핫핑크라 이질적 · 필라티쳐에서도 부자연스러움").
   검정 바탕 + 형광 분홍은 밝은 보니따 앱에서도, 남색 필라티쳐에서도 떠 보였다. 인화한 사진처럼
   따뜻한 아이보리 종이 위에 올리고, 분홍은 채도를 낮춘 로즈 하나를 AFTER 표시 · 기간 숫자 ·
   코멘트 머리에만 쓴다. 사진 위 기준선도 분홍이 아니라 흰 점선이다 -- 색은 사진이 낸다.

   회원 이름은 넣지 않는다. 이미지는 저장 · 전송되어 앱 밖으로 나가고, 거기서는 지울 수 없다.
   브랜드는 센터마다 다르다 -- 보니따 센터에만 보니따 표시를 넣고, 다른 센터 · 개인 계정은
   브랜드 없이 "BEFORE & AFTER" 만 쓴다 (brandFor). */

export const CARD_WIDTH = 1200;
/* 사진이 주인공이다 (2026-11-14 대표: "로고 더 작게, 사진 더 크게") -- 바깥 여백 · 사진 사이 · 머리 높이를 줄였다. */
const PAD = 32;
const GUTTER = 12;
const HEADER_BRAND = 148;
const HEADER_PLAIN = 112;
/* 강사 코멘트 칸 (2026-11-14 대표). 3줄까지, 넘치면 … */
export const COMMENT_MAX = 120;
const COMMENT_LINES = 3;
const COMMENT_FONT = 30;
const COMMENT_LINE_H = 44;
const COMMENT_GAP = 22;
const FOOTER = 104;
const RADIUS = 22;
const PAPER = '#FBF8F5';
const PAPER_END = '#F5F0EC';
const INK = '#2A2427';
const SUB = '#8E8387';
const ROSE = '#C8557D';
const HAIR = 'rgba(42,36,39,.09)';
const FONT = '"Pretendard Variable", Pretendard, "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", system-ui, sans-serif';

/** 센터별 표시. 로고 그림 파일이 생기면 logo 에 이미지(HTMLImageElement)를 넣는다. */
export function brandFor(organizationId) {
  if (String(organizationId || '') === 'bonita') return { primary: 'BONITA', secondary: 'PILATES', logo: null };
  return null;
}

/** 'YYYY-MM-DD' → 'YYYY.MM.DD' */
export const cardDate = (value) => String(value || '').slice(0, 10).replaceAll('-', '.');

/** 두 날짜 사이 날 수. 같은 날이면 0, 읽지 못하면 null. */
export function daysBetween(a, b) {
  const start = Date.parse(`${String(a).slice(0, 10)}T00:00:00Z`);
  const end = Date.parse(`${String(b).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.round(Math.abs(end - start) / 86400000);
}

/** 카드 높이. 사진 비율(높이/너비)을 받아 사진 칸 높이를 정한다. */
export function cardLayout(mode, ratio, brand = null, commentLines = 0) {
  const r = Math.min(1.6, Math.max(0.75, Number(ratio) || 1.333));
  const cellW = mode === 'side' ? (CARD_WIDTH - PAD * 2 - GUTTER) / 2 : CARD_WIDTH - PAD * 2;
  // 슬라이더는 한 칸이 넓어 그대로 두면 너무 길다 -- 높이를 줄이고 사진은 칸을 채운다(cover).
  const cellH = Math.round((mode === 'side' ? cellW : cellW * 0.7) * r);
  const top = brand ? HEADER_BRAND : HEADER_PLAIN;
  const commentH = commentLines > 0 ? COMMENT_GAP + 28 + 30 + commentLines * COMMENT_LINE_H + 28 : 0;
  return { cellW, cellH, width: CARD_WIDTH, height: top + cellH + commentH + FOOTER, top, commentTop: top + cellH + COMMENT_GAP, commentH };
}

/** 코멘트를 칸 폭에 맞춰 줄로 나눈다. 띄어쓰기에서 먼저 끊고, 긴 낱말은 글자 단위로. 넘치면 마지막 줄 끝에 … */
export function wrapComment(measure, text, maxWidth, maxLines = COMMENT_LINES) {
  const lines = [];
  for (const paragraph of String(text || '').trim().slice(0, COMMENT_MAX).split(/\n+/)) {
    let line = '';
    for (const word of paragraph.split(/(\s+)/)) {
      const tryLine = line + word;
      if (measure(tryLine) <= maxWidth) { line = tryLine; continue; }
      if (line.trim()) { lines.push(line.trim()); line = ''; }
      for (const ch of word.trimStart()) {
        if (measure(line + ch) > maxWidth) { lines.push(line); line = ''; }
        line += ch;
      }
    }
    if (line.trim()) lines.push(line.trim());
  }
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1];
  while (last && measure(`${last}…`) > maxWidth) last = last.slice(0, -1);
  kept[maxLines - 1] = `${last}…`;
  return kept;
}

function spaced(ctx, px) { if ('letterSpacing' in ctx) ctx.letterSpacing = `${px}px`; }
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
/** 칸을 꽉 채운다(cover). 정렬(zoom · x · y)은 칸 크기에 대한 % 이다. */
function drawCover(ctx, image, x, y, w, h, align = {}) {
  const scale = Math.max(w / image.width, h / image.height) * (align.zoom || 1);
  const dw = image.width * scale, dh = image.height * scale;
  ctx.drawImage(image, x + (w - dw) / 2 + (align.x || 0) * w / 100, y + (h - dh) / 2 + (align.y || 0) * h / 100, dw, dh);
}
function pill(ctx, text, x, y, fill, ink, align = 'left') {
  ctx.font = `700 21px ${FONT}`; spaced(ctx, 3);
  const w = ctx.measureText(text).width + 32, h = 40;
  const left = align === 'right' ? x - w : x;
  ctx.fillStyle = fill; roundRect(ctx, left, y, w, h, 20); ctx.fill();
  ctx.fillStyle = ink; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.fillText(text, left + 16, y + h / 2 + 1); spaced(ctx, 0);
}
function bottomShade(ctx, x, y, w, h) {
  const g = ctx.createLinearGradient(0, y + h - 130, 0, y + h);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.5)');
  ctx.fillStyle = g; ctx.fillRect(x, y + h - 130, w, 130);
}
function dateText(ctx, text, x, y, align = 'left') {
  ctx.font = `600 27px ${FONT}`; ctx.fillStyle = '#fff'; ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
  spaced(ctx, 1); ctx.fillText(text, x, y); spaced(ctx, 0); ctx.textAlign = 'left';
}

function drawHeader(ctx, brand) {
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  if (brand?.logo) {
    const h = 64, w = brand.logo.width * (h / brand.logo.height);
    ctx.drawImage(brand.logo, (CARD_WIDTH - w) / 2, 26, w, h);
  } else if (brand) {
    /* 한 줄 워드마크: 굵은 BONITA + 가는 PILATES, 먹색. 형광 분홍 두 줄 로고는 사진보다 먼저 눈에 들어왔다. */
    spaced(ctx, 9); ctx.textAlign = 'left';
    ctx.font = `800 38px ${FONT}`; const pw = ctx.measureText(brand.primary).width;
    ctx.font = `400 38px ${FONT}`; const sw = ctx.measureText(brand.secondary).width;
    const gap = 14, start = (CARD_WIDTH - (pw + gap + sw)) / 2 + 4;
    ctx.fillStyle = INK;
    ctx.font = `800 38px ${FONT}`; ctx.fillText(brand.primary, start, 76);
    ctx.font = `400 38px ${FONT}`; ctx.fillText(brand.secondary, start + pw + gap, 76);
    ctx.textAlign = 'center';
  }
  ctx.font = `${brand ? 500 : 600} ${brand ? 19 : 30}px ${FONT}`; spaced(ctx, brand ? 7 : 9);
  ctx.fillStyle = brand ? SUB : INK;
  ctx.fillText('BEFORE  &  AFTER', CARD_WIDTH / 2 + 4, brand ? 114 : 72);
  spaced(ctx, 0);
  ctx.textAlign = 'left';
}

function drawComment(ctx, layout, lines) {
  if (!lines.length) return;
  const x = PAD, y = layout.commentTop, w = CARD_WIDTH - PAD * 2, h = layout.commentH - COMMENT_GAP;
  ctx.fillStyle = '#FFFFFF'; roundRect(ctx, x, y, w, h, 20); ctx.fill();
  ctx.strokeStyle = HAIR; ctx.lineWidth = 2; roundRect(ctx, x + 1, y + 1, w - 2, h - 2, 20); ctx.stroke();
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.font = `700 19px ${FONT}`; ctx.fillStyle = ROSE; spaced(ctx, 4); ctx.fillText("TEACHER'S NOTE", x + 32, y + 42); spaced(ctx, 0);
  ctx.font = `500 ${COMMENT_FONT}px ${FONT}`; ctx.fillStyle = INK; ctx.textBaseline = 'alphabetic';
  lines.forEach((line, i) => ctx.fillText(line, x + 32, y + 28 + 30 + 34 + i * COMMENT_LINE_H));
}

function drawFooter(ctx, height, pair) {
  const days = daysBetween(pair[0].date, pair[1].date);
  const y = height - FOOTER / 2 + 2;
  // 날짜는 사진마다 이미 있다. 여기서는 그 사이 기간만 말한다.
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (days === null) { /* 날짜를 못 읽으면 기간을 지어내지 않는다 */ }
  else if (days === 0) { ctx.font = `500 28px ${FONT}`; ctx.fillStyle = SUB; spaced(ctx, 2); ctx.fillText('같은 날 촬영', CARD_WIDTH / 2, y); }
  else {
    ctx.font = `700 36px ${FONT}`; spaced(ctx, 1);
    const num = `${days}`, rest = '일의 변화';
    const nw = ctx.measureText(num).width; ctx.font = `500 30px ${FONT}`; const rw = ctx.measureText(rest).width;
    const start = CARD_WIDTH / 2 - (nw + 6 + rw) / 2;
    ctx.textAlign = 'left';
    ctx.font = `700 36px ${FONT}`; ctx.fillStyle = ROSE; ctx.fillText(num, start, y);
    ctx.font = `500 30px ${FONT}`; ctx.fillStyle = 'rgba(42,36,39,.78)'; ctx.fillText(rest, start + nw + 6, y + 1);
  }
  spaced(ctx, 0);
  ctx.textAlign = 'left';
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ images: (HTMLCanvasElement|HTMLImageElement)[], pair: {date:string}[], mode: 'side'|'overlay',
 *   align: object[], split?: number, guides?: boolean, brand?: object|null, comment?: string }} input
 */
export function drawComparisonCard(canvas, { images, pair, mode, align, split = 50, guides = false, brand = null, comment = '' }) {
  const ratio = Math.max(...images.map((img) => img.height / img.width));
  // 줄 수를 먼저 재야 카드 높이를 정할 수 있다. 캔버스 크기를 바꾸면 그림이 지워지므로 그리기 전에 잰다.
  const measureCtx = canvas.getContext('2d');
  measureCtx.font = `500 ${COMMENT_FONT}px ${FONT}`; spaced(measureCtx, 0);
  const lines = wrapComment((t) => measureCtx.measureText(t).width, comment, CARD_WIDTH - PAD * 2 - 64);
  const layout = cardLayout(mode, ratio, brand, lines.length);
  canvas.width = layout.width; canvas.height = layout.height;
  const ctx = canvas.getContext('2d');

  // 바탕 -- 따뜻한 아이보리 종이. 빛 번짐 없이 아주 옅은 위아래 차이만.
  const bg = ctx.createLinearGradient(0, 0, 0, layout.height);
  bg.addColorStop(0, PAPER); bg.addColorStop(1, PAPER_END);
  ctx.fillStyle = bg; ctx.fillRect(0, 0, layout.width, layout.height);

  drawHeader(ctx, brand);

  const { cellW, cellH, top } = layout;
  const cells = mode === 'side'
    ? [{ x: PAD, img: 0 }, { x: PAD + cellW + GUTTER, img: 1 }]
    : [{ x: PAD, img: 0 }];
  for (const cell of cells) {
    ctx.save(); roundRect(ctx, cell.x, top, cellW, cellH, RADIUS); ctx.clip();
    ctx.fillStyle = '#E9E3DE'; ctx.fillRect(cell.x, top, cellW, cellH);
    if (mode === 'side') drawCover(ctx, images[cell.img], cell.x, top, cellW, cellH, align[cell.img]);
    else {
      drawCover(ctx, images[0], cell.x, top, cellW, cellH, align[0]);
      const cut = cell.x + cellW * (split / 100);
      ctx.save(); ctx.beginPath(); ctx.rect(cut, top, cell.x + cellW - cut, cellH); ctx.clip();
      drawCover(ctx, images[1], cell.x, top, cellW, cellH, align[1]); ctx.restore();
    }
    bottomShade(ctx, cell.x, top, cellW, cellH);
    if (guides) {
      /* 흰 점선 + 옅은 그림자. 밝은 벽 · 어두운 바닥 어디서나 보이고, 사진 색을 건드리지 않는다. */
      [0.25, 0.5, 0.75].forEach((f) => {
        const y = top + cellH * f;
        ctx.setLineDash([]); ctx.strokeStyle = 'rgba(0,0,0,.22)'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(cell.x, y); ctx.lineTo(cell.x + cellW, y); ctx.stroke();
        ctx.setLineDash([12, 10]); ctx.strokeStyle = 'rgba(255,255,255,.88)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(cell.x, y); ctx.lineTo(cell.x + cellW, y); ctx.stroke();
      });
      ctx.setLineDash([]);
    }
    ctx.restore();
    ctx.strokeStyle = HAIR; ctx.lineWidth = 2; roundRect(ctx, cell.x + 1, top + 1, cellW - 2, cellH - 2, RADIUS); ctx.stroke();
  }

  const beforePill = ['rgba(255,255,255,.9)', INK], afterPill = [ROSE, '#fff'];
  if (mode === 'side') {
    pill(ctx, 'BEFORE', PAD + 20, top + 20, ...beforePill);
    pill(ctx, 'AFTER', PAD + cellW + GUTTER + 20, top + 20, ...afterPill);
    dateText(ctx, cardDate(pair[0].date), PAD + 24, top + cellH - 26);
    dateText(ctx, cardDate(pair[1].date), PAD + cellW + GUTTER + 24, top + cellH - 26);
  } else {
    const cut = PAD + cellW * (split / 100);
    ctx.fillStyle = '#fff'; ctx.fillRect(cut - 2, top, 4, cellH);
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.28)'; ctx.shadowBlur = 12;
    ctx.beginPath(); ctx.arc(cut, top + cellH / 2, 26, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.restore();
    ctx.fillStyle = INK; ctx.beginPath();
    ctx.moveTo(cut - 6, top + cellH / 2 - 9); ctx.lineTo(cut - 15, top + cellH / 2); ctx.lineTo(cut - 6, top + cellH / 2 + 9); ctx.fill();
    ctx.beginPath(); ctx.moveTo(cut + 6, top + cellH / 2 - 9); ctx.lineTo(cut + 15, top + cellH / 2); ctx.lineTo(cut + 6, top + cellH / 2 + 9); ctx.fill();
    pill(ctx, 'BEFORE', PAD + 20, top + 20, ...beforePill);
    pill(ctx, 'AFTER', PAD + cellW - 20, top + 20, ...afterPill, 'right');
    dateText(ctx, cardDate(pair[0].date), PAD + 24, top + cellH - 26);
    dateText(ctx, cardDate(pair[1].date), PAD + cellW - 24, top + cellH - 26, 'right');
  }

  drawComment(ctx, layout, lines);
  drawFooter(ctx, layout.height, pair);
  return layout;
}
