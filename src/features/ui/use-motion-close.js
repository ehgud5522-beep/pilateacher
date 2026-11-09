import { useCallback, useEffect, useRef, useState } from "react";

// Matches --motion-quick in motion.css, with a small allowance for the first frame.
const EXIT_TIMEOUT_MS = 180;

export function useMotionClose(onClose, animate = true) {
  const [closing, setClosing] = useState(false);
  const timer = useRef(null);
  const latest = useRef({ onClose, animate });
  latest.current = { onClose, animate };

  useEffect(() => () => clearTimeout(timer.current), []);

  const close = useCallback(() => {
    if (timer.current !== null) return;
    if (!latest.current.animate || !globalThis.matchMedia?.("(prefers-reduced-motion: no-preference)")?.matches) {
      latest.current.onClose();
      return;
    }
    setClosing(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      setClosing(false);
      latest.current.onClose();
    }, EXIT_TIMEOUT_MS);
  }, []);

  return { closing, close };
}
