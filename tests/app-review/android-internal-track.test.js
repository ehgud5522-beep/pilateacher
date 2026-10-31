import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import yaml from "js-yaml";

/* 강사 앱 Android 내부 테스트 워크플로 (2026-10-31). 프로덕션과 같은 빌드 · 서명 ·
   검증을 거치고, Play 내부 테스트 트랙에만 올린다. 프로덕션에는 아무것도 나가지 않는다. */
test("내부 테스트 워크플로는 internal 트랙에만, 자동 시작 없이, 프로덕션과 같은 단계로", async () => {
  const workflows = yaml.load(await readFile(new URL("../../codemagic.yaml", import.meta.url), "utf8")).workflows;
  const internal = workflows["instructor-android-internal"];
  const production = workflows["instructor-android-production"];
  assert.ok(internal, "워크플로가 있다");
  assert.equal(internal.publishing.google_play.track, "internal");
  assert.equal("rollout_fraction" in internal.publishing.google_play, false, "단계적 출시는 프로덕션의 것이다");
  assert.equal("triggering" in internal, false, "커밋으로 시작되지 않는다 -- 사람이 Codemagic 에서 시작한다");
  assert.deepEqual(internal.scripts.map((step) => step.name), production.scripts.map((step) => step.name), "같은 검증을 거친다");
  assert.deepEqual(internal.environment.android_signing, production.environment.android_signing);
  assert.equal(production.publishing.google_play.track, "production", "프로덕션 워크플로는 프로덕션 트랙");
});

/* 프로덕션 (2026-10-31 대표 결정, 1.1.44 부터): 단계적 출시 없이 100%, 대신 초안으로 올린다 --
   빌드가 끝나도 공개되지 않고 대표가 Play Console 에서 출시를 누를 때 100% 로 나간다. */
test("프로덕션 워크플로는 단계적 출시 없이 초안으로 — 빌드만으로는 공개되지 않는다", async () => {
  const workflows = yaml.load(await readFile(new URL("../../codemagic.yaml", import.meta.url), "utf8")).workflows;
  const production = workflows["instructor-android-production"];
  const play = production.publishing.google_play;
  assert.equal("rollout_fraction" in play, false, "단계적 출시 비율이 없다 -- 출시하면 100%");
  assert.equal(play.submit_as_draft, true, "빌드가 끝나면 초안 -- 바로 공개되지 않는다");
  assert.equal("triggering" in production, false, "커밋으로 시작되지 않는다");
  assert.equal(workflows["instructor-android-internal"].publishing.google_play.submit_as_draft, false, "내부 테스트는 그대로");
});
