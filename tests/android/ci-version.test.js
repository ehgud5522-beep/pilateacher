import assert from 'node:assert/strict';
import test from 'node:test';
import { nextPlayVersion, effectiveVersion, releaseBranch } from '../../tools/android/ci-version.mjs';

test('live Play maximum wins over stale policy and retry increments the code', () => {
  assert.equal(nextPlayVersion(70, '69'), 70);
  assert.equal(nextPlayVersion(70, '74'), 75);
  assert.equal(nextPlayVersion(70, '75'), 76);
  for (const value of ['', undefined, 'error', '70\n71', '-1', '2.5', '2100000001']) {
    assert.throws(() => nextPlayVersion(70, value));
  }
  assert.throws(() => nextPlayVersion(70, '2100000000'));
});

test('CI guard and Gradle must use the same version, never a code below source or Play', () => {
  const version = { versionCode: 70, versionName: '1.1.38' };
  assert.deepEqual(effectiveVersion(version, {}), version);
  const env = { CM_BUILD_ID: 'build', ANDROID_VERSION_CODE: '75', LATEST_GOOGLE_PLAY_BUILD_NUMBER: '74' };
  assert.deepEqual(effectiveVersion(version, env), { ...version, versionCode: 75 });
  for (const code of ['74', '69', 'NaN', '', '2100000001']) {
    assert.throws(() => effectiveVersion(version, { ...env, ANDROID_VERSION_CODE: code }));
  }
  assert.throws(() => effectiveVersion(version, { ...env, LATEST_GOOGLE_PLAY_BUILD_NUMBER: '' }));
});

test('detached Codemagic checkout is accepted only for its exact selected commit and branch', () => {
  const env = { CM_BUILD_ID: 'build', CM_BRANCH: 'release/1-1-38', CM_COMMIT: 'abc' };
  assert.equal(releaseBranch('', 'abc', env), 'release/1-1-38');
  assert.throws(() => releaseBranch('', 'def', env));
  assert.throws(() => releaseBranch('main', 'abc', env));
  assert.equal(releaseBranch('local', 'abc', {}), 'local');
});
