import { FAINT, SUB } from "../theme/themes.js";

export const Field = ({ label, hint, children }) => (
  <div>
    <div className="mb-1.5 flex items-baseline gap-2">
      <p className="text-xs font-bold" style={{ color: SUB }}>{label}</p>
      {hint && <span className="text-xs" style={{ color: FAINT }}>{hint}</span>}
    </div>
    {children}
  </div>
);
