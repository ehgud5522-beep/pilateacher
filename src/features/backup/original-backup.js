export const sha256Blob = async blob => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),b=>b.toString(16).padStart(2,'0')).join('');
import { photoStage } from './photo-errors.js';
const fail=message=>{throw new Error(message);};
export function assertPhotoPaths(uid,photoId,item) {
  const base=`users/${uid}/photos/${photoId}/`;
  for(const [key,name] of [['storagePath','image.jpg'],['thumbnailPath','thumb.jpg'],['originalPath','original.bin']]) {
    if(item[key] && item[key]!==base+name)fail('photo/path-mismatch');
  }
  return base;
}
export async function ensureOriginalBackup({item,original,scope,path,getMetadata,upload,download}) {
  let remote, uploaded=false;
  try {remote=await photoStage('original_metadata', 'firebase_storage', getMetadata);}catch(error){
    // A missing object has no ownership metadata, so private Storage rules
    // return 403. Only an uncommitted original may attempt creation here.
    // Server rules prohibit overwriting original.bin and check current assignment.
    const newPrivateObject=error.code==='storage/unauthorized' && !item.originalPath && original && item.record?.originalSource!=='server-preview';
    if(error.code!=='storage/object-not-found' && !newPrivateObject)throw error;
  }
  const supplied=original && item.record?.originalSource!=='server-preview';
  const digest=supplied?await sha256Blob(original):item.originalSha256;
  const size=supplied?original.size:Number(item.originalBytes);
  if(!digest||!size||size>=50*1024*1024)fail('photo/original-required');
  const check=meta=>{
    if(meta.customMetadata?.sha256!==digest || Number(meta.size)!==size || meta.customMetadata?.organizationId!==scope.organizationId || meta.customMetadata?.clientId!==scope.clientId || meta.customMetadata?.moving==='true')fail('photo/original-conflict');
  };
  if(remote)check(remote);
  else {
    if(!supplied)fail('photo/original-required');
    await photoStage('original_upload', 'firebase_storage', () => upload(original,{contentType:'application/octet-stream',cacheControl:'private,no-store,max-age=0',customMetadata:{...scope,sha256:digest}}));
    uploaded=true;
    // Upload acknowledgement alone does not permit the queue to report server completion.
    remote=await photoStage('original_metadata', 'firebase_storage', getMetadata);check(remote);
  }
  // An interrupted upload can leave an object without a committed manifest.
  // A retry must verify those bytes too, rather than trusting client-written metadata.
  await photoStage('original_verify', 'firebase_storage', async () => {
    if((uploaded || !item.originalPath) && await sha256Blob(await download())!==digest)fail('photo/original-checksum');
  });
  return {originalPath:path,originalSha256:digest,originalBytes:size,originalMimeType:supplied?(original.type||'image/jpeg'):(item.originalMimeType||'image/jpeg')};
}
