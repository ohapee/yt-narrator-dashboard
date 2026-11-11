import {assertProjectAccess, listFolderFiles, driveFetch} from "./drive.js";
import {getCatalog} from "./catalog.js";
import {textHash} from "./visuals.js";
import {HttpError, readJson} from "./http.js";
import {youtubeUrl} from "../public/youtube-links.js";

export const VIDEO_VERSION = "shorts-still-aac-v2";
export const VIDEO_LIMIT = 25 * 1024 * 1024;
const idPattern = /^[a-f0-9]{32}$/;
const hashPattern = /^[a-f0-9]{64}$/;
const bucket = env => { if (!env.PUBLIC_VIDEOS) throw new HttpError(503, "Cloudflare R2の有効化とPUBLIC_VIDEOSバインディングが必要です"); return env.PUBLIC_VIDEOS; };
const manifestKey = id => `catalog/${id}.json`;
const assetKey = (id, hash, kind) => `assets/${id}/${hash}.${kind === "video" ? "mp4" : "jpg"}`;
const publicEntry = entry => ({id: entry.id, title: entry.title, sourceHash: entry.sourceHash, duration: entry.duration, width: 1080, height: 1920, createdAt: entry.createdAt, updatedAt: entry.updatedAt, youtubeUrl: youtubeUrl(entry.youtubeUrl), videoUrl: `/watch/media/${entry.id}/${entry.sourceHash}.mp4`, posterUrl: `/watch/media/${entry.id}/${entry.sourceHash}.jpg`});
function entryOf(object) { try { return JSON.parse(object?.customMetadata?.entry || "null"); } catch (_) { return null; } }
const youtubeRevision = files => { const file = files.find(f => f.name === "youtube.json"); return file ? `${file.id}:${file.modifiedTime || ""}:${file.size || ""}` : "missing"; };
async function sourceLink(files, env) {
  const file = files.find(f => f.name === "youtube.json");
  let metadata = null;
  if (file) {
    const response = await driveFetch(`files/${file.id}?alt=media`, env);
    if (!response.ok) throw new HttpError(502, "元動画情報の取得に失敗しました");
    try { metadata = await response.json(); } catch (_) { throw new HttpError(422, "元動画情報のJSONが不正です"); }
  }
  return {youtubeUrl: youtubeUrl(metadata), youtubeMetadataRevision: youtubeRevision(files), sourceMetadataVersion: 1};
}

export async function publicationSource(projectId, files) {
  const image = files.find(f => f.name === "visual_summary.png" && f.mimeType === "image/png");
  const audio = files.find(f => ["narration_tts.mp3", "narration.mp3"].includes(f.name) && f.mimeType?.startsWith("audio/"));
  if (!image || !audio) throw new HttpError(409, "新方式の画像とナレーション音声が必要です");
  const signature = file => ({id: file.id, modifiedTime: file.modifiedTime || "", size: String(file.size || "")});
  return {id: (await textHash(projectId)).slice(0, 32), sourceHash: await textHash(JSON.stringify({projectId, image: signature(image), audio: signature(audio), version: VIDEO_VERSION})), imageFileId: image.id, audioFileId: audio.id};
}

export async function listPublications(env, cursor, admin = false) {
  if (!env.PUBLIC_VIDEOS) return {success: true, configured: false, items: [], cursor: null};
  const result = await bucket(env).list({prefix: "catalog/", limit: 100, include: ["customMetadata"], ...(cursor ? {cursor} : {})});
  const items = result.objects.map(entryOf).filter(Boolean).map(entry => ({...publicEntry(entry), ...(admin ? {projectId: entry.projectId} : {})}));
  return {success: true, configured: true, items, cursor: result.truncated ? result.cursor : null};
}

export async function publicVideoRoute(request, env) {
  const url = new URL(request.url);
  if (!["GET", "HEAD"].includes(request.method)) throw new HttpError(405, "GETまたはHEADを使用してください");
  if (url.pathname === "/watch/data") return Response.json(await listPublications(env, url.searchParams.get("cursor")), {headers: {"Cache-Control": "no-store"}});
  const match = url.pathname.match(/^\/watch\/media\/([a-f0-9]{32})\/([a-f0-9]{64})\.(mp4|jpg)$/);
  if (!match) throw new HttpError(404, "動画が見つかりません");
  const [, id, hash, extension] = match;
  const store = bucket(env);
  const entry = entryOf(await store.head(manifestKey(id)));
  if (!entry || entry.sourceHash !== hash) throw new HttpError(404, "動画は公開されていません");
  const key = assetKey(id, hash, extension === "mp4" ? "video" : "poster");
  const head = await store.head(key);
  if (!head) throw new HttpError(404, "素材がありません");
  const headers = {"Content-Type": extension === "mp4" ? "video/mp4" : "image/jpeg", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Accept-Ranges": "bytes", ETag: head.httpEtag};
  let range;
  const rawRange = request.headers.get("Range");
  const ifRange = request.headers.get("If-Range");
  if (rawRange && (!ifRange || ifRange === head.httpEtag)) {
    const parsed = rawRange.match(/^bytes=(\d*)-(\d*)$/);
    if (!parsed || !parsed[1] && !parsed[2]) return new Response(null, {status: 416, headers: {...headers, "Content-Range": `bytes */${head.size}`}});
    const start = parsed[1] ? Number(parsed[1]) : Math.max(0, head.size - Number(parsed[2]));
    const end = parsed[1] && parsed[2] ? Math.min(head.size - 1, Number(parsed[2])) : head.size - 1;
    if (![start, end].every(Number.isSafeInteger) || start < 0 || start > end || start >= head.size) return new Response(null, {status: 416, headers: {...headers, "Content-Range": `bytes */${head.size}`}});
    range = {offset: start, length: end - start + 1};
    headers["Content-Range"] = `bytes ${start}-${end}/${head.size}`;
  }
  headers["Content-Length"] = String(range ? range.length : head.size);
  if (request.method === "HEAD") return new Response(null, {status: range ? 206 : 200, headers});
  const object = await store.get(key, range ? {range} : {});
  if (!object) throw new HttpError(404, "素材がありません");
  return new Response(object.body, {status: range ? 206 : 200, headers});
}

async function readAsset(request, limit) {
  const length = Number(request.headers.get("Content-Length"));
  if (!Number.isSafeInteger(length) || length < 24 || length > limit) throw new HttpError(413, "ファイル容量が不正です（動画は25MB以下）");
  const chunks = []; let size = 0;
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "素材がありません");
  for (;;) { const {value, done} = await reader.read(); if (done) break; size += value.length; if (size > limit) { await reader.cancel(); throw new HttpError(413, "素材が大きすぎます"); } chunks.push(value); }
  if (size !== length) throw new HttpError(400, "ファイル容量が一致しません");
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

export async function publicationAdminRoute(request, env) {
  const url = new URL(request.url);
  if (url.pathname === "/api/publications" && request.method === "GET") return Response.json(await listPublications(env, url.searchParams.get("cursor"), true));
  const match = url.pathname.match(/^\/api\/publications\/([A-Za-z0-9_-]{10,200})(?:\/(prepare|unpublish|refresh-source|assets\/([a-f0-9]{64})\/(video|poster)))?$/);
  if (!match) throw new HttpError(404, "公開操作が見つかりません");
  const [, projectId, action, requestedHash, kind] = match;
  const store = bucket(env);
  if (request.method !== (kind ? "PUT" : "POST")) throw new HttpError(405, "操作メソッドが不正です");
  await assertProjectAccess(projectId, env);
  const id = (await textHash(projectId)).slice(0, 32);
  if (!idPattern.test(id)) throw new HttpError(400, "公開IDが不正です");
  if (action === "unpublish") {
    await store.put(`controls/${id}.json`, JSON.stringify({hidden: true, at: new Date().toISOString()}), {customMetadata: {hidden: "true"}});
    await store.delete(manifestKey(id));
    return Response.json({success: true});
  }
  const files = await listFolderFiles(projectId, env);
  if (action === "refresh-source") {
    const existing = await store.head(manifestKey(id));
    const previous = entryOf(existing);
    if (!previous || await store.head(`controls/${id}.json`)) throw new HttpError(409, "公開中の動画だけ元動画情報を更新できます");
    const entry = {...previous, ...await sourceLink(files, env)};
    const saved = await store.put(manifestKey(id), JSON.stringify(entry), {onlyIf: {etagMatches: existing.etag}, httpMetadata: {contentType: "application/json"}, customMetadata: {entry: JSON.stringify(entry)}});
    if (!saved) throw new HttpError(409, "公開状態が変わりました。再確認してください");
    return Response.json({success: true, item: publicEntry(entry)});
  }
  const source = await publicationSource(projectId, files);
  const body = kind ? null : await readJson(request);
  const hidden = await store.head(`controls/${id}.json`);
  if (hidden && !kind && body?.republish !== true) throw new HttpError(409, "非公開にした案件です。再公開を明示してください");
  if (action === "prepare") {
    const previous = entryOf(await store.head(manifestKey(id)));
    return Response.json({success: true, ...source, published: previous?.sourceHash === source.sourceHash, sourceMetadataNeedsRefresh: !!previous && (previous.sourceMetadataVersion !== 1 || previous.youtubeMetadataRevision !== youtubeRevision(files))});
  }
  if ((requestedHash || body?.sourceHash) !== source.sourceHash || !hashPattern.test(source.sourceHash)) throw new HttpError(409, "素材が変更されました。動画を作り直してください");
  if (kind) {
    // 再公開用の素材アップロード自体は許可する。公開されるのは最後のPOST成功後のみ。
    const contentType = kind === "video" ? "video/mp4" : "image/jpeg";
    if (request.headers.get("Content-Type") !== contentType) throw new HttpError(415, "素材形式が不正です");
    const bytes = await readAsset(request, kind === "video" ? VIDEO_LIMIT : 1024 * 1024);
    if (kind === "video" ? new TextDecoder().decode(bytes.subarray(4, 8)) !== "ftyp" : bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255) throw new HttpError(400, "素材ファイルが不正です");
    const key = assetKey(id, source.sourceHash, kind);
    const existing = await store.head(key);
    if (!existing) await store.put(key, bytes, {httpMetadata: {contentType}, customMetadata: {sourceHash: source.sourceHash}});
    return Response.json({success: true, reused: !!existing});
  }
  if (!Number.isFinite(body.duration) || body.duration < 0.1 || body.duration > 7200) throw new HttpError(400, "動画時間が不正です");
  const assets = await Promise.all(["video", "poster"].map(kind => store.head(assetKey(id, source.sourceHash, kind))));
  if (assets.some(object => !object || object.customMetadata?.sourceHash !== source.sourceHash)) throw new HttpError(409, "動画とサムネイルのアップロードが必要です");
  const project = (await getCatalog(env))?.projects?.find(p => p.id === projectId);
  if (!project) throw new HttpError(409, "カタログを同期してください");
  const previous = entryOf(await store.head(manifestKey(id)));
  const entry = {id, projectId, title: project.name.slice(0, 180), sourceHash: source.sourceHash, duration: body.duration, createdAt: previous?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(), ...await sourceLink(files, env)};
  await store.put(manifestKey(id), JSON.stringify(entry), {httpMetadata: {contentType: "application/json"}, customMetadata: {entry: JSON.stringify(entry)}});
  if (hidden) await store.delete(`controls/${id}.json`);
  return Response.json({success: true, item: publicEntry(entry)});
}
