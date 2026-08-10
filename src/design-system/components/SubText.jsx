import { SUB } from "../theme/themes.js";

export const Sub = ({ children, className = "" }) => <p className={`text-xs ${className}`} style={{ color: SUB }}>{children}</p>;
