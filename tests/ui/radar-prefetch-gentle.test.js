import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/* 2026-11-28 대표: "더보기 들어가면 렉 · 버벅임 -- (폰 · PC 둘 다) 처음 들어갈 때".
   원인: 대표 · 총괄의 더보기가 열리면 재등록 레이더를 미리 읽는데, 일곱 가지(회원 · 회원권 · 8주 차감 · 45일 일지 ·
   후보 · 강사 · 지점 + 비포애프터 집계)를 한꺼번에 읽어 수천 건을 한 번에 풀었다.
   고침: 미리 읽기는 더보기가 열리고 조금 뒤에, 하나씩 · 사이사이 한가할 때까지 기다리며. 레이더 화면이 열리면 남은 것은 쉬지 않고. */

const app = readFileSync(new URL("../../src/App.jsx", import.meta.url), "utf8");
const body = (name) => {
  const start = app.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  const next = app.indexOf("\nfunction ", start + 10);
  return app.slice(start, next < 0 ? undefined : next);
};

test("더보기의 미리 읽기는 조금 뒤에, gentle 로 시작한다", () => {
  const prefetch = body("prefetchRenewalRadar");
  assert.match(prefetch, /startRadarLoad\(params, \{ gentle: true \}\)/);
  assert.match(prefetch, /setTimeout\(later, 1500\)/, "더보기가 열리는 움직임과 겹치지 않게");
  assert.match(prefetch, /if \(entry\.at \|\| entry\.loading\) return;/, "앱을 연 뒤 한 번만 (#294) 은 그대로");
});

test("gentle 은 하나씩 · 사이사이 쉬고, 화면이 열리면 쉬지 않는다", () => {
  const load = body("startRadarLoad");
  assert.match(load, /jobFactories\.reduce\(\(chain, job\) => chain\.then\(\(\) => \(entry\.hurry \? null : radarIdle\(\)\)\)\.then\(\(\) => settle\(job\)\)/);
  assert.match(load, /Promise\.allSettled\(jobFactories\.map\(\(job\) => settle\(job\)\)\)/, "화면이 부르면 한꺼번에");
  assert.match(load, /if \(entry\.loading && !gentle\) entry\.hurry = true;/, "미리 읽기 도중 화면이 열리면 서두른다");
  // 읽는 것은 그대로 -- 일곱 가지 + 비포애프터 집계
  for (const reader of ["listClients", "listPasses", "listRecentDeductions", "listLessonNotesBetween", "onLoadShares", "listRecordActivity", "listRenewalCandidates", "listMemberships", "listLocations"]) {
    assert.ok(load.includes(reader), reader);
  }
});

test("걸린 시간을 진단에 남긴다 -- 렉을 다시 말하면 숫자로 본다", () => {
  const load = body("startRadarLoad");
  assert.match(load, /deviceLog\("renewal_radar_loaded", \{ feature: "renewal_radar", stage: gentle \? "prefetch" : "screen", ms: Date\.now\(\) - startedAt/);
});
