import React from "react";
import ReactDOM from "react-dom/client";
import { Capacitor } from "@capacitor/core";
import App from "./App.jsx";
import { SERVICE_WORKER_ACTION, purgeServiceWorkers, serviceWorkerAction } from "./features/ui/service-worker.js";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

/* 서비스 워커는 프로덕션 웹에서만 돈다. 네이티브 앱과 개발 서버에서는 등록하지
   않고, 이미 등록된 것이 있으면 걷어낸다 -- 판정과 그 이유는
   features/ui/service-worker.js 에 있다.

   개발 서버에서 특히 중요하다: 한 번 등록된 워커는 dev 서버를 껐다 켜도 살아
   있어서, 등록을 멈추는 것만으로는 이미 걸린 사람이 풀려나지 않는다. */
const action = serviceWorkerAction({
  isNative: Capacitor.isNativePlatform(),
  isDev: import.meta.env.DEV,
  supported: "serviceWorker" in navigator,
});

if (action !== "none") {
  window.addEventListener("load", () => {
    if (action === SERVICE_WORKER_ACTION.UNREGISTER) {
      purgeServiceWorkers({
        serviceWorker: navigator.serviceWorker,
        caches: "caches" in window ? window.caches : undefined,
      });
      return;
    }
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
