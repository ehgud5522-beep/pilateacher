/**
 * 날 수를 사람이 세는 말로 (2026-11-24 대표: "몇 일이 아니라 몇 달 · 일주일 · 이주일 이렇게").
 *
 *   0        → "오늘"
 *   1~6      → "N일"
 *   7~29     → "일주일" · "2주" · "3주" · "4주" (7의 배수가 아니면 "약")
 *   30~364   → "한 달" · "한 달 반" · "2달" · "4달 반" (보름 단위로 반올림, 늘 "약")
 *   365~     → "1년" · "1년 3달" (늘 "약")
 *
 * 브리핑 · 재등록 레이더가 같이 쓴다 -- 앱과 대표 화면이 같은 말로 센다. 순수 함수.
 *
 * @param {number} days 0 이상 정수 (음수는 절댓값)
 * @returns {string}
 */
export function daySpanLabel(days) {
  const value = Math.abs(Math.round(Number(days)));
  if (!Number.isFinite(value)) return "";
  if (value === 0) return "오늘";
  if (value < 7) return `${value}일`;
  if (value < 30) {
    const weeks = Math.round(value / 7);
    const exact = value % 7 === 0;
    const word = weeks === 1 ? "일주일" : `${weeks}주`;
    return exact ? word : `약 ${word}`;
  }
  if (value < 365) {
    const halves = Math.round(value / 15);
    const months = Math.floor(halves / 2);
    const half = halves % 2 === 1;
    if (months >= 12) return "약 1년";
    const word = months === 1 ? "한 달" : `${months}달`;
    return `약 ${word}${half ? " 반" : ""}`;
  }
  const years = Math.floor(value / 365);
  const months = Math.round((value - years * 365) / 30);
  if (months >= 12) return `약 ${years + 1}년`;
  return `약 ${years}년${months ? ` ${months}달` : ""}`;
}
