import React from "react";
import ReactDOM from "react-dom/client";
import { Capacitor } from "@capacitor/core";
import App from "./App.jsx";
import "./index.css";

const root = ReactDOM.createRoot(document.getElementById("root"));

/**
 * 운영 콘솔은 같은 번들이 아니라 별도 청크다. pathname 이 /console 일 때만
 * 내려받으므로 앱 실행 경로에는 들어오지 않는다. 네이티브에서는 Capacitor 가
 * index.html 을 / 로 서빙하고 앱 화면에 진입점이 없어 이 분기를 타지 않는다.
 */
const isConsoleRoute = typeof window !== "undefined"
  && window.location.pathname.replace(/\/+$/, "") === "/console";

if (isConsoleRoute) {
  import("./console/ConsoleApp.jsx").then(({ default: ConsoleApp }) => {
    root.render(
      <React.StrictMode>
        <ConsoleApp />
      </React.StrictMode>
    );
  });
} else {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

if ("serviceWorker" in navigator && Capacitor.isNativePlatform()) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.getRegistrations().then((registrations) => registrations.forEach((registration) => registration.unregister())).catch(() => {});
    if ("caches" in window) caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("pilateacher-")).map((key) => caches.delete(key)))).catch(() => {});
  });
} else if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
