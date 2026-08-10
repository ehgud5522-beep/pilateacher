"use strict";

const fs = require("node:fs");
const {
  assertSafeProject,
  runSeedOperation,
} = require("../src/app-review-seed");

function codedError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function parseArguments(argv) {
  let projectId = "";
  let apply = false;
  let help = false;
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--apply") apply = true;
    else if (item === "--help" || item === "-h") help = true;
    else if (item === "--project") projectId = argv[++index] || "";
    else if (item.startsWith("--project=")) projectId = item.slice("--project=".length);
    else throw codedError("unknown_argument", `Unknown argument: ${item}`);
  }
  if (!help) projectId = assertSafeProject(projectId);
  return { mode: apply ? "apply" : "dry-run", projectId, help };
}

function parseFirebaseConfig(raw) {
  if (!raw) return "";
  try {
    const value = JSON.parse(raw);
    return String(value.projectId || value.project_id || "").trim();
  } catch (_error) {
    return "";
  }
}

function detectCredentialProjectId(env = process.env, readFile = fs.readFileSync) {
  const credentialPath = String(env.GOOGLE_APPLICATION_CREDENTIALS || "").trim();
  if (credentialPath) {
    try {
      const credential = JSON.parse(readFile(credentialPath, "utf8"));
      const credentialProject = String(credential.project_id || credential.projectId || "").trim();
      if (credentialProject) return credentialProject;
    } catch (_error) {}
  }
  const firebaseConfigProject = parseFirebaseConfig(env.FIREBASE_CONFIG);
  if (firebaseConfigProject) return firebaseConfigProject;
  return String(env.GOOGLE_CLOUD_PROJECT || env.GCLOUD_PROJECT || "").trim();
}

function adminErrorCode(error) {
  return String(error?.code || "admin_error").replace(/[^a-zA-Z0-9_/-]/g, "").slice(0, 80) || "admin_error";
}

async function createAdminAdapter({ projectId, credentialProjectId, modules = null }) {
  const actualProject = assertSafeProject(credentialProjectId);
  if (actualProject !== projectId) throw codedError("admin_project_mismatch", "Admin credential project does not match --project");

  const admin = modules || {
    app: require("firebase-admin/app"),
    auth: require("firebase-admin/auth"),
    firestore: require("firebase-admin/firestore"),
  };
  const appName = `app-review-seed-${projectId}`;
  const existing = admin.app.getApps().find((item) => item.name === appName);
  const firebaseApp = existing || admin.app.initializeApp({
    credential: admin.app.applicationDefault(),
    projectId,
  }, appName);
  if (String(firebaseApp.options.projectId || "") !== projectId) {
    throw codedError("admin_project_mismatch", "Initialized Admin app project does not match --project");
  }
  const auth = admin.auth.getAuth(firebaseApp);
  const db = admin.firestore.getFirestore(firebaseApp);

  return {
    async assertProject(expectedProjectId) {
      if (expectedProjectId !== projectId || actualProject !== expectedProjectId) {
        throw codedError("admin_project_mismatch", "Admin project verification failed");
      }
    },
    async ensureUser({ email, password, displayName, deterministicUid }) {
      let user;
      try {
        user = await auth.getUserByEmail(email);
      } catch (error) {
        if (error?.code !== "auth/user-not-found") throw error;
        try {
          user = await auth.createUser({
            uid: deterministicUid,
            email,
            password,
            displayName,
            emailVerified: true,
            disabled: false,
          });
        } catch (createError) {
          if (createError?.code !== "auth/email-already-exists") throw createError;
          user = await auth.getUserByEmail(email);
        }
      }
      return auth.updateUser(user.uid, {
        password,
        displayName,
        emailVerified: true,
        disabled: false,
      });
    },
    async writeSeed({ uid, profile, backup }) {
      const batch = db.batch();
      const serverTimestamp = admin.firestore.FieldValue.serverTimestamp();
      batch.set(db.doc(`users/${uid}`), { ...profile, updatedAt: serverTimestamp }, { merge: true });
      batch.set(db.doc(`users/${uid}/backup/latest`), { ...backup, at: serverTimestamp });
      await batch.commit();
    },
  };
}

function printHelp(write = console.log) {
  write("Usage: node scripts/seed-app-review.js --project <firebase-project-id> [--apply]");
  write("Default mode is dry-run. --apply requires verified Admin credentials.");
}

async function main({ argv = process.argv.slice(2), env = process.env, write = console.log, writeError = console.error, modules = null } = {}) {
  try {
    const options = parseArguments(argv);
    if (options.help) {
      printHelp(write);
      return 0;
    }
    let adapter = null;
    if (options.mode === "apply") {
      const credentialProjectId = detectCredentialProjectId(env);
      if (!credentialProjectId) throw codedError("admin_project_unverified", "Admin credential project could not be verified");
      adapter = await createAdminAdapter({ projectId: options.projectId, credentialProjectId, modules });
    }
    const result = await runSeedOperation({
      mode: options.mode,
      projectId: options.projectId,
      email: env.APP_REVIEW_EMAIL,
      password: env.APP_REVIEW_PASSWORD,
      adapter,
    });
    write(JSON.stringify(result, null, 2));
    return 0;
  } catch (error) {
    writeError(`[app-review-seed] failed code=${adminErrorCode(error)}`);
    return 1;
  }
}

if (require.main === module) {
  main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}

module.exports = {
  adminErrorCode,
  createAdminAdapter,
  detectCredentialProjectId,
  main,
  parseArguments,
};
