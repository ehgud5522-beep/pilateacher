import { DualWriteCoordinator, mutationFingerprint } from "./coordinator.js";
import { dualWriteEnabled, legacyOrganizationId } from "./feature-flags.js";
import { RetryMetadataStore } from "./retry-store.js";
import { FirestoreClientRepository, FirestoreLessonRepository } from "../repositories/firestore-adapters.js";
import { CLIENT_STATUS, LESSON_STATUS, RECORD_STATUS } from "../schema/constants.js";

const retryStore = typeof globalThis.window === "undefined" ? null : new RetryMetadataStore(globalThis.window.localStorage);
const dualWriteEnv = typeof window === "undefined" ? {} : {
  MODE: import.meta.env.MODE,
  PROD: import.meta.env.PROD,
  VITE_FIREBASE_DUAL_WRITE_ENABLED: import.meta.env.VITE_FIREBASE_DUAL_WRITE_ENABLED,
  VITE_FIREBASE_DUAL_WRITE_UID_ALLOWLIST: import.meta.env.VITE_FIREBASE_DUAL_WRITE_UID_ALLOWLIST,
  VITE_FIREBASE_DUAL_WRITE_ORG_ALLOWLIST: import.meta.env.VITE_FIREBASE_DUAL_WRITE_ORG_ALLOWLIST,
};
const coordinator = new DualWriteCoordinator({
  enabled: (context) => dualWriteEnabled(dualWriteEnv, context),
  retryStore,
});

let writerPromise;
async function getWriter() {
  if (!writerPromise) {
    writerPromise = import("firebase/firestore").then(({ doc, getFirestore, serverTimestamp, setDoc }) => ({
      serverTimestamp,
      merge: (path, data) => setDoc(doc(getFirestore(), path), data, { merge: true }),
    }));
  }
  return writerPromise;
}

function contextFor(account, writer) {
  return {
    organizationId: legacyOrganizationId(account.id),
    locationId: null,
    userId: account.id,
    serverTimestamp: writer.serverTimestamp,
  };
}

/**
 * The legacy callback always runs first. Firestore modules are loaded only
 * after the safe-off feature gate has passed.
 */
export async function runAppDualWrite(account, descriptor, legacyWrite) {
  const baseContext = {
    organizationId: legacyOrganizationId(account.id),
    userId: account.id,
  };
  return coordinator.execute({
    context: baseContext,
    entityType: descriptor.entityType,
    entityId: descriptor.entityId,
    operation: descriptor.operation,
    version: mutationFingerprint(descriptor),
    legacyWrite,
    newWrite: async () => {
      const writer = await getWriter();
      const context = contextFor(account, writer);
      if (descriptor.entityType === "client") {
        const repository = new FirestoreClientRepository(writer);
        if (descriptor.operation === "archive") {
          return repository.archiveClient(context, { ...descriptor.payload, status: CLIENT_STATUS.ENDED });
        }
        return descriptor.operation === "create"
          ? repository.createClient(context, descriptor.payload)
          : repository.updateClient(context, descriptor.payload);
      }
      const repository = new FirestoreLessonRepository(writer);
      if (descriptor.operation === "change_status") {
        return repository.changeLessonStatus(context, descriptor.entityId, descriptor.status || LESSON_STATUS.SCHEDULED);
      }
      if (descriptor.operation === "save_record_status") {
        return repository.saveRecordStatus(context, descriptor.entityId, descriptor.status || RECORD_STATUS.MISSING);
      }
      if (descriptor.operation === "save_attendance") {
        return Promise.all((descriptor.attendance || []).map((item) =>
          repository.saveAttendance(context, descriptor.entityId, item)));
      }
      return descriptor.operation === "create"
        ? repository.createLesson(context, descriptor.payload)
        : repository.updateLesson(context, descriptor.payload);
    },
  });
}
