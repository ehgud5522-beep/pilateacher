import { checksum } from "../migration/canonical.js";
import { legacyMetrics, newMetrics } from "./metrics.js";

function ids(collection) {
  return collection.map((entry) => entry.id).filter(Boolean);
}

function duplicates(values) {
  const seen = new Set();
  return [...new Set(values.filter((value) => {
    if (seen.has(value)) return true;
    seen.add(value);
    return false;
  }))].sort();
}

export function compareStructures(legacy, current) {
  const oldMetrics = legacyMetrics(legacy);
  const nextMetrics = newMetrics(current);
  const expectedClientIds = new Set(current.expected?.clientIds ?? []);
  const actualClientIds = ids(current.collections?.clients ?? []);
  const missingDocuments = [...expectedClientIds].filter((id) => !actualClientIds.includes(id)).sort();
  const duplicateDocuments = duplicates(
    Object.entries(current.collections ?? {}).flatMap(([collection, documents]) =>
      documents.map((document) => `${collection}/${document.id}`),
    ),
  );

  const fields = [
    "clients",
    "lessons",
    "lessonsByDate",
    "attended",
    "noshow",
    "cancelled",
    "missingNotes",
    "assessments",
    "photoMetadata",
    "remainingRegular",
    "remainingService",
  ];
  const mismatches = fields
    .filter((field) => JSON.stringify(oldMetrics[field]) !== JSON.stringify(nextMetrics[field]))
    .map((field) => ({ field, legacy: oldMetrics[field], current: nextMetrics[field] }));

  const summary = {
    match: mismatches.length === 0 && missingDocuments.length === 0 && duplicateDocuments.length === 0,
    mismatches,
    missingDocuments,
    duplicateDocuments,
    sampleMismatchIds: [...missingDocuments, ...duplicateDocuments].slice(0, 10),
  };
  return {
    generatedFromFixtures: true,
    readOnly: true,
    legacy: oldMetrics,
    current: nextMetrics,
    ...summary,
    comparisonChecksum: checksum(summary),
  };
}

export function markdownReport(report) {
  const lines = [
    "# Foundation fixture validation",
    "",
    `- Result: ${report.match ? "MATCH" : "MISMATCH"}`,
    `- Read only: ${report.readOnly}`,
    `- Legacy checksum: \`${report.legacy.checksum}\``,
    `- New checksum: \`${report.current.checksum}\``,
    `- Comparison checksum: \`${report.comparisonChecksum}\``,
    "",
    "| Metric | Legacy | New |",
    "|---|---:|---:|",
  ];
  for (const field of ["clients", "lessons", "attended", "noshow", "cancelled", "missingNotes", "assessments", "photoMetadata", "remainingRegular", "remainingService"]) {
    lines.push(`| ${field} | ${report.legacy[field]} | ${report.current[field]} |`);
  }
  lines.push("", `- Missing documents: ${report.missingDocuments.length}`, `- Duplicate documents: ${report.duplicateDocuments.length}`);
  return `${lines.join("\n")}\n`;
}
