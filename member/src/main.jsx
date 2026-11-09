import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { UpdateGate } from "./update-gate.jsx";
import "./styles.css";
import "../../src/features/ui/motion.css";

createRoot(document.getElementById("root")).render(<StrictMode><UpdateGate><App /></UpdateGate></StrictMode>);
