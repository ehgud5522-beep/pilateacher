/**
 * 센터에 아직 못 간 쓰기의 **기록**.
 *
 * ── 이름이 오래 거짓말을 했다 ──
 * 예전 이름은 `RetryMetadataStore` 였고 필드에도 `nextRetryAt` 이 있지만,
 * **다시 보내는 코드는 어디에도 없다.** 이 목록을 읽는 곳은 계정 삭제 정리
 * 하나뿐이다(App.jsx). 그래서 이것은 재시도 큐가 아니라 실패 기록이다.
 *
 * 그 사실을 이름으로 못 박는다. "재시도 큐" 라고 믿으면 다음 사람은 실패가
 * 알아서 복구된다고 생각하고, 그 믿음 위에서 화면이 아무 말도 하지 않는다 --
 * 실제로 그렇게 지냈다.
 *
 * ── 페이로드를 담지 않는 이유 ──
 * 담으면 진짜 재시도를 만들 수 있지만, 그때부터 **옛 값으로 덮어쓸 위험**이
 * 생긴다. 다른 기기가 그 사이에 더 새로운 값을 썼을 수 있기 때문이다.
 * 만든다면 서버의 updatedAt 과 견주는 장치가 함께 있어야 한다
 * (docs/handoff.md 의 남은 일).
 *
 * ── 그래서 이 기록이 하는 일 ──
 * 화면 위에 "센터에 아직 안 간 변경 N건" 을 띄우는 것. 다음에 그 회원을
 * 저장해서 성공하면 같은 열쇠가 지워지고 숫자가 준다. 사람이 다시 누르는
 * 것이 복구 수단이고, 이 목록은 **무엇을 다시 눌러야 하는지** 알려 준다.
 */

const KEY = "pilateacher_dual_write_retry_v1";

export class PendingWriteLog {
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

/**
 * 옛 이름. 부르는 곳이 남아 있을 수 있어 남겨 두지만, 새 코드는 쓰지 않는다.
 * @deprecated 이름이 하는 말이 사실이 아니다 -- PendingWriteLog 를 쓴다.
 */
export { PendingWriteLog as RetryMetadataStore };

/** 회원 문서에 대한 쓰기만. 화면이 "어느 회원" 을 말하려면 이것으로 거른다. */
export const pendingClientWrites = (entries) => (
  (Array.isArray(entries) ? entries : []).filter((entry) => entry?.entityType === "client")
);
