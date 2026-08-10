import { AVATAR_DEFAULT_RADIUS } from "../tokens/radius.js";
import { AVATAR_INITIAL_FONT_SCALE } from "../tokens/typography.js";
import { CARD, GRAD, RING } from "../theme/themes.js";

export function Avatar({ src, name, size = 48, radius = AVATAR_DEFAULT_RADIUS, ring }) {
  const st = {
    width: size, height: size, borderRadius: radius,
    boxShadow: ring ? `0 0 0 2px ${CARD}, 0 0 0 3px ${RING}` : undefined,
  };
  if (src) return <img src={src} alt={name || "프로필"} className="shrink-0 object-cover" style={st} />;
  return (
    <span className="flex shrink-0 items-center justify-center font-extrabold text-white"
      style={{ ...st, background: GRAD, fontSize: Math.round(size * AVATAR_INITIAL_FONT_SCALE) }}>{(name || "?").slice(0, 1)}</span>
  );
}
