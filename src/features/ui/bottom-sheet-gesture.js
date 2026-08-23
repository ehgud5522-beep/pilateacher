export const SHEET_DISMISS_DISTANCE = 72;
export const SHEET_DISMISS_MIN_FLING_DISTANCE = 28;
export const SHEET_DISMISS_VELOCITY = 0.55;

export function sheetDragOffset(startY, currentY) {
  return Math.max(0, Number(currentY) - Number(startY));
}

export function shouldStartContentDismiss({ scrollTop, deltaX, deltaY }) {
  return Number(scrollTop) <= 0
    && Number(deltaY) > 0
    && Math.abs(Number(deltaY)) > Math.abs(Number(deltaX));
}

export function shouldDismissSheet({ distance, elapsedMs }) {
  const dy = Math.max(0, Number(distance) || 0);
  const elapsed = Math.max(1, Number(elapsedMs) || 1);
  return dy >= SHEET_DISMISS_DISTANCE
    || (dy >= SHEET_DISMISS_MIN_FLING_DISTANCE && dy / elapsed >= SHEET_DISMISS_VELOCITY);
}
