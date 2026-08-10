import { LINE, SHADOW } from "../theme/themes.js";

export const Card = ({ children, className = "" }) => (
  <section className={`rounded-xl bg-white ${className}`} style={{ boxShadow: SHADOW, border: `1px solid ${LINE}` }}>{children}</section>
);
