import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function nextPlayVersion(declared, latest) {
  const parse = (value) => {
    if (!/^(0|[1-9][0-9]*)$/.test(String(value))) throw new Error('PLAY_VERSION_INVALID');
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n < 0 || n > 2100000000) throw new Error('PLAY_VERSION_INVALID');
    return n;
  };
  const next = Math.max(parse(declared), parse(latest) + 1);
  if (next < 1 || next > 2100000000) throw new Error('PLAY_VERSION_EXHAUSTED');
  return next;
}

export function effectiveVersion(version, env = process.env) {
  if (!env.CM_BUILD_ID) return version;
  const code = Number(env.ANDROID_VERSION_CODE);
  const latest = Number(env.LATEST_GOOGLE_PLAY_BUILD_NUMBER);
  if (!/^[1-9][0-9]*$/.test(env.ANDROID_VERSION_CODE ?? '') ||
      !/^(0|[1-9][0-9]*)$/.test(env.LATEST_GOOGLE_PLAY_BUILD_NUMBER ?? '') ||
      !Number.isSafeInteger(code) || code > 2100000000 || code < version.versionCode || code <= latest) {
    throw new Error('CI_VERSION_INVALID: Play 최대 번호보다 큰 검증된 버전 코드가 필요합니다.');
  }
  return { ...version, versionCode: code };
}

export function releaseBranch(localBranch, head, env = process.env) {
  if (!env.CM_BUILD_ID) return localBranch;
  if (!env.CM_BRANCH || env.CM_COMMIT !== head) throw new Error('CI_SOURCE_MISMATCH');
  if (localBranch && localBranch !== env.CM_BRANCH) throw new Error('CI_BRANCH_MISMATCH');
  return env.CM_BRANCH;
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const source = readFileSync(new URL('../../android/app/build.gradle', import.meta.url), 'utf8');
  const code = source.match(/\bversionCode\s+(\d+)/)?.[1];
  const name = source.match(/\bversionName\s+"([^"]+)"/)?.[1];
  if (!code || !name || !process.env.CM_ENV || !process.env.CM_BUILD_ID) throw new Error('CI_METADATA_MISSING');
  const next = nextPlayVersion(code, process.env.LATEST_GOOGLE_PLAY_BUILD_NUMBER);
  appendFileSync(process.env.CM_ENV, `ANDROID_VERSION_CODE=${next}\nVITE_APP_VERSION=${name}\nVITE_BUILD_NUMBER=${next}\nVITE_BUILD_COMMIT=${process.env.CM_COMMIT}\nVITE_BUILD_BRANCH=${process.env.CM_BRANCH}\n`);
  console.log(`Android ${name} (${next}); Play maximum ${process.env.LATEST_GOOGLE_PLAY_BUILD_NUMBER}`);
}
