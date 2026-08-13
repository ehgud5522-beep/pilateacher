export const ACCOUNT_DELETION_CONFIRMATION_PHRASE = "계정 삭제";
export const DELETE_CONFIRMATION_PHRASE = ACCOUNT_DELETION_CONFIRMATION_PHRASE;

export const ACCOUNT_DELETION_PHASES = Object.freeze({
  IDLE: "idle",
  REAUTHENTICATING: "reauthenticating",
  REVOKING_PROVIDER: "revoking_provider",
  DELETING_REMOTE: "deleting_remote",
  CLEANING_LOCAL: "cleaning_local",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
  FAILED_REAUTHENTICATION: "failed_reauthentication",
  FAILED_REVOCATION: "failed_revocation",
  FAILED_REMOTE: "failed_remote",
  FAILED_LOCAL: "failed_local",
});

export const ACCOUNT_DELETION_PROVIDER_REVOCATION_TIMEOUT_MS = 20000;
export const ACCOUNT_DELETION_PROVIDER_REVOCATION_TIMEOUT_CODE = "account_deletion/provider_revocation_timeout";

export const ACCOUNT_DELETION_PHASE_LABELS = Object.freeze({
  [ACCOUNT_DELETION_PHASES.IDLE]: "대기 중",
  [ACCOUNT_DELETION_PHASES.REAUTHENTICATING]: "본인 확인 중",
  [ACCOUNT_DELETION_PHASES.REVOKING_PROVIDER]: "Apple 로그인 연결 해제 중",
  [ACCOUNT_DELETION_PHASES.DELETING_REMOTE]: "계정 데이터 삭제 중",
  [ACCOUNT_DELETION_PHASES.CLEANING_LOCAL]: "기기 데이터 정리 중",
  [ACCOUNT_DELETION_PHASES.COMPLETED]: "계정 삭제 완료",
  [ACCOUNT_DELETION_PHASES.CANCELLED]: "계정 삭제 취소됨",
  [ACCOUNT_DELETION_PHASES.FAILED_REAUTHENTICATION]: "본인 확인 실패",
  [ACCOUNT_DELETION_PHASES.FAILED_REVOCATION]: "Apple 로그인 연결 해제 실패",
  [ACCOUNT_DELETION_PHASES.FAILED_REMOTE]: "계정 데이터 삭제 실패",
  [ACCOUNT_DELETION_PHASES.FAILED_LOCAL]: "기기 데이터 정리 실패",
});

export function withProviderRevocationTimeout(operation, {
  timeoutMs = ACCOUNT_DELETION_PROVIDER_REVOCATION_TIMEOUT_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  if (typeof operation !== "function") throw new TypeError("Provider revocation operation is required");
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimer(() => {
      reject(Object.assign(new Error("Provider revocation did not respond in time."), {
        code: ACCOUNT_DELETION_PROVIDER_REVOCATION_TIMEOUT_CODE,
      }));
    }, timeoutMs);
  });
  return Promise.race([Promise.resolve().then(operation), timeout])
    .finally(() => clearTimer(timer));
}

const DEFAULT_BLOB_ID_FIELDS = new Set([
  "blobId",
  "cleanBlobId",
  "audioBlobId",
  "recordingBlobId",
]);

export class AccountDeletionFlowError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "AccountDeletionFlowError";
    this.code = code;
    this.phase = options.phase ?? ACCOUNT_DELETION_PHASES.IDLE;
    this.remoteDeleted = options.remoteDeleted === true;
    this.cancelled = options.cancelled === true;
  }
}

export function isAccountDeletionPhraseConfirmed(value) {
  return typeof value === "string" && value.normalize("NFC").trim() === ACCOUNT_DELETION_CONFIRMATION_PHRASE;
}

function addStringValue(target, value) {
  if (typeof value === "string" && value.trim()) target.add(value.trim());
}

/**
 * Recursively gathers only local binary references. Data URLs and remote URLs
 * are intentionally ignored; deleting those is not a client IndexedDB action.
 */
export function collectReferencedBlobIds(value, { blobIdFields = DEFAULT_BLOB_ID_FIELDS } = {}) {
  const ids = new Set();
  const visited = new WeakSet();

  function visit(current, parentKey = "") {
    if (current === null || current === undefined) return;
    if (typeof current === "string") {
      if (blobIdFields.has(parentKey)) addStringValue(ids, current);
      return;
    }
    if (typeof current !== "object") return;
    if (visited.has(current)) return;
    visited.add(current);

    if (Array.isArray(current)) {
      for (const item of current) {
        if (parentKey === "blobIds") addStringValue(ids, item);
        else visit(item, parentKey);
      }
      return;
    }

    for (const [key, nested] of Object.entries(current)) {
      if (blobIdFields.has(key)) addStringValue(ids, nested);
      else if (key === "blobIds" && Array.isArray(nested)) visit(nested, key);
      else visit(nested, key);
    }
  }

  visit(value);
  return [...ids].sort();
}

export function collectOwnedBlobIds(db, photos) {
  return collectReferencedBlobIds([db, photos]);
}

function isCancellation(error) {
  if (!error || typeof error !== "object") return false;
  const record = /** @type {Record<string, unknown>} */ (error);
  const code = typeof record.code === "string" ? record.code.toLowerCase() : "";
  return record.cancelled === true || code.includes("cancel") || code === "auth/popup-closed-by-user";
}

function assertNotAborted(signal) {
  if (!signal?.aborted) return;
  throw new AccountDeletionFlowError(
    "account_deletion/cancelled",
    "계정 삭제가 취소되었습니다.",
    { phase: ACCOUNT_DELETION_PHASES.CANCELLED, cancelled: true },
  );
}

function isSuccessfulServerResult(result) {
  if (!result || typeof result !== "object") return false;
  const record = /** @type {Record<string, unknown>} */ (result);
  return record.deleted === true || record.status === "deleted" || record.status === "already_deleted";
}

function serverErrorCode(error) {
  if (!error || typeof error !== "object") return "";
  const record = /** @type {Record<string, unknown>} */ (error);
  const details = record.details && typeof record.details === "object"
    ? /** @type {Record<string, unknown>} */ (record.details)
    : {};
  return String(details.code || record.code || "").replace(/^functions\//, "");
}

/**
 * Runs a destructive account operation in the only safe order:
 * reauthentication -> trusted server deletion -> local cleanup.
 * Local data is untouched whenever reauthentication or server deletion fails.
 */
export async function runAccountDeletion({
  confirmationPhrase,
  provider = "unknown",
  password = "",
  reauthenticate,
  revokeApple = undefined,
  deleteServerAccount,
  cleanupLocalData,
  localDataSnapshot = undefined,
  onPhase = (_phase) => {},
  signal = undefined,
  providerRevocationTimeoutMs = ACCOUNT_DELETION_PROVIDER_REVOCATION_TIMEOUT_MS,
  setProviderRevocationTimer = setTimeout,
  clearProviderRevocationTimer = clearTimeout,
}) {
  if (!isAccountDeletionPhraseConfirmed(confirmationPhrase)) {
    throw new AccountDeletionFlowError(
      "account_deletion/confirmation_required",
      `확인을 위해 '${ACCOUNT_DELETION_CONFIRMATION_PHRASE}'를 정확히 입력해 주세요.`,
    );
  }
  if (typeof reauthenticate !== "function" || typeof deleteServerAccount !== "function" || typeof cleanupLocalData !== "function") {
    throw new TypeError("Account deletion dependencies are required");
  }

  const emit = (phase) => onPhase(phase);
  assertNotAborted(signal);
  emit(ACCOUNT_DELETION_PHASES.REAUTHENTICATING);
  let reauthentication;
  try {
    reauthentication = await reauthenticate({ provider, password });
  } catch (error) {
    const cancelled = isCancellation(error);
    const phase = cancelled ? ACCOUNT_DELETION_PHASES.CANCELLED : ACCOUNT_DELETION_PHASES.FAILED_REAUTHENTICATION;
    emit(phase);
    throw new AccountDeletionFlowError(
      cancelled ? "account_deletion/cancelled" : "account_deletion/reauthentication_failed",
      cancelled ? "계정 삭제가 취소되었습니다." : "본인 확인에 실패했습니다. 다시 로그인한 뒤 시도해 주세요.",
      { phase, cancelled },
    );
  }

  assertNotAborted(signal);
  if (provider === "apple" && typeof revokeApple === "function") {
    emit(ACCOUNT_DELETION_PHASES.REVOKING_PROVIDER);
    try {
      await withProviderRevocationTimeout(
        () => revokeApple({ reauthentication }),
        {
          timeoutMs: providerRevocationTimeoutMs,
          setTimer: setProviderRevocationTimer,
          clearTimer: clearProviderRevocationTimer,
        },
      );
    } catch (error) {
      emit(ACCOUNT_DELETION_PHASES.FAILED_REVOCATION);
      const timedOut = error?.code === ACCOUNT_DELETION_PROVIDER_REVOCATION_TIMEOUT_CODE;
      throw new AccountDeletionFlowError(
        timedOut ? ACCOUNT_DELETION_PROVIDER_REVOCATION_TIMEOUT_CODE : "account_deletion/provider_revocation_failed",
        "Apple 로그인 연결 해제를 완료하지 못했습니다. 계정 데이터는 유지되었습니다.",
        { phase: ACCOUNT_DELETION_PHASES.FAILED_REVOCATION },
      );
    }
    assertNotAborted(signal);
  }

  emit(ACCOUNT_DELETION_PHASES.DELETING_REMOTE);
  let serverResult;
  try {
    serverResult = await deleteServerAccount({ provider, reauthentication });
    if (!isSuccessfulServerResult(serverResult)) {
      throw new Error("The server did not confirm account deletion");
    }
  } catch (error) {
    emit(ACCOUNT_DELETION_PHASES.FAILED_REMOTE);
    const code = serverErrorCode(error);
    if (code === "sole_organization_owner") {
      throw new AccountDeletionFlowError(
        "account_deletion/sole_organization_owner",
        "현재 센터의 유일한 소유자입니다. 다른 관리자를 소유자로 지정한 뒤 다시 시도해 주세요.",
        { phase: ACCOUNT_DELETION_PHASES.FAILED_REMOTE },
      );
    }
    if (code === "unauthenticated" || code === "reauthentication_required") {
      throw new AccountDeletionFlowError(
        "account_deletion/requires_recent_login",
        "본인 확인 시간이 만료되었습니다. 다시 로그인한 뒤 계정 삭제를 시도해 주세요.",
        { phase: ACCOUNT_DELETION_PHASES.FAILED_REMOTE },
      );
    }
    throw new AccountDeletionFlowError(
      "account_deletion/server_failed",
      "계정 삭제를 완료하지 못했습니다. 기기 데이터는 유지되었습니다. 잠시 후 다시 시도해 주세요.",
      { phase: ACCOUNT_DELETION_PHASES.FAILED_REMOTE },
    );
  }

  emit(ACCOUNT_DELETION_PHASES.CLEANING_LOCAL);
  const blobIds = collectReferencedBlobIds(localDataSnapshot);
  try {
    await cleanupLocalData({ blobIds, serverResult, provider });
  } catch (_error) {
    emit(ACCOUNT_DELETION_PHASES.FAILED_LOCAL);
    throw new AccountDeletionFlowError(
      "account_deletion/local_cleanup_failed",
      "서버 계정은 삭제되었지만 이 기기의 로컬 데이터 정리가 완료되지 않았습니다.",
      { phase: ACCOUNT_DELETION_PHASES.FAILED_LOCAL, remoteDeleted: true },
    );
  }

  emit(ACCOUNT_DELETION_PHASES.COMPLETED);
  return Object.freeze({ status: "deleted", blobIds, serverResult });
}
