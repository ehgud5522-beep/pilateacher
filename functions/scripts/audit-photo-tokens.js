"use strict";
// Read-only by default. Operations must separately approve --revoke before release.
const { initializeApp } = require("firebase-admin/app");
const { getStorage } = require("firebase-admin/storage");
const project = process.argv.find((arg) => arg.startsWith("--project="))?.split("=")[1];
const bucketName = process.argv.find((arg) => arg.startsWith("--bucket="))?.split("=")[1];
if (!project || !bucketName) throw new Error("Explicit --project and --bucket are required");
async function auditBucket() {
  if (!process.argv.includes("--firebase-cli")) {
    initializeApp({ projectId: project, storageBucket: bucketName });
    return getStorage().bucket();
  }
  const auth = require("firebase-tools/lib/auth");
  const account = auth.getGlobalDefaultAccount();
  if (!account) throw new Error("Firebase CLI login required");
  const storageRequire = require("node:module").createRequire(require.resolve("@google-cloud/storage"));
  const { OAuth2Client } = storageRequire("google-auth-library");
  const client = new OAuth2Client();
  client.refreshHandler = async () => {
    const token = await auth.getAccessToken(account.tokens.refresh_token, ["https://www.googleapis.com/auth/cloud-platform"]);
    return { access_token: token.access_token, expiry_date: token.expires_at || Date.now() + 3500000 };
  };
  client.setCredentials(await client.refreshHandler());
  const { Storage } = require("@google-cloud/storage");
  return new Storage({ projectId: project, authClient: client }).bucket(bucketName);
}
async function main() {
  const bucket = await auditBucket();
  const apply = process.argv.includes("--revoke");
  const counts = { checked: 0, bearerTokens: 0, unbound: 0, cacheable: 0, updated: 0 };
  let query = { prefix: "users/", autoPaginate: false, maxResults: 200 };
  do {
    const [files, next] = await bucket.getFiles(query);
    for (const file of files) {
      if (!/^users\/[^/]+\/photos\/[^/]+\/(image\.jpg|thumb\.jpg|original\.bin)$/.test(file.name)) continue;
      const [meta] = await file.getMetadata(); counts.checked++;
      if (meta.metadata?.firebaseStorageDownloadTokens) counts.bearerTokens++;
      if (!meta.metadata?.organizationId || !meta.metadata?.clientId) counts.unbound++;
      if (meta.cacheControl !== "private,no-store,max-age=0") counts.cacheable++;
      if (apply) { await file.setMetadata({ cacheControl: "private,no-store,max-age=0", metadata: { ...meta.metadata, firebaseStorageDownloadTokens: null } }); counts.updated++; }
    }
    query = next;
  } while (query);
  process.stdout.write(JSON.stringify({ mode: apply ? "revoke" : "read-only", ...counts }) + "\n");
}
main().catch((error) => { process.stderr.write(JSON.stringify({code: error.code || "audit-failed", reasons: (error.errors || []).map((item) => ({reason: item.reason, message: item.message}))}) + "\n"); process.exitCode = 1; });
