import {test} from 'node:test';import assert from 'node:assert/strict';
import {ensureOriginalBackup,sha256Blob,assertPhotoPaths} from '../../src/features/backup/original-backup.js';
const scope={organizationId:'org',clientId:'member'};
const fixture=()=>{let remote=null,bytes=null,puts=0;const original=new Blob(['original bytes'],{type:'image/jpeg'});return {get puts(){return puts;},args:{item:{},original,scope,path:'users/u/photos/p/original.bin',getMetadata:async()=>{if(!remote)throw Object.assign(Error('missing'),{code:'storage/object-not-found'});return remote;},upload:async(blob,meta)=>{puts++;bytes=blob;remote={size:blob.size,customMetadata:meta.customMetadata};},download:async()=>bytes}};};
test('original readback, cross-device restore digest and idempotent interrupted manifest retry',async()=>{
 const f=fixture();const result=await ensureOriginalBackup(f.args);assert.equal(result.originalSha256,await sha256Blob(f.args.original));
 await ensureOriginalBackup(f.args);assert.equal(f.puts,1);
 await ensureOriginalBackup({...f.args,item:result,original:null});assert.equal(f.puts,1);
});
test('missing server original, permission loss, corrupted readback, scope and path substitution fail closed',async()=>{
 const f=fixture();await assert.rejects(ensureOriginalBackup({...f.args,download:async()=>new Blob(['bad'])}),/checksum/);
 await assert.rejects(ensureOriginalBackup({...f.args,download:async()=>new Blob(['bad'])}),/checksum/);
 await assert.rejects(ensureOriginalBackup({...f.args,scope:{...scope,clientId:'other'}}),/conflict/);
 await assert.rejects(ensureOriginalBackup({...f.args,getMetadata:async()=>{throw Object.assign(Error('denied'),{code:'storage/unauthorized'});}}),/denied/);
 const missing=fixture();await assert.rejects(ensureOriginalBackup({...missing.args,original:null,item:{originalPath:'stale'}}),/original-required/);
 const reupload=fixture();await assert.rejects(ensureOriginalBackup({...reupload.args,item:{originalPath:reupload.args.path},download:async()=>new Blob(['bad'])}),/checksum/);
 assert.throws(()=>assertPhotoPaths('u','p',{originalPath:'users/u/photos/another/original.bin'}),/path-mismatch/);
});
test('a restored optimized preview is never relabelled as a high-resolution original',async()=>{
 const f=fixture();await assert.rejects(ensureOriginalBackup({...f.args,item:{record:{originalSource:'server-preview'}}}),/original-required/);assert.equal(f.puts,0);
});
test('private missing-object 403 permits only a rule-checked new upload; committed originals fail closed',async()=>{
 const f=fixture();let reads=0;
 const denied=()=>Object.assign(Error('denied'),{code:'storage/unauthorized'});
 const result=await ensureOriginalBackup({...f.args,getMetadata:async()=>{if(reads++===0)throw denied();return f.args.getMetadata();}});
 assert.equal(f.puts,1);
 await assert.rejects(ensureOriginalBackup({...f.args,item:result,getMetadata:async()=>{throw denied();}}),/denied/);
 assert.equal(f.puts,1);
 await assert.rejects(ensureOriginalBackup({...f.args,getMetadata:async()=>{throw denied();},upload:async()=>{throw denied();}}),/denied/);
});
