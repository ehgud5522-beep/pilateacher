import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(scriptPath), "../..");
const policyPath = resolve(repoRoot, "release/android-release-policy.json");
const proofDir = resolve(repoRoot, ".android-release");
const preflightProofPath = resolve(proofDir, "preflight.json");

export function parseGradleVersion(text) {
  const code = text.match(/\bversionCode\s+(\d+)/);
  const name = text.match(/\bversionName\s+["']([^"']+)["']/);
  if (!code || !name) {
    throw new Error("android/app/build.gradle에서 versionCode/versionName을 찾지 못했습니다.");
  }
  return { versionCode: Number(code[1]), versionName: name[1] };
}

export function compareNumericVersions(left, right) {
  const a = String(left).split(".").map(Number);
  const b = String(right).split(".").map(Number);
  if (a.some(Number.isNaN) || b.some(Number.isNaN)) return null;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

export function isAllowedBranch(branch, patterns) {
  return patterns.some((pattern) => new RegExp(pattern).test(branch));
}

export function isAllowedGeneratedPath(file, allowedPrefixes) {
  const normalized = file.replaceAll("\\", "/");
  return allowedPrefixes.some((prefix) => {
    const normalizedPrefix = prefix.replaceAll("\\", "/");
    return normalized === normalizedPrefix.replace(/\/$/, "") || normalized.startsWith(normalizedPrefix);
  });
}

function run(command, args, { allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    shell: false,
  });
  if (!allowFailure && result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} 실패\n${result.stderr || result.stdout}`.trim());
  }
  return result;
}

function git(args, options) {
  return run("git", args, options).stdout.trim();
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase();
}

function collectFiles(root) {
  const result = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) result.push(absolute);
    }
  };
  visit(root);
  return result;
}

function assertPolicy(policy) {
  const required = [
    "applicationId",
    "approvedUiBaseCommit",
    "lastPublishedVersionCode",
    "lastPublishedVersionName",
    "allowedBranchPatterns",
    "criticalSourceFile",
    "firebaseWebClientId",
    "requiredAndroidOAuthSha1",
  ];
  const missing = required.filter((key) => policy[key] === undefined);
  if (missing.length > 0) throw new Error(`릴리스 정책 누락: ${missing.join(", ")}`);
}

export function missingAndroidOAuthSha1(googleServices, requiredHashes) {
  const actual = new Set(
    (googleServices?.client ?? [])
      .flatMap((client) => client?.oauth_client ?? [])
      .filter((client) => client?.client_type === 1 && client?.android_info?.certificate_hash)
      .map((client) => String(client.android_info.certificate_hash).replaceAll(":", "").toLowerCase()),
  );
  return requiredHashes
    .map((hash) => String(hash).replaceAll(":", "").toLowerCase())
    .filter((hash) => !actual.has(hash));
}

export function hasFirebaseWebClient(googleServices, expectedClientId) {
  return (googleServices?.client ?? [])
    .flatMap((client) => client?.oauth_client ?? [])
    .some((client) => client?.client_type === 3 && client?.client_id === expectedClientId);
}

function currentReleaseInfo(policy) {
  const gradle = readFileSync(resolve(repoRoot, "android/app/build.gradle"), "utf8");
  const capacitor = readJson(resolve(repoRoot, "capacitor.config.json"));
  const packageJson = readJson(resolve(repoRoot, "package.json"));
  const googleServices = readJson(resolve(repoRoot, "android/app/google-services.json"));
  const version = parseGradleVersion(gradle);

  if (capacitor.appId !== policy.applicationId) {
    throw new Error(`앱 ID 불일치: ${capacitor.appId} (필요: ${policy.applicationId})`);
  }
  if (capacitor.webDir !== "dist") {
    throw new Error(`Capacitor webDir가 dist가 아닙니다: ${capacitor.webDir}`);
  }
  if (version.versionCode <= policy.lastPublishedVersionCode) {
    throw new Error(
      `versionCode ${version.versionCode}은 Play의 마지막 코드 ${policy.lastPublishedVersionCode}보다 커야 합니다.`,
    );
  }
  const nameComparison = compareNumericVersions(version.versionName, policy.lastPublishedVersionName);
  if (nameComparison !== null && nameComparison <= 0) {
    throw new Error(
      `versionName ${version.versionName}은 마지막 버전 ${policy.lastPublishedVersionName}보다 커야 합니다.`,
    );
  }

  const allDependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
  const missingDependencies = policy.requiredDependencies.filter((name) => !allDependencies[name]);
  if (missingDependencies.length > 0) {
    throw new Error(`정상 UI에 필요한 패키지가 없습니다: ${missingDependencies.join(", ")}`);
  }

  const missingOauthHashes = missingAndroidOAuthSha1(googleServices, policy.requiredAndroidOAuthSha1);
  if (missingOauthHashes.length > 0) {
    throw new Error(`Firebase Android OAuth 서명 지문이 누락됐습니다: ${missingOauthHashes.join(", ")}`);
  }
  if (!hasFirebaseWebClient(googleServices, policy.firebaseWebClientId)) {
    throw new Error(`Firebase 웹 OAuth 클라이언트가 없거나 다릅니다: ${policy.firebaseWebClientId}`);
  }

  return version;
}

function assertApprovedLineage(policy) {
  const branch = git(["branch", "--show-current"]);
  if (!branch) throw new Error("분리된 HEAD에서는 Android 릴리스를 만들 수 없습니다.");
  if (!isAllowedBranch(branch, policy.allowedBranchPatterns)) {
    throw new Error(`허용되지 않은 릴리스 브랜치입니다: ${branch}`);
  }

  const ancestor = run(
    "git",
    ["merge-base", "--is-ancestor", policy.approvedUiBaseCommit, "HEAD"],
    { allowFailure: true },
  );
  if (ancestor.status !== 0) {
    throw new Error(
      `현재 브랜치는 직전 승인 UI 기준점 ${policy.approvedUiBaseCommit.slice(0, 8)}을 포함하지 않습니다.`,
    );
  }

  const baseSize = Number(
    git(["cat-file", "-s", `${policy.approvedUiBaseCommit}:${policy.criticalSourceFile}`]),
  );
  const currentSize = statSync(resolve(repoRoot, policy.criticalSourceFile)).size;
  const ratio = currentSize / baseSize;
  if (ratio < policy.minimumCriticalFileSizeRatio) {
    throw new Error(
      `${policy.criticalSourceFile} 크기가 승인본의 ${(ratio * 100).toFixed(1)}%뿐입니다. 다른 UI 소스일 가능성이 큽니다.`,
    );
  }
  return { branch, baseSize, currentSize, ratio };
}

export function parsePorcelainPaths(status) {
  if (!status.trim()) return [];
  return status.split(/\r?\n/).map((line) => {
    /* git().trim() removes the first porcelain line's leading space when the
       status is an unstaged modification (" M path"). Accept both the normal
       two-column form and that first-line-trimmed form. */
    const raw = (/^[ MADRCU?!]{2} /.test(line)
      ? line.slice(3)
      : line.replace(/^[MADRCU?!]{1,2}\s+/, "")).trim();
    const destination = raw.includes(" -> ") ? raw.split(" -> ").at(-1) : raw;
    return destination.replace(/^"|"$/g, "");
  });
}

function writePreflightProof(policy, version, lineage) {
  mkdirSync(proofDir, { recursive: true });
  const proof = {
    createdAt: new Date().toISOString(),
    head: git(["rev-parse", "HEAD"]),
    tree: git(["rev-parse", "HEAD^{tree}"]),
    branch: lineage.branch,
    approvedUiBaseCommit: policy.approvedUiBaseCommit,
    versionCode: version.versionCode,
    versionName: version.versionName,
    criticalSourceSha256: sha256File(resolve(repoRoot, policy.criticalSourceFile)),
  };
  writeFileSync(preflightProofPath, `${JSON.stringify(proof, null, 2)}\n`);
  return proof;
}

function preflight(policy) {
  const status = git(["status", "--porcelain", "--untracked-files=all"]);
  if (status) {
    throw new Error(
      `작업 폴더가 깨끗하지 않습니다. 변경사항을 검토하고 커밋한 뒤 다시 실행하세요.\n${status}`,
    );
  }
  const lineage = assertApprovedLineage(policy);
  const version = currentReleaseInfo(policy);
  const proof = writePreflightProof(policy, version, lineage);
  console.log(
    `릴리스 사전 검증 통과: ${proof.versionName} (${proof.versionCode}), ${proof.branch}, ${proof.head.slice(0, 8)}`,
  );
}

function assertSameCandidate(policy) {
  if (!existsSync(preflightProofPath)) {
    throw new Error("사전 검증 기록이 없습니다. 먼저 android:release:guard를 실행하세요.");
  }
  const proof = readJson(preflightProofPath);
  const currentHead = git(["rev-parse", "HEAD"]);
  const currentBranch = git(["branch", "--show-current"]);
  const version = currentReleaseInfo(policy);
  if (proof.head !== currentHead || proof.branch !== currentBranch) {
    throw new Error("사전 검증 이후 커밋 또는 브랜치가 바뀌었습니다. 처음부터 다시 빌드하세요.");
  }
  if (proof.versionCode !== version.versionCode || proof.versionName !== version.versionName) {
    throw new Error("사전 검증 이후 Android 버전 정보가 바뀌었습니다.");
  }

  const changedPaths = parsePorcelainPaths(git(["status", "--porcelain", "--untracked-files=all"]));
  const disallowed = changedPaths.filter(
    (path) => !isAllowedGeneratedPath(path, policy.allowedGeneratedChanges),
  );
  if (disallowed.length > 0) {
    throw new Error(`빌드 중 소스 변경이 감지되었습니다: ${disallowed.join(", ")}`);
  }
  return { proof, version };
}

function verifyAssets(policy) {
  const candidate = assertSameCandidate(policy);
  const distRoot = resolve(repoRoot, "dist");
  const androidRoot = resolve(repoRoot, "android/app/src/main/assets/public");
  if (!existsSync(distRoot) || !existsSync(androidRoot)) {
    throw new Error("dist 또는 Android 웹 자산 폴더가 없습니다. build와 cap sync를 다시 실행하세요.");
  }

  const mismatches = [];
  for (const source of collectFiles(distRoot)) {
    const relativePath = relative(distRoot, source);
    const target = resolve(androidRoot, relativePath);
    if (!existsSync(target) || sha256File(source) !== sha256File(target)) {
      mismatches.push(relativePath.split(sep).join("/"));
    }
  }
  if (mismatches.length > 0) {
    throw new Error(`웹 빌드와 Android 포함 자산이 다릅니다: ${mismatches.slice(0, 10).join(", ")}`);
  }
  console.log(
    `Android 자산 검증 통과: ${candidate.version.versionName} (${candidate.version.versionCode}), ${collectFiles(distRoot).length}개 파일`,
  );
  return candidate;
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function verifyArtifact(policy) {
  const candidate = verifyAssets(policy);
  const suppliedPath = readArgument("--aab");
  if (!suppliedPath) throw new Error("검증할 서명 AAB 경로를 --aab 뒤에 지정하세요.");
  const aabPath = resolve(repoRoot, suppliedPath);
  if (!existsSync(aabPath)) throw new Error(`AAB 파일이 없습니다: ${aabPath}`);
  const size = statSync(aabPath).size;
  if (size < policy.minimumAabBytes) {
    throw new Error(`AAB 크기가 비정상적으로 작습니다: ${size.toLocaleString()} bytes`);
  }

  const signatureCheck = run("jarsigner", ["-verify", aabPath]);
  const signatureOutput = `${signatureCheck.stdout}\n${signatureCheck.stderr}`;
  if (!/jar verified[.!]?/i.test(signatureOutput)) {
    throw new Error("AAB 서명을 확인하지 못했습니다. 서명된 파일인지 확인하세요.");
  }
  const entries = run("jar", ["tf", aabPath]).stdout;
  if (!entries.includes("base/assets/public/index.html")) {
    throw new Error("AAB 안에 웹 앱 index.html이 없습니다.");
  }

  const artifactSha256 = sha256File(aabPath);
  const finalProof = {
    ...candidate.proof,
    verifiedAt: new Date().toISOString(),
    aabPath,
    aabBytes: size,
    aabSha256: artifactSha256,
    signature: "jarsigner verified",
  };
  mkdirSync(proofDir, { recursive: true });
  const proofPath = resolve(
    proofDir,
    `android-${candidate.version.versionCode}-${candidate.proof.head.slice(0, 8)}.json`,
  );
  writeFileSync(proofPath, `${JSON.stringify(finalProof, null, 2)}\n`);
  console.log(`최종 AAB 검증 통과: ${aabPath}`);
  console.log(`SHA-256: ${artifactSha256}`);
  console.log(`검증 기록: ${proofPath}`);
}

function main() {
  const policy = readJson(policyPath);
  assertPolicy(policy);
  const stage = readArgument("--stage") ?? "preflight";
  if (stage === "preflight") preflight(policy);
  else if (stage === "assets") verifyAssets(policy);
  else if (stage === "artifact") verifyArtifact(policy);
  else throw new Error(`알 수 없는 검증 단계입니다: ${stage}`);
}

if (resolve(process.argv[1] ?? "") === scriptPath) {
  try {
    main();
  } catch (error) {
    console.error(`\n[Android 릴리스 차단]\n${error.message}`);
    process.exitCode = 1;
  }
}
