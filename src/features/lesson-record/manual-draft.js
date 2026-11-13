// Device-only branches: simultaneous tabs never overwrite one another's text.
export const manualDraftKey = (accountId, memberId, lessonId) => accountId && memberId && lessonId
  ? `pilateacher:manual-lesson-note:${JSON.stringify([accountId, lessonId, memberId])}:v2:` : '';
export const noteVersion = note => JSON.stringify([note?.id || '', note?.body || '', note?.updatedAt || '']);
export function openManualDraft(storage, scope, note, writer = globalThis.crypto.randomUUID()) {
  const prefix = manualDraftKey(scope.accountId, scope.memberId, scope.lessonId);
  const scan = () => {
    const rows=[];
    if (!prefix) return rows;
    for(let i=0;i<storage.length;i++) { const key=storage.key(i); if(!key?.startsWith(prefix))continue;
      try { const value=JSON.parse(storage.getItem(key)); if(value?.version===2 && typeof value.body==='string')rows.push({...value,key}); } catch { /* retain malformed data */ }
    }
    return rows;
  };
  let known=scan();
  const heads=rows=>rows.filter(row=>!rows.some(other=>other.parents?.includes(row.key)));
  let candidates=heads(known).sort((a,b)=>b.at-a.at), current=candidates[0] || null;
  const legacyKey=scope.accountId&&scope.memberId&&scope.lessonId?`pilateacher:manual-lesson-note:${JSON.stringify([scope.accountId,scope.lessonId,scope.memberId,note?.id||''])}`:'';
  let legacy=legacyKey?storage.getItem(legacyKey):null;
  let body=current?.body ?? legacy ?? note?.body ?? '', base=current?.base ?? noteVersion(note), acknowledged=false;
  let saved=!!current || legacy!==null, pristine=!current && legacy===null;
  const key=prefix+writer;
  const state=latestNote=>{
    const rows=scan(), others=heads(rows).filter(row=>row.key!==key && !known.some(old=>old.key===row.key && old.revision===row.revision));
    return {body:pristine?(latestNote?.body||''):body,saved,hasDraft:!pristine,
      conflict:!pristine&&(base!==noteVersion(latestNote)||others.length>0||(!acknowledged&&candidates.length>1)),
      alternatives:heads(rows).filter(row=>row.body!==body).map(row=>row.body), base:pristine?noteVersion(latestNote):base};
  };
  const change=(text,latestNote,{resolve=false}={})=>{
    if(pristine)base=noteVersion(latestNote);
    body=text;pristine=false;
    if(!prefix){saved=false;return state(latestNote);}
    if(resolve){known=scan();candidates=heads(known);base=noteVersion(latestNote);acknowledged=true;}
    current={version:2,body,base,parents:known.filter(row=>row.key!==key).map(row=>row.key),at:Date.now(),revision:globalThis.crypto.randomUUID(),key};
    try {storage.setItem(key,JSON.stringify(current));saved=true;}catch{saved=false;}
    return state(latestNote);
  };
  const clear=()=>{
    // A save in one tab must not erase text written in another tab while awaiting the server.
    for(const row of [...known,...(current?[current]:[])]){const raw=storage.getItem(row.key);try{if(JSON.parse(raw)?.revision===row.revision)storage.removeItem(row.key);}catch{}}
    if(legacy!==null&&storage.getItem(legacyKey)===legacy)storage.removeItem(legacyKey);
    current=null;saved=false;legacy=null;pristine=true;known=[];candidates=[];
  };
  return {state,change,clear};
}
