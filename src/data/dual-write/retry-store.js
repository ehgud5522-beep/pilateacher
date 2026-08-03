const KEY = "pilateacher_dual_write_retry_v1";

export class RetryMetadataStore {
  constructor(storage) {
    this.storage = storage;
  }
  read() {
    try {
      const value = this.storage?.getItem(KEY);
      return value ? JSON.parse(value) : [];
    } catch {
      return [];
    }
  }
  record(entry) {
    const entries = this.read();
    const previous = entries.find((item) => item.idempotencyKey === entry.idempotencyKey);
    const next = {
      retryCount: (previous?.retryCount || 0) + 1,
      lastErrorCode: entry.lastErrorCode || "unknown",
      nextRetryAt: entry.nextRetryAt,
      idempotencyKey: entry.idempotencyKey,
      entityType: entry.entityType,
      entityId: entry.entityId,
      operation: entry.operation,
      createdAt: previous?.createdAt || entry.createdAt,
    };
    const updated = [...entries.filter((item) => item.idempotencyKey !== entry.idempotencyKey), next];
    this.storage?.setItem(KEY, JSON.stringify(updated));
    return next;
  }
  remove(idempotencyKey) {
    this.storage?.setItem(KEY, JSON.stringify(this.read().filter((item) => item.idempotencyKey !== idempotencyKey)));
  }
}
