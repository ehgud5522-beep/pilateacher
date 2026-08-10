import { GRAD, PRIMARY } from "../theme/themes.js";

export const PrimaryBtn = ({ children, onClick, disabled, tone = PRIMARY }) => (
  <button onClick={onClick} disabled={disabled}
    className="flex h-12 w-full items-center justify-center gap-1.5 rounded-xl px-4 text-sm font-extrabold text-white disabled:opacity-40"
    style={{ background: tone === PRIMARY ? GRAD : tone }}>{children}</button>
);
