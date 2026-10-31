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
  assert.equal(production.publishing.google_play.track, "production", "프로덕션 워크플로는 그대로다");
});
