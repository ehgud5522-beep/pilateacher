// Keep the existing account-specific key and JSON format; no migration or shared global settings.
export async function readAccountDb(storage, key) {
  const record = await storage.get(key);
  return record?.value ? JSON.parse(record.value) : null;
}
export async function writeAccountDb(storage, key, data) {
  await storage.set(key, JSON.stringify(data));
}
