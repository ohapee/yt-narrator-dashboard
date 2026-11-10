#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {publicationSource} from '../src/publications.js';
import {renderPublicVideo} from './video-render.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, '.artifacts', 'public-videos'); fs.mkdirSync(directory, {recursive:true});
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
if (args.includes('--help')) { console.log('npm run publish:videos -- [--project DRIVE_FOLDER_ID] [--limit 1..100] [--render-only] [--dry-run] [--republish]'); process.exit(0); }
const projectId = option('--project',''), limit = Number(option('--limit','2')), renderOnly = args.includes('--render-only'), dryRun = args.includes('--dry-run'), republish = args.includes('--republish');
if (!Number.isInteger(limit) || limit < 1 || limit > 100 || projectId && !/^[A-Za-z0-9_-]{10,200}$/.test(projectId) || republish && !projectId) throw new Error('引数が不正です。再公開は案件を明示してください');
if (process.env.YT_VIDEO_LOCKED !== '1') {
  const child = spawnSync('flock',['-n','-E','75',path.join(directory,'runner.lock'),process.execPath,fileURLToPath(import.meta.url),...args],{stdio:'inherit',env:{...process.env,YT_VIDEO_LOCKED:'1'}});
  if (child.status === 75) console.log('他の動画生成処理が実行中です');
  if (child.error) throw child.error; process.exit(child.status === 75 ? 0 : child.status ?? 1);
}
const base = (process.env.DASHBOARD_URL || 'https://yt-narrator-dashboard.eiichi-okamine.workers.dev').replace(/\/$/,'');
const target = new URL(base); if (target.protocol !== 'https:' && !['localhost','127.0.0.1'].includes(target.hostname)) throw new Error('リモート接続にはHTTPSが必要です');
const token = process.env.ADMIN_TOKEN || fs.readFileSync(path.join(root,'.admin-password'),'utf8').trim();
async function request(endpoint, options = {}) {
  for (let attempt = 0; ; attempt++) {
    let response;
    try {
      // 長い同期レンダー中に古いkeep-alive接続が閉じられても、保存を再開できるようにする。
      response = await fetch(base + endpoint,{...options,headers:{Connection:'close',Authorization:`Bearer ${token}`,...options.headers},signal:AbortSignal.timeout(180000)});
    } catch (error) {
      if (attempt < 2) continue;
      throw new Error(`接続失敗: ${error.cause?.code || error.message}`);
    }
    if ([429,500,502,503,504].includes(response.status) && attempt < 2) {await response.body?.cancel();await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)));continue;}
    if (!response.ok) { const data = await response.json().catch(()=>({})); const error = new Error(`HTTP ${response.status}: ${data.error || '接続失敗'}`); error.status=response.status; throw error; }
    return response;
  }
}
const json = async (endpoint, body) => (await request(endpoint, body ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)} : {})).json();
if (!renderOnly && !dryRun && !(await json('/api/publications')).configured) throw new Error('Cloudflare R2が未設定です。--render-onlyでは動画の作成だけを行えます');
const catalog = await json('/api/projects');
const candidates = catalog.projects.filter(p => projectId ? p.id === projectId : p.hasVisual && p.hasAudio);
if (projectId && !candidates.length) throw new Error('指定案件がありません');
const statePath = path.join(directory,'state.json'); const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath,'utf8')) : {};
const save = () => {fs.writeFileSync(statePath+'.tmp',JSON.stringify(state,null,2),{mode:0o600});fs.renameSync(statePath+'.tmp',statePath);};
let completed=0,failed=0,processed=0;
for (const project of candidates) {
  if (processed >= limit) break;
  let source;
  try {
    const detail = await json(`/api/project/${project.id}`);
    source = await publicationSource(project.id,detail.files);
    if (!projectId && state[source.sourceHash]?.retryAfter > Date.now()) continue;
    if (!renderOnly && !dryRun) {
      let ready;
      try {ready=await json(`/api/publications/${project.id}/prepare`,{republish});}
      catch(error) {if(error.status===409 && !projectId) continue;throw error;}
      if (ready.sourceHash !== source.sourceHash) throw new Error('素材が更新されました');
      if (ready.published) continue;
    }
    processed++; console.log(`${dryRun?'対象確認':renderOnly?'動画作成':'動画作成・公開'}: ${project.name}`);
    if(dryRun)continue;
    state[source.sourceHash]={projectId:project.id,name:project.name,status:'rendering',startedAt:new Date().toISOString()};save();
    const workspace=path.join(directory,source.id,source.sourceHash);fs.mkdirSync(workspace,{recursive:true});
    const image=path.join(workspace,'image.png'),audio=path.join(workspace,'audio.mp3'),output=path.join(workspace,'video.mp4'),poster=path.join(workspace,'poster.jpg');
    for (const [file,endpoint] of [[image,`/api/image/${source.imageFileId}`],[audio,`/api/audio/${source.audioFileId}`]]) {
      if (!fs.existsSync(file)) {const response=await request(endpoint);const bytes=new Uint8Array(await response.arrayBuffer());if(!bytes.length||bytes.length>30*1024*1024)throw new Error('入力素材の容量が不正です');fs.writeFileSync(file+'.partial',bytes);fs.renameSync(file+'.partial',file);}
    }
    const metadata=renderPublicVideo(image,audio,output,poster);
    fs.writeFileSync(path.join(workspace,'video.json'),JSON.stringify({...metadata,...source},null,2));
    if (!renderOnly) {
      state[source.sourceHash].status='uploading';save();
      for (const [kind,file,type] of [['video',output,'video/mp4'],['poster',poster,'image/jpeg']]) await request(`/api/publications/${project.id}/assets/${source.sourceHash}/${kind}`,{method:'PUT',headers:{'Content-Type':type},body:fs.readFileSync(file)});
      const result=await json(`/api/publications/${project.id}`,{sourceHash:source.sourceHash,duration:metadata.duration,republish});
      console.log(`公開: ${base}/watch/?video=${result.item.id}`);
    }
    state[source.sourceHash]={...state[source.sourceHash],status:renderOnly?'rendered':'published',...metadata,finishedAt:new Date().toISOString()};save();completed++;
    console.log(`完了: ${output} (${metadata.duration.toFixed(1)}秒)`);
  } catch(error) {
    failed++;processed=Math.max(processed,completed+failed);console.error(`${project.name}: ${error.message}`);
    if(source){state[source.sourceHash]={...state[source.sourceHash],projectId:project.id,status:'failed',error:error.message,retryAfter:Date.now()+6*3600000};save();}
  }
}
console.log(`完了${completed}件、失敗${failed}件`);if(failed)process.exitCode=1;
