import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {initializeTestEnvironment,assertFails} from '@firebase/rules-unit-testing';
import {doc,setDoc} from 'firebase/firestore';import {ref,getMetadata,uploadBytesResumable,getBytes} from 'firebase/storage';
import {ensureOriginalBackup,sha256Blob} from '../../src/features/backup/original-backup.js';
test('real Storage transfer verifies original bytes, idempotent retry and another device; revocation rejects cached credentials',async()=>{
 const env=await initializeTestEnvironment({projectId:'pilateacher-dev',firestore:{rules:await readFile('firestore.foundation.rules','utf8')},storage:{rules:await readFile('storage.rules','utf8')}});
 try{
  const scope={organizationId:'transfer-org',clientId:'transfer-member'},uid='transfer-teacher';
  await env.withSecurityRulesDisabled(async ctx=>{
   await setDoc(doc(ctx.firestore(),`memberships/${scope.organizationId}_${uid}`),{status:'active',role:'instructor'});
   await setDoc(doc(ctx.firestore(),`organizations/${scope.organizationId}/clients/${scope.clientId}`),{instructorIds:[uid]});
  });
  const path=`users/${uid}/photos/original-${Date.now()}/original.bin`,object=ref(env.authenticatedContext(uid).storage(),path);
  const original=new Blob([new Uint8Array(1024*1024).fill(73)],{type:'image/jpeg'});let puts=0;
  const args={item:{},original,scope,path,getMetadata:()=>getMetadata(object),upload:async(blob,metadata)=>{puts++;return uploadBytesResumable(object,new Uint8Array(await blob.arrayBuffer()),metadata);},download:async()=>new Blob([await getBytes(object)])};
  const saved=await ensureOriginalBackup(args);assert.equal(saved.originalBytes,original.size);
  await ensureOriginalBackup(args);assert.equal(puts,1);
  const otherDevice=ref(env.authenticatedContext(uid).storage(),path);
  assert.equal(await sha256Blob(new Blob([await getBytes(otherDevice)])),saved.originalSha256);
  await assertFails(getBytes(ref(env.authenticatedContext('different-member').storage(),path)));
  await env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),`organizations/${scope.organizationId}/clients/${scope.clientId}`),{instructorIds:[]}));
  await assertFails(getBytes(object));await assert.rejects(ensureOriginalBackup({...args,item:saved}));
 }finally{await env.cleanup();}
});
