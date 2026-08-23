"use strict";

function createFakeFirestore(seed = {}) {
  const documents = new Map(Object.entries(seed));
  const snapshot = (path) => ({
    exists: documents.has(path),
    data: () => documents.get(path),
  });
  const ref = (path) => ({
    path,
    get: async () => snapshot(path),
  });
  return {
    doc: ref,
    async runTransaction(callback) {
      const mutations = [];
      const result = await callback({
        get: async (documentRef) => snapshot(documentRef.path),
        set: (documentRef, value) => mutations.push({ type: "set", path: documentRef.path, value }),
        delete: (documentRef) => mutations.push({ type: "delete", path: documentRef.path }),
      });
      for (const mutation of mutations) {
        if (mutation.type === "delete") documents.delete(mutation.path);
        else documents.set(mutation.path, mutation.value);
      }
      return result;
    },
    read(path) {
      return documents.get(path);
    },
  };
}

module.exports = { createFakeFirestore };
