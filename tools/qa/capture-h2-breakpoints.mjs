import http from "node:http";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

const root = process.cwd();
const outputDirectory = path.join(root, "release", "qa", "h1-h2-ipad");
await mkdir(outputDirectory, { recursive: true });

const vite = await createServer({
  root,
  configFile: false,
  plugins: [react()],
  appType: "custom",
  server: { middlewareMode: true },
  optimizeDeps: { noDiscovery: true, include: [] },
  ssr: { noExternal: ["@capgo/camera-preview"] },
  logLevel: "silent",
});
const { createAppScreenSmokeCases } = await vite.ssrLoadModule("/src/App.jsx");
const cases = createAppScreenSmokeCases();
const memberList = cases.find((item) => item.name === "회원 목록")?.element;
const memberDetail = cases.find((item) => item.name === "회원 상세")?.element;
if (!memberList || !memberDetail) throw new Error("member smoke surfaces are unavailable");

const surface = React.createElement(
  "div",
  { className: "app-root pt-app-shell", style: { height: "100dvh", minHeight: 0, margin: "0 auto", overflow: "hidden" } },
  React.createElement(
    "div",
    { className: "pt-member-detail-active", style: { height: "100%", minHeight: 0 } },
    React.createElement("div", { className: "pt-member-list-pane h-full min-h-0" }, memberList),
    React.createElement("div", { className: "pt-member-detail-pane h-full min-h-0" }, memberDetail),
  ),
);
const markup = renderToStaticMarkup(surface);
const responsiveCss = `
  html, body, #root { width: 100%; height: 100%; margin: 0; overflow: hidden; }
  body { background: var(--page); font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", sans-serif; }
  .pt-app-shell, .pt-header-inner { width: 100%; max-width: 420px; }
  .pt-member-detail-pane { display: none; }
  .pt-member-detail-active .pt-member-list-pane { display: none; }
  .pt-member-detail-active .pt-member-detail-pane { display: block; }
  .pt-member-card-grid, .pt-analysis-card-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; }
  @media (min-width: 768px) {
    .pt-app-shell, .pt-header-inner { max-width: min(1180px, 100vw); }
    .pt-member-card-grid, .pt-analysis-card-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .pt-member-detail-active { display: grid; grid-template-columns: minmax(270px, 34%) minmax(0, 1fr); height: 100%; min-height: 0; }
    .pt-member-detail-active .pt-member-list-pane, .pt-member-detail-active .pt-member-detail-pane { display: block; min-width: 0; min-height: 0; overflow: hidden; }
    .pt-member-detail-active .pt-member-list-pane { border-right: 1px solid var(--line); }
    .pt-member-detail-active .pt-member-card-grid { grid-template-columns: minmax(0, 1fr); }
    .pt-member-back { display: none !important; }
  }
  @media (min-width: 1024px) {
    .pt-app-shell, .pt-header-inner { max-width: min(1280px, 100vw); }
    .pt-member-card-grid, .pt-analysis-card-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
    .pt-member-detail-active { grid-template-columns: minmax(320px, 31%) minmax(0, 1fr); }
    .pt-member-detail-active .pt-member-card-grid { grid-template-columns: minmax(0, 1fr); }
  }
`;
const pageHtml = `<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="/src/index.css"><style>${responsiveCss}</style><title>H2 breakpoint QA</title></head><body><div id="root">${markup}</div></body></html>`;

const server = http.createServer((request, response) => {
  if (request.url?.startsWith("/qa-h2")) {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    response.end(pageHtml);
    return;
  }
  vite.middlewares(request, response, () => {
    response.writeHead(404);
    response.end();
  });
});
await new Promise((resolve) => server.listen(4177, "127.0.0.1", resolve));

const playwrightPath = pathToFileURL("C:/Users/ehgud/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs").href;
const { chromium } = await import(playwrightPath);
const browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" });
try {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1024, height: 1366 },
    { width: 1366, height: 1024 },
  ]) {
    const page = await browser.newPage({ viewport });
    await page.goto("http://127.0.0.1:4177/qa-h2", { waitUntil: "networkidle" });
    await page.screenshot({ path: path.join(outputDirectory, `members-${viewport.width}x${viewport.height}.png`), fullPage: false });
    await page.close();
  }
} finally {
  await browser.close();
  await vite.close();
  await new Promise((resolve) => server.close(resolve));
}

console.log(`H2 breakpoint snapshots: ${outputDirectory}`);
