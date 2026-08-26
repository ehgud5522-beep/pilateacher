"use strict";

const fs = require("node:fs");
const { applicationDefault, getApps, initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { pilotMetricsMarkdown, summarizePilotMetrics } = require("../src/pilot-metrics");

function kstDate(value) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
}

function argumentsOf(argv) {
  const options = { projectId: "pilateacher", date: kstDate(new Date(Date.now() - 86400000)), fixture: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--project") options.projectId = String(argv[++index] || "");
    else if (item === "--date") options.date = String(argv[++index] || "");
    else if (item === "--fixture") options.fixture = String(argv[++index] || "");
    else if (item === "--help" || item === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${item}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.date)) throw new Error("--date must be YYYY-MM-DD");
  if (!/^[a-z0-9-]{4,40}$/.test(options.projectId)) throw new Error("--project is invalid");
  return options;
}

async function loadAttempts(options) {
  if (options.fixture) {
    const parsed = JSON.parse(fs.readFileSync(options.fixture, "utf8"));
    return Array.isArray(parsed) ? parsed : parsed.attempts || [];
  }
  const app = getApps()[0] || initializeApp({ credential: applicationDefault(), projectId: options.projectId });
  const snapshot = await getFirestore(app).collectionGroup("attempts").get();
  return snapshot.docs
    .map((entry) => ({ ...entry.data(), uid: entry.data()?.uid || entry.ref.parent.parent?.id || "unknown" }))
    .filter((entry) => entry.date === options.date);
}

async function main(argv = process.argv.slice(2)) {
  const options = argumentsOf(argv);
  if (options.help) {
    process.stdout.write("node scripts/pilot-daily-metrics.js [--project pilateacher] [--date YYYY-MM-DD] [--fixture file.json]\n");
    return;
  }
  const attempts = await loadAttempts(options);
  process.stdout.write(`${pilotMetricsMarkdown(summarizePilotMetrics(attempts, options.date))}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`pilot_metrics_failed: ${String(error?.code || error?.message || "unknown").slice(0, 160)}\n`);
    process.exitCode = 1;
  });
}

module.exports = { argumentsOf, kstDate, loadAttempts, main };
