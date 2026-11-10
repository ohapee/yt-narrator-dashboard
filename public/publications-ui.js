import {apiFetch, initializeSession} from './session.js';
async function load() {
  const status=document.getElementById('publication-status'),list=document.getElementById('publications');list.replaceChildren();
  try {
    let cursor='',items=[];const seen=new Set();
    do {const response=await apiFetch('/api/publications'+(cursor?'?cursor='+encodeURIComponent(cursor):''));const data=await response.json();if(!response.ok)throw new Error(data.error||'読み込み失敗');if(!data.configured){status.textContent='公開先のR2が未設定です。有効化後に動画を公開できます。';return;}items.push(...data.items);cursor=data.cursor||'';if(cursor&&seen.has(cursor))throw new Error('一覧の取得に失敗しました');if(cursor)seen.add(cursor);}while(cursor);
    items.sort((a,b)=>b.title.localeCompare(a.title,'ja'));status.textContent=`公開中 ${items.length}件`;
    for(const item of items){const row=document.createElement('section');row.style='display:flex;gap:18px;align-items:center;justify-content:space-between;border-bottom:1px solid #cbd5e1;padding:18px 0';const link=document.createElement('a');link.href='/watch/?video='+item.id;link.target='_blank';link.rel='noopener';link.textContent=item.title;const hide=document.createElement('button');hide.className='btn btn-secondary';hide.textContent='非公開にする';hide.addEventListener('click',async()=>{hide.disabled=true;try{const response=await apiFetch('/api/publications/'+encodeURIComponent(item.projectId)+'/unpublish',{method:'POST'});const data=await response.json();if(!response.ok)throw new Error(data.error||'非公開にできませんでした');await load();}catch(error){status.textContent=error.message;hide.disabled=false;}});row.append(link,hide);list.append(row);}
  }catch(error){status.textContent=error.message;}
}
initializeSession(load);
