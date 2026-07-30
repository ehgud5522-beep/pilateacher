import { checksum } from "./canonical.js";
import { normalizeLegacyBackup } from "./legacy-normalizer.js";
import { assertDryRun, assertSafeProject } from "./safety.js";

export function buildBackfillPlan(source, options = {}) {
  assertSafeProject(options.projectId);
  assertDryRun(options);
  const documents = normalizeLegacyBackup(source, {
    organizationId: options.organizationId,
    userId: options.userId,
  }).map((document) => ({
    ...document,
    sourceChecksum: checksum(document.data),
    operation: "upsert-if-checksum-matches",
  }));

  return {
    mode: "dry-run",
    schemaVersion: 1,
    scope: {
      organizationId: options.organizationId || null,
      userId: options.userId || source.userId || null,
    },
    resumable: true,
    deleteOperations: 0,
    documentCount: documents.length,
    countsByCollection: Object.fromEntries(
      [...new Set(documents.map((document) => document.collection))]
        .sort()
        .map((collection) => [
          collection,
          documents.filter((document) => document.collection === collection).length,
        ]),
    ),
    planChecksum: checksum(documents.map(({ collection, id, sourceChecksum }) => ({ collection, id, sourceChecksum }))),
    documents,
  };
}
