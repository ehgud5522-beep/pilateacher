import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
const out = 'release/qa/schedule-color-shortcut';
await mkdir(out, { recursive: true });
await writeFile(`${out}/entry.jsx`, `
import React,{useState,cloneElement}from'react';import{createRoot}from'react-dom/client';import{createAppScreenSmokeCases}from'/src/App.jsx';
const tree=createAppScreenSmokeCases().find(x=>x.name==='일정 탭 · 이사님 전달사항').element;const child=tree.props.children.props.children;
function Fixture(){const[db,setDb]=useState(child.props.db);return cloneElement(tree,{},cloneElement(tree.props.children,{},cloneElement(child,{db,onSettings:settings=>{window.savedColors=settings.scheduleColors;setDb({...db,settings})}})))}createRoot(document.getElementById('root')).render(<Fixture/>);`);
const vite = await createServer({ appType: 'custom', server: { host: '127.0.0.1', port: 4184, strictPort: true }, logLevel: 'error' });
vite.middlewares.use('/schedule-color-qa', async (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(await vite.transformIndexHtml('/schedule-color-qa', `<html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/${out}/entry.jsx"></script></body></html>`)); });
await vite.listen();
const { chromium } = await import(pathToFileURL('C:/Users/ehgud/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'));
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:4184/schedule-color-qa');
  await page.getByRole('button', { name: '일정 색상', exact: true }).click();
  const swatch = page.getByRole('button', { name: /개인.*파랑/ });
  await swatch.click();
  assert.equal(await swatch.getAttribute('aria-pressed'), 'true');
  assert.equal(await page.evaluate(() => window.savedColors.private), 'blue');
  assert.deepEqual(errors, []);
  await writeFile(`${out}/result.json`, JSON.stringify({ passed: true, scheduleShortcut: true, settingsCallback: true, colorSelection: 'blue' }, null, 2));
  console.log('Schedule shortcut opens and updates the existing settings callback.');
} finally { await browser.close(); await vite.close(); }
