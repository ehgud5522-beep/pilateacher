// Separate transactionally persisted inbox. A failed metadata save never deletes selected files.
const open = () => new Promise((resolve, reject) => {
  const r = indexedDB.open('pilateacher_album_drafts_v1', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('drafts');
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  r.onblocked = () => reject(new Error('다른 창의 임시 저장소를 닫고 다시 시도하세요.'));
});
export async function albumDraft(accountId, action, value) {
  if (!accountId) throw new Error('로그인이 필요합니다.');
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('drafts', action === 'get' ? 'readonly' : 'readwrite');
      const store = tx.objectStore('drafts');
      const r = action === 'get' ? store.get(accountId) : action === 'delete' ? store.delete(accountId) : store.put(value, accountId);
      tx.oncomplete = () => resolve(r.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('임시 저장 실패'));
    });
  } finally { db.close(); }
}
