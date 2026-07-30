import { readFile } from "node:fs/promises";
import { buildBackfillPlan } from "./backfill-plan.js";

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--write") options.write = true;
    else if (key.startsWith("--")) options[key.slice(2)] = argv[++index];
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
if (!options.fixture) throw new Error("--fixture is required; foundation v1 only accepts local fixtures");
const source = JSON.parse(await readFile(options.fixture, "utf8"));
const plan = buildBackfillPlan(source, {
  projectId: options.project,
  organizationId: options.organization,
  userId: options.user,
  write: options.write,
});
console.log(JSON.stringify(plan, null, 2));
