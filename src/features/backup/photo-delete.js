import { photoStage } from './photo-errors.js';
export function deletePhotoManifest(read, update) {
  return photoStage('delete', 'firestore', async () => {
    const snapshot = await read();
    if (!snapshot.exists()) return { absent: true };
    await update();
    return { absent: false };
  });
}
