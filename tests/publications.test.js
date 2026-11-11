import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import worker from '../src/index.js';
import {publicationSource, publicVideoRoute, publicationAdminRoute, listPublications} from '../src/publications.js';
class Bucket {
  data=new Map();
  async put(key,body,options={}){if(options.onlyIf?.etagMatches && this.data.get(key)?.etag!==options.onlyIf.etagMatches)return null;const bytes=typeof body==='string'?Buffer.from(body):Buffer.from(body);this.data.set(key,{bytes,customMetadata:options.customMetadata||{},size:bytes.length,etag:'etag',httpEtag:'"etag"'});return this.head(key);}
  async head(key){const row=this.data.get(key);return row?{...row,key}:null;}
  async get(key,options={}){const row=await this.head(key);if(!row)return null;const bytes=options.range?row.bytes.subarray(options.range.offset,options.range.offset+options.range.length):row.bytes;return {...row,body:bytes,text:async()=>bytes.toString()};}
  async delete(key){this.data.delete(key);}
  async list(options){return {objects:[...this.data.keys()].filter(k=>k.startsWith(options.prefix)).map(key=>({...this.data.get(key),key})),truncated:false};}
}
const projectId='project00001';
const files=[{id:'image0000001',name:'visual_summary.png',mimeType:'image/png',size:'1000',modifiedTime:'2026-11-10T10:00:00Z'},{id:'audio0000001',name:'narration_tts.mp3',mimeType:'audio/mp3',size:'2000',modifiedTime:'2026-11-10T10:00:00Z'}];
const request=(path,body,method='POST',headers={})=>new Request('https://app.invalid'+path,{method,headers:{'Content-Type':'application/json',...headers},...(body!==undefined?{body:typeof body==='string'?body:JSON.stringify(body)}:{})});
function setup(t,{youtubeFile=false,youtube={url:"https://www.youtube.com/watch?v=ZeUAQ_d57QY"}}={}){
 const projectFiles=youtubeFile?[...files,{id:"youtube00001",name:"youtube.json",size:"100",modifiedTime:"v1"}]:files;
 const env={PUBLIC_VIDEOS:new Bucket(),PROJECTS_FOLDER_ID:'projectsroot000',GOOGLE_CLIENT_ID:'test',GOOGLE_CLIENT_SECRET:'test',GOOGLE_REFRESH_TOKEN:'test',ADMIN_TOKEN:'test-administrator-secret'};
 t.mock.method(globalThis,'fetch',async url=>{const u=new URL(url);if(u.hostname==='oauth2.googleapis.com')return Response.json({access_token:'fake',expires_in:3600});if(u.pathname.endsWith('/'+projectId))return Response.json({id:projectId,mimeType:'application/vnd.google-apps.folder',parents:[env.PROJECTS_FOLDER_ID]});if(u.searchParams.get('alt')==='media'&&u.pathname.endsWith('/youtube00001'))return Response.json(youtube);if(u.searchParams.get('alt')==='media')return Response.json({projects:[{id:projectId,name:'20261110_公開 <テスト>'}]});if(u.searchParams.get('q')?.includes('_catalog.json'))return Response.json({files:[{id:'catalog00001'}]});return Response.json({files:projectFiles});});return env;
}
async function seed(env){const s=await publicationSource(projectId,files);const entry={...s,projectId,title:'公開タイトル',duration:10,createdAt:'2026-11-10',updatedAt:'2026-11-10'};await env.PUBLIC_VIDEOS.put(`assets/${s.id}/${s.sourceHash}.mp4`,Buffer.alloc(100,1),{customMetadata:{sourceHash:s.sourceHash}});await env.PUBLIC_VIDEOS.put(`assets/${s.id}/${s.sourceHash}.jpg`,Buffer.alloc(30,2),{customMetadata:{sourceHash:s.sourceHash}});return entry;}

test('anonymous viewers see only committed publications, with no Drive or admin metadata',async t=>{
 const env=setup(t),entry=await seed(env);assert.equal((await worker.fetch(request('/api/publications',undefined,'GET'),env)).status,401);
 assert.deepEqual((await listPublications(env)).items,[]);
 await assert.rejects(publicVideoRoute(request(`/watch/media/${entry.id}/${entry.sourceHash}.mp4`,undefined,'GET'),env),/公開されていません/);
 const published=await publicationAdminRoute(request(`/api/publications/${projectId}`,{sourceHash:entry.sourceHash,duration:10}),env);assert.equal(published.status,200);
 const response=await worker.fetch(request('/watch/data',undefined,'GET'),env);assert.equal(response.status,200);const data=await response.json();assert.equal(data.items.length,1);assert.equal(data.items[0].projectId,undefined);assert.equal(data.items[0].imageFileId,undefined);assert.match(data.items[0].title,/<テスト>/);
});
test('public MP4 supports ranges, suffixes, HEAD, If-Range and 416',async t=>{
 const env=setup(t),entry=await seed(env);await env.PUBLIC_VIDEOS.put(`catalog/${entry.id}.json`,'{}',{customMetadata:{entry:JSON.stringify(entry)}});const path=`/watch/media/${entry.id}/${entry.sourceHash}.mp4`;
 for(const [range,expected,size] of [['bytes=0-9','bytes 0-9/100',10],['bytes=-10','bytes 90-99/100',10],['bytes=95-200','bytes 95-99/100',5]]){const response=await publicVideoRoute(request(path,undefined,'GET',{Range:range}),env);assert.equal(response.status,206);assert.equal(response.headers.get('Content-Range'),expected);assert.equal((await response.arrayBuffer()).byteLength,size);}
 assert.equal((await publicVideoRoute(request(path,undefined,'HEAD'),env)).headers.get('Content-Length'),'100');
 for(const range of ['bytes=100-','bytes=-0','bytes=0-1,5-6'])assert.equal((await publicVideoRoute(request(path,undefined,'GET',{Range:range}),env)).status,416);
 assert.equal((await publicVideoRoute(request(path,undefined,'GET',{Range:'bytes=0-9','If-Range':'"old"'}),env)).status,200);
});
test('unpublishing revokes media and prevents automatic publication until explicitly requested',async t=>{
 const env=setup(t),entry=await seed(env);await publicationAdminRoute(request(`/api/publications/${projectId}`,{sourceHash:entry.sourceHash,duration:10}),env);
 await publicationAdminRoute(request(`/api/publications/${projectId}/unpublish`),env);assert.equal((await listPublications(env)).items.length,0);
 await assert.rejects(publicVideoRoute(request(`/watch/media/${entry.id}/${entry.sourceHash}.mp4`,undefined,'GET'),env),/公開されていません/);
 await assert.rejects(publicationAdminRoute(request(`/api/publications/${projectId}/prepare`,{}),env),/非公開/);
 assert.equal((await publicationAdminRoute(request(`/api/publications/${projectId}`,{sourceHash:entry.sourceHash,duration:10,republish:true}),env)).status,200);
});
test('source changes invalidate renders and publication requires both assets',async t=>{
 const env=setup(t),source=await publicationSource(projectId,files);const changed=await publicationSource(projectId,files.map(f=>({...f,modifiedTime:'new revision'})));assert.notEqual(source.sourceHash,changed.sourceHash);
 await assert.rejects(publicationAdminRoute(request(`/api/publications/${projectId}`,{sourceHash:changed.sourceHash,duration:10}),env),/素材が変更/);
 await assert.rejects(publicationAdminRoute(request(`/api/publications/${projectId}`,{sourceHash:source.sourceHash,duration:10}),env),/アップロードが必要/);
 assert.deepEqual(await listPublications({}),{success:true,configured:false,items:[],cursor:null});
});
test('the normal deployment retains the public video bucket and narration binding',()=>{
 const config=JSON.parse(fs.readFileSync('wrangler.json'));assert.equal(config.r2_buckets[0].binding,'PUBLIC_VIDEOS');assert.equal(config.r2_buckets[0].bucket_name,'yt-narrator-public-videos');assert.equal(config.durable_objects.bindings[0].name,'JOBS');assert.deepEqual(config.triggers.crons,['0 * * * *']);
});

test('source links can be added to an existing publication without touching its video',async t=>{
 const env=setup(t,{youtubeFile:true}),entry=await seed(env);await env.PUBLIC_VIDEOS.put(`catalog/${entry.id}.json`,'{}',{customMetadata:{entry:JSON.stringify(entry)}});
 const videoKey=`assets/${entry.id}/${entry.sourceHash}.mp4`;const before=env.PUBLIC_VIDEOS.data.get(videoKey);
 const ready=await(await publicationAdminRoute(request(`/api/publications/${projectId}/prepare`,{}),env)).json();assert.equal(ready.published,true);assert.equal(ready.sourceMetadataNeedsRefresh,true);
 const updated=await(await publicationAdminRoute(request(`/api/publications/${projectId}/refresh-source`,{}),env)).json();assert.equal(updated.item.youtubeUrl,'https://www.youtube.com/watch?v=ZeUAQ_d57QY');assert.equal(env.PUBLIC_VIDEOS.data.get(videoKey),before);
 const current=await(await publicationAdminRoute(request(`/api/publications/${projectId}/prepare`,{}),env)).json();assert.equal(current.sourceMetadataNeedsRefresh,false);
 assert.equal((await listPublications(env)).items[0].youtubeUrl,updated.item.youtubeUrl);
});
test('a source-link refresh cannot recreate a concurrently unpublished manifest',async t=>{
 const env=setup(t,{youtubeFile:true}),entry=await seed(env);const key=`catalog/${entry.id}.json`;await env.PUBLIC_VIDEOS.put(key,'{}',{customMetadata:{entry:JSON.stringify(entry)}});
 const put=env.PUBLIC_VIDEOS.put.bind(env.PUBLIC_VIDEOS);t.mock.method(env.PUBLIC_VIDEOS,'put',async(key,body,options)=>{if(options?.onlyIf)await env.PUBLIC_VIDEOS.delete(key);return put(key,body,options);});
 await assert.rejects(publicationAdminRoute(request(`/api/publications/${projectId}/refresh-source`,{}),env),/公開状態が変わりました/);assert.equal(await env.PUBLIC_VIDEOS.head(key),null);
});
