import {test} from 'node:test';import assert from 'node:assert/strict';
import {openManualDraft} from '../../src/features/lesson-record/manual-draft.js';
const store=()=>{const m=new Map();return {get length(){return m.size;},key:i=>[...m.keys()][i],getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};};
const scope={accountId:'teacher',memberId:'member',lessonId:'lesson'};
test('restart restores exact text, isolates account/member/lesson, and clears only after explicit successful save',()=>{
 const s=store(),a=openManualDraft(s,scope,null,'a');a.change('typed',null);
 assert.equal(openManualDraft(s,scope,null,'b').state(null).body,'typed');
 for(const [k,v] of Object.entries(scope))assert.equal(openManualDraft(s,{...scope,[k]:v+'other'},null).state(null).hasDraft,false);
 a.clear();assert.equal(openManualDraft(s,scope,{body:'saved'}).state({body:'saved'}).body,'saved');
});
test('two simultaneous writers preserve both branches and a stale completion cannot delete the newer draft',()=>{
 const s=store(),a=openManualDraft(s,scope,null,'a'),b=openManualDraft(s,scope,null,'b');
 a.change('A',null);b.change('B',null);
 assert.equal(a.state(null).conflict,true);assert.equal(b.state(null).conflict,true);
 a.clear();assert.equal(openManualDraft(s,scope,null).state(null).body,'B');
});
test('changed server record blocks silent overwrite; explicit review rebases without losing other branch',()=>{
 const s=store(),old={id:'n',body:'old'},a=openManualDraft(s,scope,old);a.change('draft',old);
 const updated={id:'n',body:'remote'};assert.equal(a.state(updated).conflict,true);
 a.change('draft',updated,{resolve:true});assert.equal(a.state(updated).conflict,false);
});
test('legacy raw text survives migration and storage failure is not reported saved',()=>{
 const s=store();s.setItem('pilateacher:manual-lesson-note:["teacher","lesson","member",""]','old draft');
 const a=openManualDraft(s,scope,null);assert.equal(a.state(null).body,'old draft');
 s.setItem=()=>{throw Error('quota');};a.change('unsaved text',null);assert.equal(a.state(null).saved,false);assert.equal(a.state(null).body,'unsaved text');
});
