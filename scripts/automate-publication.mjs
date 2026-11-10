#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {ensurePublicHosting} from './publication-automation.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, '.artifacts', 'public-videos');
fs.mkdirSync(directory, {recursive: true});
const args = process.argv.slice(2);
if (args.includes('--help')) { console.log('npm run automate:videos -- [--limit 1..100] [--setup-only]'); process.exit(0); }
const limitIndex = args.indexOf('--limit');
const limit = limitIndex < 0 ? 2 : Number(args[limitIndex + 1]);
if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('limitは1〜100を指定してください');
if (process.env.YT_VIDEO_AUTOMATION_LOCKED !== '1') {
  const child = spawnSync('flock', ['-n', '-E', '75', path.join(directory, 'automation.lock'), process.execPath, fileURLToPath(import.meta.url), ...args], {stdio: 'inherit', env: {...process.env, YT_VIDEO_AUTOMATION_LOCKED: '1'}});
  if (child.error) throw child.error;
  if (child.status === 75) console.log('他の動画公開サイクルが実行中です');
  process.exit(child.status === 75 ? 0 : child.status ?? 1);
}
const base = (process.env.DASHBOARD_URL || 'https://yt-narrator-dashboard.eiichi-okamine.workers.dev').replace(/\/$/, '');
const url = new URL(base);
if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('リモート接続にはHTTPSが必要です');
const token = process.env.ADMIN_TOKEN || fs.readFileSync(path.join(root, '.admin-password'), 'utf8').trim();
const config = JSON.parse(fs.readFileSync(path.join(root, 'wrangler.json'), 'utf8'));
const name = config.r2_buckets?.find(item => item.binding === 'PUBLIC_VIDEOS')?.bucket_name;
if (!name || !/^[a-z0-9-]{3,63}$/.test(name)) throw new Error('PUBLIC_VIDEOSバケット名が不正です');
const statePath = path.join(directory, 'automation.json');
let state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : {};
function save(patch) {
  state = {...state, ...patch, checkedAt: new Date().toISOString(), bucket: name, publicUrl: base + '/watch/'};
  fs.writeFileSync(statePath + '.tmp', JSON.stringify(state, null, 2), {mode: 0o600});
  fs.renameSync(statePath + '.tmp', statePath);
}
const wrangler = path.join(root, 'node_modules', '.bin', 'wrangler');
function cloudflare(args) {
  return spawnSync(wrangler, args, {cwd: root, env: {...process.env, CI: '1', NO_COLOR: '1'}, encoding: 'utf8', timeout: 180000, maxBuffer: 2 * 1024 * 1024});
}
function checkedCommand(args, description) {
  const result = cloudflare(args);
  if (result.error || result.status !== 0) {
    const code = `${result.stderr || ''} ${result.stdout || ''}`.match(/code:\s*(\d+)/)?.[1];
    throw new Error(`${description}に失敗しました${code ? `（Cloudflare ${code}）` : ''}。Wranglerのログと認証を確認してください`);
  }
}
async function configured() {
  const response = await fetch(base + '/api/publications', {headers: {Authorization: `Bearer ${token}`, Connection: 'close'}, signal: AbortSignal.timeout(30000)});
  if ([401, 403].includes(response.status)) throw new Error('管理者認証が一致しません');
  if (response.status === 404) return false;
  if (!response.ok) throw new Error(`公開APIの確認に失敗しました（HTTP ${response.status}）`);
  const data = await response.json().catch(() => null); // 初回の旧WorkerはHTMLを返す場合がある。
  return data?.configured === true;
}
try {
  save({status: 'checking', lastError: null});
  const result = await ensurePublicHosting({
    configured,
    inspectBucket: async () => {
      const result = cloudflare(['r2', 'bucket', 'info', name, '--json']);
      if (result.status === 0) return 'exists';
      const message = `${result.stderr || ''} ${result.stdout || ''}`;
      if (/10042/.test(message)) return 'r2_disabled';
      if (/10006|NoSuchBucket|does not exist|not found|404/i.test(message)) return 'missing';
      throw new Error('R2の状態を確認できませんでした。Wranglerの認証・接続・ログを確認してください');
    },
    createBucket: async () => {
      save({status: 'creating_bucket'});
      checkedCommand(['r2', 'bucket', 'create', name], 'R2バケット作成');
    },
    deploy: async () => {
      save({status: 'deploying'});
      checkedCommand(['deploy'], 'Workerのデプロイ');
    }
  });
  if (result.status === 'waiting_for_r2') {
    save({status: 'waiting_for_r2', message: 'Cloudflare DashboardでR2の契約を有効化すると、次回サイクルからバケット作成・デプロイ・動画公開を自動実行します'});
    console.log('R2有効化待ち（Cloudflare 10042）。次回の定期サイクルで再確認します。');
  } else {
    save({status: 'ready', message: null, ...(result.provisioned ? {provisionedAt: new Date().toISOString()} : {})});
    console.log(`公開先を確認しました: ${base}/watch/`);
    if (!args.includes('--setup-only')) {
      save({status: 'publishing', lastCycleStartedAt: new Date().toISOString()});
      const processResult = spawnSync(process.execPath, [path.join(root, 'scripts', 'publish-videos.mjs'), '--limit', String(limit)], {cwd: root, stdio: 'inherit', env: process.env, timeout: 75 * 60000});
      if (processResult.error || processResult.status !== 0) throw new Error('動画公開サイクルで失敗がありました。state.jsonとサービスログを確認してください');
      save({status: 'ready', lastCycleFinishedAt: new Date().toISOString()});
    }
  }
} catch (error) {
  save({status: 'error', lastError: error.message});
  console.error(error.message);
  process.exitCode = 1;
}
