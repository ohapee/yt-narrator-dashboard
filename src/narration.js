import {jobRequest} from "./job-client.js";
import {getCatalog, listProjectFiles, syncCatalog} from "./catalog.js";
import { driveFetch, getProjectsFolderId, listFolderFiles, assertProjectAccess, uploadMp3ToDrive } from "./drive.js";
import { digest } from "./auth.js";
import { HttpError, requestWithRetry } from "./http.js";

export const NARRATION_SETTINGS = {engine: "edge", voice: "ja-JP-NanamiNeural", speed: 1.3, pitch: 0, revision: "ba61d94442c18893f0c4d3c5ad253718b21ab93e"};

export async function findNarrationCandidates(env, projectsFolderId, maxFolders, jobs = [], blockedProjectIds = []) {
  const catalog = await getCatalog(env);
  const knownAudio = new Set((catalog?.projects || []).filter(p => p.hasAudio).map(p => p.id));
  const blocked = new Set([...blockedProjectIds, ...jobs.filter(job => ["queued", "running", "retry_wait", "failed"].includes(job.status)).map(job => job.projectId)]);
  const candidates = [];
  let pageToken = "";
  do {
    const query = `'${projectsFolderId}' in parents and trashed = false and mimeType = 'application/vnd.google-apps.folder'`;
    const res = await driveFetch(`files?q=${encodeURIComponent(query)}&fields=nextPageToken,files(id,name,createdTime)&orderBy=createdTime&pageSize=100${pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : ""}`, env);
    if (!res.ok) throw new HttpError(502, "案件フォルダの取得に失敗しました");
    const data = await res.json();
    const folders = (data.files || []).filter(folder => !knownAudio.has(folder.id) && !blocked.has(folder.id));
    for (let offset = 0; offset < folders.length; offset += 25) {
      const batch = folders.slice(offset, offset + 25);
      const files = await listProjectFiles(batch, env);
      for (const folder of batch) {
        const contents = files.get(folder.id) || [];
        const script = contents.find(file => file.name === "narration_tts.txt");
        if (script && !contents.some(file => ["narration_tts.mp3", "narration.mp3"].includes(file.name))) candidates.push({projectId: folder.id, projectName: folder.name, scriptId: script.id});
        if (candidates.length >= maxFolders) return candidates;
      }
    }
    pageToken = data.nextPageToken;
  } while (pageToken);
  return candidates;
}

export async function enqueueNarration(env, count = 4) {
  const history = await jobRequest(env, "/status");
  const candidates = await findNarrationCandidates(env, await getProjectsFolderId(env), count, history.jobs, history.blockedProjectIds);
  const jobs = [];
  for (const candidate of candidates) {
    const res = await driveFetch(`files/${candidate.scriptId}?alt=media`, env);
    if (!res.ok) throw new HttpError(502, "ナレーション原稿の取得に失敗しました");
    const text = (await res.text()).trim();
    const scriptHash = await digest(text);
    const id = await digest(JSON.stringify({projectId: candidate.projectId, scriptHash, ...NARRATION_SETTINGS}));
    jobs.push({...candidate, id, scriptHash, settings: NARRATION_SETTINGS});
  }
  const result = await jobRequest(env, "/enqueue", {jobs});
  if (!jobs.length) await syncCatalog(env);
  return result;
}

export async function executeNarrationJob(job, env) {
  await assertProjectAccess(job.projectId, env);
  const files = await listFolderFiles(job.projectId, env);
  // アップロード後に応答を失った場合も、既存成果物を再利用して重複作成を防ぐ。
  const existing = files.find(file => ["narration_tts.mp3", "narration.mp3"].includes(file.name) && Number(file.size) > 0);
  if (existing) return {fileId: existing.id, reused: true};
  const script = files.find(file => file.name === "narration_tts.txt");
  if (!script) throw new HttpError(422, "原稿がありません");
  const textRes = await driveFetch(`files/${script.id}?alt=media`, env);
  if (!textRes.ok) throw new HttpError(502, "原稿の取得に失敗しました");
  const text = (await textRes.text()).trim();
  if (!text || text.length > 20000) throw new HttpError(422, "原稿が空、または2万文字を超えています");
  if (await digest(text) !== job.scriptHash) throw new HttpError(409, "登録後に原稿が変更されました。新しい原稿で登録し直してください");
  const url = (env.MODAL_TTS_URL || "https://ohapee--irodori-tts-service-web.modal.run").replace(/\/$/, "");
  const tts = await requestWithRetry(`${url}/api/edge-tts`, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({text, ...job.settings})}, {timeoutMs: 120000, retries: 2});
  if (!tts.ok) throw new HttpError(tts.status, `音声サービスがHTTP ${tts.status}を返しました`);
  const data = await tts.json();
  if (!data.audioBase64) throw new HttpError(502, "音声サービスから音声データが返りませんでした");
  const binary = atob(data.audioBase64);
  const audio = Uint8Array.from(binary, character => character.charCodeAt(0));
  if (audio.length < 100) throw new HttpError(502, "音声データが空です");
  const uploaded = await uploadMp3ToDrive(job.projectId, "narration_tts.mp3", audio, env);
  return {fileId: uploaded.id, bytes: audio.length, charCount: text.length};
}

export async function retryNarrationJob(env, id) {
  const history = await jobRequest(env, "/status");
  const job = history.jobs.find(job => job.id === id);
  if (!job) throw new HttpError(404, "ジョブが見つかりません");
  await assertProjectAccess(job.projectId, env);
  const files = await listFolderFiles(job.projectId, env);
  const script = files.find(file => file.name === "narration_tts.txt");
  if (!script) throw new HttpError(422, "原稿がありません");
  const response = await driveFetch(`files/${script.id}?alt=media`, env);
  if (!response.ok) throw new HttpError(502, "原稿が取得できませんでした");
  const scriptHash = await digest((await response.text()).trim());
  const newId = await digest(JSON.stringify({projectId: job.projectId, scriptHash, ...NARRATION_SETTINGS}));
  return jobRequest(env, "/retry", {id, replacement: {id: newId, projectId: job.projectId, projectName: job.projectName, scriptId: script.id, scriptHash, settings: NARRATION_SETTINGS}});
}
