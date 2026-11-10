import test from 'node:test';
import assert from 'node:assert/strict';
import { recoverMemberViews } from '../../member/src/view-recovery.js';
const missing = [{ link: { clientId: 'a' }, view: null, errorCode: 'permission-denied' }];
test('healthy views never call repair', async () => {
 const places=[{view:{userId:'me'},errorCode:''}];
 assert.equal(await recoverMemberViews({places,repair:()=>assert.fail(),read:()=>assert.fail()}),places);
});
test('missing projection repairs automatically then reads it again', async () => {
 let calls=0; const ready=[{...missing[0],view:{userId:'me'},errorCode:''}];
 assert.deepEqual(await recoverMemberViews({places:missing,repair:async()=>{calls++;return {views:[{outcome:'written'}]};},read:async()=>ready}),ready);
 assert.equal(calls,1);
});
test('transient recovery failure retries once, with a delay',async()=>{
 let calls=0;let waits=0;
 const result=await recoverMemberViews({places:missing,repair:async()=>{calls++;throw Object.assign(new Error(),{code:'functions/unavailable'});},read:async()=>missing,sleep:async(ms)=>{assert.equal(ms,2000);waits++;}});
 assert.equal(calls,2);assert.equal(waits,1);assert.equal(result[0].errorCode,'functions/unavailable');
});
test('permanent failure stops and does not hide another healthy location',async()=>{
 let calls=0;const good={link:{clientId:'b'},view:{passes:[]},errorCode:''};
 const result=await recoverMemberViews({places:[...missing,good],repair:async()=>{calls++;return {views:[{outcome:'failed',code:'invalid-argument'}]};},read:async()=>[...missing,{...good,view:null,errorCode:'unavailable'}],sleep:()=>assert.fail()});
 assert.equal(calls,1);assert.equal(result[0].errorCode,'invalid-argument');assert.deepEqual(result[1],good);
});
test('absent projection cannot loop indefinitely after successful repair responses',async()=>{
 let calls=0;const result=await recoverMemberViews({places:missing,repair:async()=>{calls++;return {views:[{outcome:'present'}]};},read:async()=>missing,sleep:async()=>{}});
 assert.equal(calls,2);assert.equal(result[0].errorCode,'member_view_not_ready');
});
