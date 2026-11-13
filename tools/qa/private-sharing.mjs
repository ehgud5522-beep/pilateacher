import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const out = 'release/qa/private-sharing';
await mkdir(out, { recursive: true });
await writeFile(`${out}/entry.jsx`, `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import Teacher from '/src/features/photos/TeacherPhotoSharing.jsx';
import Member from '/member/src/before-after.jsx';
import '/src/features/photos/album.css';import '/member/src/styles.css';
const c=document.createElement('canvas');c.width=200;c.height=400;const x=c.getContext('2d');x.fillStyle='#ec4899';x.fillRect(20,10,150,380);const base64=c.toDataURL('image/jpeg').split(',')[1];
let share=null;let consent='granted';window.calls=[];
const photos=[{id:'p1',date:'2026-06-01',view:'front',edit:{}},{id:'p2',date:'2026-11-01',view:'front',edit:{}}];
async function api(i){window.calls.push(i.action);if(i.action==='consentStatus')return{status:consent};if(i.action==='consent'){consent=i.granted?'granted':'revoked';return{status:consent}}if(i.action==='prepare'){share={id:'test-share',status:'draft',shareType:i.shareType,comparisonConfig:i.comparisonConfig,photos,memberName:'동명이인 A',teacherName:'테스트 선생님',feedback:i.feedback};return structuredClone(share)}if(i.action==='activate'){share.status='active';return{id:share.id,status:'active'}}if(i.action==='revoke'){share.status='revoked';return{status:'revoked'}}if(i.action==='teacherList'||i.action==='memberList')return{shares:share&&share.status!=='revoked'&&(i.action==='teacherList'||share.status==='active')&&consent==='granted'?[structuredClone(share)]:[]};if(!share||share.status==='revoked'||consent!=='granted')throw Error('share/revoked');if(i.action==='media')return{base64,contentType:'image/jpeg'};return structuredClone(share)}
function App(){const[role,setRole]=useState('teacher');return <><nav><button onClick={()=>setRole('teacher')}>테스트 강사</button><button onClick={()=>setRole('member')}>테스트 회원</button></nav>{role==='teacher'?<div className="ba-root"><Teacher api={api} member={{name:'동명이인 A',orgClientId:'client-a'}} organizationId="org" selectedPhotos={photos} comparisonConfig={{mode:'side',align:[{},{}],split:50}} onClose={()=>{}}/></div>:<Member api={api} scope={{organizationId:'org',clientId:'client-a'}}/>}</>};createRoot(document.getElementById('root')).render(<App/>);`);
const vite = await createServer({ appType: 'custom', server: { host: '127.0.0.1', port: 4183, strictPort: true }, logLevel: 'error' });
vite.middlewares.use('/private-sharing-qa', async (_req, res) => {
  res.setHeader('Content-Type', 'text/html'); res.end(await vite.transformIndexHtml('/private-sharing-qa', `<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;padding:12px;font-family:system-ui}button,input,textarea{font:inherit;max-width:100%}figure{margin:8px 0}section{max-width:640px;margin:auto}.stack{display:grid;gap:12px}.card{border:1px solid #eee;border-radius:12px;padding:12px}</style></head><body><div id="root"></div><script type="module" src="/${out}/entry.jsx"></script></body></html>`));
});
await vite.listen();
const { chromium } = await import(pathToFileURL('C:/Users/ehgud/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'));
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const results = [];
try {
  for (const width of [320, 390, 768]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('dialog', (d) => d.accept());
    await page.goto('http://127.0.0.1:4183/private-sharing-qa', { waitUntil: 'networkidle' });
    await page.getByLabel('강사 피드백').fill('함께 확인할 변화입니다.');
    await page.getByRole('button', { name: '공유 내용 미리보기' }).click();
    await page.getByRole('img', { name: '공유된 비포애프터 비교' }).waitFor();
    assert.equal(await page.getByRole('button', { name: '공유하기', exact: true }).isDisabled(), true);
    await page.screenshot({ path: `${out}/${width}-teacher-preview.png` });
    await page.getByRole('button', { name: '테스트 회원', exact: true }).click();
    await page.getByText('아직 공유된 비포애프터 기록이 없습니다.').waitFor();
    await page.getByRole('button', { name: '테스트 강사', exact: true }).click();
    await page.getByRole('button', { name: '공유 준비 · 2장' }).click();
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: '공유하기', exact: true }).click();
    await page.getByText('회원앱에 공유했습니다.', { exact: false }).waitFor();
    await page.getByRole('button', { name: '테스트 회원', exact: true }).click();
    await page.getByRole('button', { name: /2026-06-01/ }).click();
    await page.getByRole('img', { name: '공유된 비포애프터 비교' }).waitFor();
    await page.getByRole('button', { name: '슬라이더 비교' }).click();
    await page.getByLabel('겹침 슬라이더').fill('35');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'horizontal overflow');
    await page.screenshot({ path: `${out}/${width}-member-comparison.png` });
    await page.context().setOffline(true);
    await page.waitForFunction(() => document.querySelectorAll('canvas').length === 0);
    await page.context().setOffline(false);
    await page.getByRole('button', { name: '테스트 강사', exact: true }).click();
    await page.getByRole('button', { name: '공유 취소', exact: true }).click();
    await page.getByText('공유를 취소했습니다.', { exact: true }).waitFor();
    await page.getByRole('button', { name: '테스트 회원', exact: true }).click();
    await page.getByText('아직 공유된 비포애프터 기록이 없습니다.').waitFor();
    assert.deepEqual(errors, []);
    results.push({ width, passed: true, note: 'mock API browser integration; emulator authorization tested separately' }); await page.close();
  }
  await writeFile(`${out}/results.json`, JSON.stringify(results, null, 2)); console.log(JSON.stringify(results));
} finally { await browser.close(); await vite.close(); }
