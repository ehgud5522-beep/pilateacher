import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readAccountDb, writeAccountDb } from '../../src/features/schedule/account-db-storage.js';
test('account storage preserves schedule colors and existing records across a fresh read',async()=>{
  const data=new Map();const storage={get:async key=>({value:data.get(key)}),set:async(key,value)=>data.set(key,value)};
  const first={settings:{scheduleColors:{private:'blue'}},members:[{id:'existing'}],lessons:[{id:'retained'}]};
  await writeAccountDb(storage,'account-a',first);
  await writeAccountDb(storage,'account-b',{settings:{scheduleColors:{private:'teal'}}});
  assert.deepEqual(await readAccountDb(storage,'account-a'),first);
  assert.equal((await readAccountDb(storage,'account-b')).settings.scheduleColors.private,'teal');
  assert.equal(await readAccountDb(storage,'absent'),null);
});
test('storage failures propagate so existing saveDb rollback can handle them',async()=>{
  await assert.rejects(writeAccountDb({set:async()=>{throw Error('full');}},'account',{}),/full/);
  await assert.rejects(readAccountDb({get:async()=>({value:'broken json'})},'account'));
});
