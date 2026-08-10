import { DARK_COLORS, LIGHT_COLORS } from "../tokens/colors.js";
import { THEME_SHADOWS } from "../tokens/shadows.js";

export const LIGHT = {
  ...LIGHT_COLORS,
  shadow: THEME_SHADOWS.light,
};

export const DARK = {
  ...DARK_COLORS,
  shadow: THEME_SHADOWS.dark,
};

export let THEME = "light";
export let INK;
export let INK2;
export let SUB;
export let FAINT;
export let PRIMARY;
export let TINT;
export let RING;
export let CANVAS;
export let PAGE;
export let CARD;
export let LINE;
export let GOOD;
export let GOOD_S;
export let BAD;
export let BAD_S;
export let WARN;
export let WARN_S;
export let MINT;
export let LAVENDER;
export let LAVENDER_S;
export let SAND;
export let SHADOW;
export let GRAD;
export let GRAD_SOFT;
export let SPLASH_BG;
export let GLOW;
export let SCRIM;
export let ON_BRAND;
export let BRAND;
export let BRAND_D;
export let TOAST;
export let PHOTO;

export function applyTheme(mode) {
  if (PAGE && THEME === mode) return;
  const p = mode === "dark" ? DARK : LIGHT;
  THEME = mode;
  PAGE = p.page; CARD = p.card; CANVAS = p.soft; LINE = p.line;
  INK = p.ink; INK2 = p.ink2; SUB = p.sub; FAINT = p.faint;
  PRIMARY = p.primary; BRAND = p.brand; BRAND_D = p.primaryDark; TINT = p.tint; RING = p.ring; TOAST = p.toast; PHOTO = p.photo || "#000";
  GOOD = p.good; GOOD_S = p.goodS; BAD = p.bad; BAD_S = p.badS;
  WARN = p.warn; WARN_S = p.warnS; MINT = p.mint; LAVENDER = p.lavender; LAVENDER_S = p.lavenderS; SAND = p.sand;
  SHADOW = p.shadow; GRAD = p.grad; GRAD_SOFT = p.gradSoft;
  SPLASH_BG = p.splash; GLOW = p.glow; SCRIM = p.scrim; ON_BRAND = p.onBrand;
}

export function paintThemeVars(mode) {
  if (typeof document !== "undefined") {
    const p = mode === "dark" ? DARK : LIGHT;
    const root = document.documentElement;
    const props = {
      "--page": p.page, "--card": p.card, "--canvas": p.soft, "--line": p.line,
      "--ink": p.ink, "--ink2": p.ink2, "--sub": p.sub, "--faint": p.faint,
      "--primary": p.primary, "--brand": p.brand, "--tint": p.tint, "--ring": p.ring,
      "--toast": p.toast, "--photo": p.photo || "#000",
      "--good": p.good, "--good-s": p.goodS, "--bad": p.bad, "--bad-s": p.badS,
      "--warn": p.warn, "--warn-s": p.warnS, "--mint": p.mint,
      "--lavender": p.lavender, "--lavender-s": p.lavenderS, "--sand": p.sand,
      "--shadow": p.shadow, "--grad": p.grad, "--grad-soft": p.gradSoft,
      "--splash-bg": p.splash, "--glow": p.glow, "--scrim": p.scrim, "--on-brand": p.onBrand,
      "--theme": mode,
    };
    Object.entries(props).forEach(([key, value]) => root.style.setProperty(key, value));
  }
}
