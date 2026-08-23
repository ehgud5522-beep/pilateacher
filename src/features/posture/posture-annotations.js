export const ANNOTATION_PRESET_COLORS = [
  { color: "#FF3B30", label: "빨간색" },
  { color: "#FF8A34", label: "주황색" },
  { color: "#FFD43B", label: "노란색" },
  { color: "#34C759", label: "초록색" },
  { color: "#36C98F", label: "민트색" },
  { color: "#35B8FF", label: "하늘색" },
  { color: "#356AE6", label: "파란색" },
  { color: "#6C5FD4", label: "보라색" },
  { color: "#FFFFFF", label: "흰색" },
  { color: "#17171F", label: "검정색" },
];

export const HANDWRITING_SIZE_OPTIONS = Object.freeze([
  { value: 2, label: "작게" },
  { value: 4, label: "보통" },
  { value: 6, label: "크게" },
]);

export function closestHandwritingWidth(value) {
  const width = Number(value);
  return HANDWRITING_SIZE_OPTIONS.reduce((closest, option) => (
    Math.abs(option.value - width) < Math.abs(closest - width) ? option.value : closest
  ), HANDWRITING_SIZE_OPTIONS[1].value);
}

export const RECENT_ANNOTATION_COLORS_KEY = "pt_annotation_recent_colors_v1";

export function clampAnnotationNumber(value, min = 0, max = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

export function clampAnnotationPoint(point) {
  return {
    x: clampAnnotationNumber(point?.x),
    y: clampAnnotationNumber(point?.y),
  };
}

export function normalizeAnnotationColor(value, fallback = "#6C5FD4") {
  const raw = String(value || "").trim().toUpperCase();
  if (/^#[0-9A-F]{6}$/.test(raw)) return raw;
  if (/^#[0-9A-F]{3}$/.test(raw)) return `#${raw.slice(1).split("").map((part) => `${part}${part}`).join("")}`;
  return fallback;
}

export function addRecentAnnotationColor(colors, value, limit = 6) {
  const color = normalizeAnnotationColor(value);
  const previous = Array.isArray(colors) ? colors : [];
  return [color, ...previous.map((item) => normalizeAnnotationColor(item)).filter((item) => item !== color)].slice(0, Math.max(1, limit));
}

export function readRecentAnnotationColors(storage, key = RECENT_ANNOTATION_COLORS_KEY) {
  try {
    const parsed = JSON.parse(storage?.getItem?.(key) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.reduce((result, color) => addRecentAnnotationColor(result, color), []).reverse();
  } catch (error) {
    return [];
  }
}

export function rememberAnnotationColor(storage, value, key = RECENT_ANNOTATION_COLORS_KEY, limit = 6) {
  const next = addRecentAnnotationColor(readRecentAnnotationColors(storage, key), value, limit);
  try { storage?.setItem?.(key, JSON.stringify(next)); } catch (error) {}
  return next;
}

export function annotationTextLines(mark) {
  const lines = String(mark?.label || "").replace(/\r\n?/g, "\n").split("\n");
  return lines.length ? lines : [""];
}

export function annotationFontSize(mark, scale = 1) {
  const width = Math.max(1, Number(mark?.width) || 3);
  const base = mark?.fontStyle === "handwriting" ? Math.max(25, width * 8) : Math.max(13, width * 5);
  return base * Math.max(0.01, Number(scale) || 1);
}

export function annotationFont(mark, scale = 1) {
  const hand = mark?.fontStyle === "handwriting";
  const size = annotationFontSize(mark, scale);
  return `${hand ? 400 : 600} ${size}px ${hand ? "'Nanum Pen Script', 'Segoe Print', cursive" : "Pretendard, sans-serif"}`;
}

function viewportSize(viewport) {
  return {
    width: Math.max(1, Number(viewport?.width) || 1),
    height: Math.max(1, Number(viewport?.height) || 1),
  };
}

function toPixels(point, viewport) {
  const size = viewportSize(viewport);
  return { x: Number(point?.x || 0) * size.width, y: Number(point?.y || 0) * size.height };
}

export function annotationTextBounds(mark, viewport, measureText, fontScale = 1) {
  const size = viewportSize(viewport);
  const anchor = toPixels(mark?.pts?.[0], size);
  const lines = annotationTextLines(mark);
  const font = annotationFont(mark, fontScale);
  const fontSize = annotationFontSize(mark, fontScale);
  const lineHeight = fontSize * 1.16;
  const widths = lines.map((line) => {
    const measured = Number(measureText?.(line || " ", font));
    return Number.isFinite(measured) ? measured : Math.max(fontSize * 0.45, String(line || " ").length * fontSize * 0.56);
  });
  const width = Math.max(fontSize * 0.45, ...widths);
  const height = Math.max(lineHeight, lines.length * lineHeight);
  return {
    left: anchor.x,
    top: anchor.y,
    right: anchor.x + width,
    bottom: anchor.y + height,
    width,
    height,
    lines,
    font,
    fontSize,
    lineHeight,
  };
}

export function distancePointToSegment(point, start, end, viewport) {
  const p = toPixels(point, viewport), a = toPixels(start, viewport), b = toPixels(end, viewport);
  const dx = b.x - a.x, dy = b.y - a.y;
  const length2 = dx * dx + dy * dy;
  if (!length2) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function distanceInPixels(point, target, viewport) {
  const p = toPixels(point, viewport), q = toPixels(target, viewport);
  return Math.hypot(p.x - q.x, p.y - q.y);
}

function polylineDistance(mark, point, viewport) {
  const points = Array.isArray(mark?.pts) ? mark.pts : [];
  if (points.length === 1) return distanceInPixels(point, points[0], viewport);
  let distance = Infinity;
  for (let index = 1; index < points.length; index += 1) {
    distance = Math.min(distance, distancePointToSegment(point, points[index - 1], points[index], viewport));
  }
  return distance;
}

export function hitTestAnnotation(mark, point, viewport, options = {}) {
  const points = Array.isArray(mark?.pts) ? mark.pts : [];
  if (!points.length) return null;
  const { width, height } = viewportSize(viewport);
  const handleRadius = Math.max(12, Number(options.handleRadius) || 22);
  const bodyTolerance = Math.max(8, Number(options.bodyTolerance) || 14, (Number(mark?.width) || 3) + 8);
  const includeHandles = options.includeHandles !== false;

  if (mark.tool === "arrow" && points.length >= 2 && includeHandles) {
    if (distanceInPixels(point, points[0], { width, height }) <= handleRadius) return { part: "start", distance: distanceInPixels(point, points[0], { width, height }) };
    if (distanceInPixels(point, points[points.length - 1], { width, height }) <= handleRadius) return { part: "end", distance: distanceInPixels(point, points[points.length - 1], { width, height }) };
  }

  if (mark.tool === "text") {
    const bounds = annotationTextBounds(mark, { width, height }, options.measureText, options.fontScale || 1);
    const p = toPixels(point, { width, height });
    const pad = Math.max(10, Number(options.textPadding) || 12);
    return p.x >= bounds.left - pad && p.x <= bounds.right + pad && p.y >= bounds.top - pad && p.y <= bounds.bottom + pad
      ? { part: "body", distance: 0, bounds }
      : null;
  }

  if (mark.tool === "hline") {
    const distance = Math.abs(Number(point?.y || 0) - Number(points[0]?.y || 0)) * height;
    return distance <= bodyTolerance ? { part: "body", distance } : null;
  }
  if (mark.tool === "vline") {
    const distance = Math.abs(Number(point?.x || 0) - Number(points[0]?.x || 0)) * width;
    return distance <= bodyTolerance ? { part: "body", distance } : null;
  }
  if (mark.tool === "point") {
    const distance = distanceInPixels(point, points[0], { width, height });
    return distance <= handleRadius ? { part: "body", distance } : null;
  }
  if ((mark.tool === "rect" || mark.tool === "circle") && points.length >= 2) {
    const p = toPixels(point, { width, height }), a = toPixels(points[0], { width, height }), b = toPixels(points[1], { width, height });
    const left = Math.min(a.x, b.x), right = Math.max(a.x, b.x), top = Math.min(a.y, b.y), bottom = Math.max(a.y, b.y);
    const inside = p.x >= left - bodyTolerance && p.x <= right + bodyTolerance && p.y >= top - bodyTolerance && p.y <= bottom + bodyTolerance;
    if (!inside) return null;
    if (mark.tool === "rect") {
      const distance = Math.min(Math.abs(p.x - left), Math.abs(p.x - right), Math.abs(p.y - top), Math.abs(p.y - bottom));
      return distance <= bodyTolerance ? { part: "body", distance } : null;
    }
    const rx = Math.max(1, (right - left) / 2), ry = Math.max(1, (bottom - top) / 2), cx = (left + right) / 2, cy = (top + bottom) / 2;
    const radial = Math.abs(Math.hypot((p.x - cx) / rx, (p.y - cy) / ry) - 1) * Math.min(rx, ry);
    return radial <= bodyTolerance ? { part: "body", distance: radial } : null;
  }

  const distance = polylineDistance(mark, point, { width, height });
  return distance <= bodyTolerance ? { part: "body", distance } : null;
}

export function hitTestAnnotations(marks, point, viewport, options = {}) {
  const list = Array.isArray(marks) ? marks : [];
  const tools = Array.isArray(options.tools) ? new Set(options.tools) : null;
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const mark = list[index];
    if (!mark || (tools && !tools.has(mark.tool))) continue;
    const hit = hitTestAnnotation(mark, point, viewport, options);
    if (hit) return { ...hit, mark, index, markId: mark.id };
  }
  return null;
}

export function translateAnnotationPoints(points, deltaX, deltaY) {
  const list = (Array.isArray(points) ? points : []).map(clampAnnotationPoint);
  if (!list.length) return [];
  const xs = list.map((point) => point.x), ys = list.map((point) => point.y);
  const dx = clampAnnotationNumber(deltaX, -Math.min(...xs), 1 - Math.max(...xs));
  const dy = clampAnnotationNumber(deltaY, -Math.min(...ys), 1 - Math.max(...ys));
  return list.map((point) => ({ x: point.x + dx, y: point.y + dy }));
}

function clampTextAnchor(mark, anchor, viewport, measureText, fontScale) {
  const size = viewportSize(viewport);
  const next = { ...mark, pts: [clampAnnotationPoint(anchor)] };
  const bounds = annotationTextBounds(next, size, measureText, fontScale);
  const maxX = Math.max(0, 1 - bounds.width / size.width);
  const maxY = Math.max(0, 1 - bounds.height / size.height);
  return { x: clampAnnotationNumber(anchor.x, 0, maxX), y: clampAnnotationNumber(anchor.y, 0, maxY) };
}

export function applyAnnotationDrag(mark, interaction, point, viewport, options = {}) {
  if (!mark || !interaction) return mark;
  const current = clampAnnotationPoint(point);
  const originalPoints = (interaction.originalPoints || mark.pts || []).map(clampAnnotationPoint);
  if (interaction.kind === "arrow-start" && originalPoints.length >= 2) return { ...mark, pts: [current, ...originalPoints.slice(1)] };
  if (interaction.kind === "arrow-end" && originalPoints.length >= 2) return { ...mark, pts: [...originalPoints.slice(0, -1), current] };
  if (interaction.kind === "move-arrow") {
    const origin = clampAnnotationPoint(interaction.origin);
    return { ...mark, pts: translateAnnotationPoints(originalPoints, current.x - origin.x, current.y - origin.y) };
  }
  if (interaction.kind === "move-text") {
    const offset = interaction.grabOffset || { x: 0, y: 0 };
    const anchor = clampTextAnchor(mark, { x: current.x - Number(offset.x || 0), y: current.y - Number(offset.y || 0) }, viewport, options.measureText, options.fontScale || 1);
    return { ...mark, pts: [anchor] };
  }
  return mark;
}

export function arrowHeadPoints(start, end, length = 16, spread = Math.PI / 6) {
  const a = start || { x: 0, y: 0 }, b = end || a;
  const angle = Math.atan2(Number(b.y || 0) - Number(a.y || 0), Number(b.x || 0) - Number(a.x || 0));
  const size = Math.max(1, Number(length) || 16);
  return [
    { x: Number(b.x || 0) - size * Math.cos(angle - spread), y: Number(b.y || 0) - size * Math.sin(angle - spread) },
    { x: Number(b.x || 0) - size * Math.cos(angle + spread), y: Number(b.y || 0) - size * Math.sin(angle + spread) },
  ];
}
