/**
 * 로딩 동그라미 (2026-11-28 대표: "전체적으로 로딩 동그라미 느낌으로 -- 기다려야 하는 것들 다 바꿔 줘").
 *
 * 글자("보내는 중…")는 화면에서 지우되 화면 읽기 프로그램에는 남긴다(.sr-only) -- 눈으로는 도는 동그라미,
 * 귀로는 무엇을 기다리는지. 버튼 안에서는 작게(inline), 화면 가운데서는 크게.
 *
 * @param {{ label?: string, size?: number, inline?: boolean, caption?: string }} props
 *   caption 은 동그라미 아래에 보이는 짧은 말 (화면 전체 로딩에서만)
 */
export function Spinner({ label = "불러오는 중", size = 22, inline = false, caption = "" }) {
  const ring = (
    <svg className="spinner-ring" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" strokeOpacity=".18" strokeWidth="3" />
      <path d="M12 2.5a9.5 9.5 0 0 1 9.5 9.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
  if (inline) {
    return (
      <span className="spinner inline" role="status" data-spinner>
        {ring}
        <span className="sr-only">{label}</span>
      </span>
    );
  }
  return (
    <div className="spinner block" role="status" data-spinner>
      {ring}
      {caption ? <p className="spinner-caption">{caption}</p> : null}
      <span className="sr-only">{label}</span>
    </div>
  );
}
