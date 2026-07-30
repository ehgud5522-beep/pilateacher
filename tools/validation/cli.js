import { readFile } from "node:fs/promises";
import { compareStructures, markdownReport } from "./compare.js";

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index].startsWith("--")) options[argv[index].slice(2)] = argv[++index];
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
if (!options.legacy || !options.new) throw new Error("--legacy and --new fixture paths are required");
const legacy = JSON.parse(await readFile(options.legacy, "utf8"));
const current = JSON.parse(await readFile(options.new, "utf8"));
const report = compareStructures(legacy, current);
console.log(options.format === "markdown" ? markdownReport(report) : JSON.stringify(report, null, 2));
if (!report.match) process.exitCode = 2;
