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
  /* 경로가 "collection/doc" 한 쌍인 최상위 컬렉션만 본다. memberships 가 그렇고,
     정책이 거는 질의도 동등 조건 하나뿐이다. */
  const collection = (name) => {
    const rows = () => [...documents.entries()]
      .filter(([path]) => path.startsWith(`${name}/`) && path.split("/").length === 2)
      .map(([path, value]) => ({ id: path.slice(name.length + 1), data: () => value }));
    const build = (filters, max) => ({
      where: (field, operator, value) => {
        if (operator !== "==") throw new Error(`unsupported operator ${operator}`);
        return build([...filters, [field, value]], max);
      },
      limit: (count) => build(filters, count),
      get: async () => {
        const matched = rows().filter((row) => filters.every(([field, value]) => row.data()?.[field] === value));
        return { docs: Number.isFinite(max) ? matched.slice(0, max) : matched };
      },
    });
    return build([], Infinity);
  };

  return {
    doc: ref,
    collection,
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
