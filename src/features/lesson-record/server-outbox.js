/**
 * 수업기록 "보낼 줄" (설계 문서 1단계-2, 2026-11-16 대표 승인).
 *
 * 기기 저장이 끝난 확정 기록을 서버(lessonRecords)로 보낸다. 원칙 셋:
 *  1. **서버가 받았다고 답할 때까지 지우지 않는다.** 앱을 꺼도 기기에 남는다 (localStorage).
 *  2. 서버는 새 줄만 받는다. 같은 기록ID 가 이미 있으면 보낸 것으로 친다(먼저 읽어 본다) --
 *     규칙은 덮어쓰기를 막으므로, 읽지 않고 쓰면 "이미 있음" 이 권한 거부와 구별되지 않는다.
 *  3. 다시 시도는 일시 오류만 (연결 · 서버 일시 장애 · 시간 초과 · 한도). 권한 거부 · 형식 오류 같은 결정적
 *     오류는 기록을 남겨 두고(CLAUDE.md §5) 자동으로 되풀이하지 않는다 -- 앱을 다시 열 때 한 번 더 본다.
 *
 * 저장소(store)는 주입한다: read(path) -> 문서 | null, create(path, data) -> void. 테스트는 가짜를 쓴다.
 */

const text = (value) => String(value ?? "").trim();

export const OUTBOX_STORAGE_PREFIX = "pilateacher_lesson_record_outbox_v1";
const TRANSIENT = new Set(["unavailable", "deadline-exceeded", "resource-exhausted", "aborted", "internal", "cancelled", "network", "network-request-failed", "timeout"]);
const MAX_ITEMS = 500;
const BACKOFF_MS = [30e3, 2 * 60e3, 10 * 60e3, 30 * 60e3, 2 * 60 * 60e3];

/** 그 계정의 보낼 줄 키. 다른 계정으로 바꿔 로그인해도 섞이지 않는다. */
export const outboxKeyFor = (uid) => `${OUTBOX_STORAGE_PREFIX}_${text(uid) || "anonymous"}`;

const codeOf = (error) => text(error?.code || error?.name || "unknown").replace(/^firestore\//, "").replace(/^functions\//, "").toLowerCase();
export const isTransientOutboxError = (error) => TRANSIENT.has(codeOf(error));

export const lessonRecordPath = (organizationId, recordId) => `organizations/${text(organizationId)}/lessonRecords/${text(recordId)}`;

/**
 * @param {{
 *   storage?: Storage, key: string,
 *   store: { read: (path: string) => Promise<any>, create: (path: string, data: any) => Promise<void> },
 *   now?: () => number, log?: (event: string, details?: any) => void,
 * }} options
 */
export function createServerOutbox({ storage = globalThis.localStorage, key, store, now = () => Date.now(), log = () => {} }) {
  const readAll = () => {
    try {
      const parsed = JSON.parse(storage?.getItem(key) || "[]");
      return Array.isArray(parsed) ? parsed.filter((item) => item && text(item.recordId) && text(item.path)) : [];
    } catch (_error) { return []; }
  };
  const writeAll = (items) => {
    try { storage?.setItem(key, JSON.stringify(items.slice(-MAX_ITEMS))); return true; } catch (_error) { return false; }
  };
  let flushing = null;

  return {
    /** 넣는다. 같은 기록ID 는 한 번만. */
    enqueue({ recordId, organizationId, data }) {
      const id = text(recordId);
      if (!id || !text(organizationId) || !data) return false;
      const items = readAll();
      if (items.some((item) => item.recordId === id)) return true;
      items.push({ recordId: id, path: lessonRecordPath(organizationId, id), data, attempts: 0, nextAt: 0, lastError: null, queuedAt: now() });
      const stored = writeAll(items);
      if (!stored) log("lesson_record_outbox_store_failed", { stage: "enqueue", errorCode: "storage_write_failed" });
      return stored;
    },

    pending() { return readAll(); },

    /**
     * 보낼 차례인 것을 보낸다. 겹쳐 부르면 앞의 것을 기다린다.
     * @param {{ includeBlocked?: boolean }} [options] includeBlocked: 결정적 오류로 멈춘 것도 한 번 더 (앱을 다시 열 때)
     */
    flush(options = {}) {
      if (flushing) return flushing;
      flushing = (async () => {
        const summary = { sent: 0, alreadyThere: 0, retryLater: 0, blocked: 0 };
        for (const item of readAll()) {
          const blocked = Boolean(item.lastError && !item.lastError.transient);
          if (blocked && !options.includeBlocked) { summary.blocked += 1; continue; }
          if (!blocked && item.nextAt > now()) { summary.retryLater += 1; continue; }
          let stage = "read";
          try {
            const existing = await store.read(item.path);
            if (existing) {
              summary.alreadyThere += 1;
            } else {
              stage = "write";
              await store.create(item.path, item.data);
              summary.sent += 1;
            }
            writeAll(readAll().filter((entry) => entry.recordId !== item.recordId));
          } catch (error) {
            const transient = isTransientOutboxError(error);
            const attempts = (item.attempts || 0) + 1;
            const lastError = { code: codeOf(error), stage, transient, at: now() };
            writeAll(readAll().map((entry) => (entry.recordId === item.recordId
              ? { ...entry, attempts, lastError, nextAt: transient ? now() + BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)] : 0 }
              : entry)));
            if (transient) summary.retryLater += 1; else summary.blocked += 1;
            log("lesson_record_server_write_failed", {
              feature: "lesson_record", stage, errorDomain: "firestore", errorCode: lastError.code,
              transient, attempts, correlationId: item.recordId.slice(-8),
            });
          }
        }
        return summary;
      })();
      return flushing.finally(() => { flushing = null; });
    },
  };
}
