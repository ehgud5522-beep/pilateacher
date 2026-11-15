import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { UpdateGate } from "./update-gate.jsx";
import "./styles.css";
import "../../src/features/ui/motion.css";
import "./motion.css";

/* 아이폰 웹뷰는 터치 듣는 것이 하나도 없으면 :active(눌림 모양)를 그리지 않는다. 빈 것 하나를 걸어 둔다. */
document.addEventListener("touchstart", () => {}, { passive: true });

createRoot(document.getElementById("root")).render(<StrictMode><UpdateGate><App /></UpdateGate></StrictMode>);
