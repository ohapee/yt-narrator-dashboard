import { requestWithRetry, HttpError } from "./http.js";
import { validateDriveId } from "./validation.js";

let cachedToken = null;
let tokenExpiry = 0;

/**
 * Google OAuth 2.0 アクセストークンの取得・キャッシュ
 */
export async function getAccessToken(env) {
  const now = Date.now();
  if (cachedToken && tokenExpiry > now + 60000) {
    return cachedToken;
  }

  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  const refreshToken = env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Google OAuth環境変数（GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN）が設定されていません。");
  }

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token"
  });

  const res = await requestWithRetry("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString()
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google OAuthトークン取得失敗 (${res.status}): ${errText}`);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiry = now + (data.expires_in * 1000);
  return cachedToken;
}

/**
 * Google Drive API リクエスト共通ヘルパー
 */
export async function driveFetch(endpoint, env, options = {}) {
  const token = await getAccessToken(env);
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    ...(options.headers || {})
  };

  const url = endpoint.startsWith("https://") ? endpoint : `https://www.googleapis.com/drive/v3/${endpoint}`;
  const res = await requestWithRetry(url, { ...options, headers });
  return res;
}

/**
 * projects フォルダの ID を取得
 */
let cachedProjectsFolderId = null;
export async function getProjectsFolderId(env) {
  if (env.PROJECTS_FOLDER_ID) return env.PROJECTS_FOLDER_ID;
  if (cachedProjectsFolderId) return cachedProjectsFolderId;

  const rootId = env.TARGET_FOLDER_ID;
  if (!rootId) throw new Error("TARGET_FOLDER_ID が未設定です。");

  const subRes = await driveFetch(
    `files?q='${rootId}'+in+parents+and+name='projects'+and+trashed=false&fields=files(id)&spaces=drive`,
    env
  );
  const subData = await subRes.json();
  const folder = subData.files?.[0];
  if (!folder) throw new Error("projects フォルダが見つかりません。");

  cachedProjectsFolderId = folder.id;
  return cachedProjectsFolderId;
}

export async function assertProjectAccess(projectId, env) {
  validateDriveId(projectId);
  const res = await driveFetch(`files/${projectId}?fields=id,mimeType,parents`, env);
  if (!res.ok) throw new HttpError(404, "案件が見つかりません");
  const metadata = await res.json();
  if (metadata.mimeType !== "application/vnd.google-apps.folder" || !metadata.parents?.includes(await getProjectsFolderId(env))) throw new HttpError(403, "管理対象の案件ではありません");
  return metadata;
}

export async function assertFileAccess(fileId, env) {
  validateDriveId(fileId);
  const res = await driveFetch(`files/${fileId}?fields=id,name,mimeType,parents,size`, env);
  if (!res.ok) throw new HttpError(404, "ファイルが見つかりません");
  const metadata = await res.json();
  for (const parent of metadata.parents || []) {
    try { await assertProjectAccess(parent, env); return metadata; }
    catch (error) { if (error.status !== 403 && error.status !== 404) throw error; }
  }
  throw new HttpError(403, "管理対象案件のファイルではありません");
}

export async function listFolderFiles(folderId, env) {
  validateDriveId(folderId);
  const files = [];
  let pageToken = "";
  do {
    const query = `'${folderId}' in parents and trashed = false`;
    const res = await driveFetch(`files?q=${encodeURIComponent(query)}&fields=nextPageToken,files(id,name,size,mimeType,modifiedTime,webViewLink,appProperties)&orderBy=name&pageSize=1000${pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : ""}`, env);
    if (!res.ok) throw new HttpError(502, "案件のファイル取得に失敗しました");
    const data = await res.json();
    files.push(...(data.files || []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return files;
}

/**
 * 単一プロジェクトフォルダの成果物構成をスキャンする
 */


/** 複数案件をまとめて取得し、フォルダ数に比例したAPI呼び出しを避ける。 */



/**
 * Google Drive 上の _catalog.json を取得する
 */


/**
 * Google Drive 上の _catalog.json を保存・更新する
 */


/**
 * 任意のフォルダへ JSON ファイルを保存・更新する
 */
export async function saveJsonToFolder(folderId, fileName, jsonData, env) {
  const token = await getAccessToken(env);
  const jsonStr = JSON.stringify(jsonData, null, 2);
  const encoder = new TextEncoder();
  const jsonBytes = encoder.encode(jsonStr);

  const searchRes = await driveFetch(
    `files?q='${folderId}'+in+parents+and+name='${fileName}'+and+trashed=false&fields=files(id)&spaces=drive`,
    env
  );
  const searchData = await searchRes.json();
  const existingFile = searchData.files?.[0];

  if (existingFile) {
    const patchRes = await requestWithRetry(
      `https://www.googleapis.com/upload/drive/v3/files/${existingFile.id}?uploadType=media`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: jsonBytes
      }
    );
    if (!patchRes.ok) throw new Error(`ファイル更新失敗 (${patchRes.status}): ${await patchRes.text()}`);
    return { fileId: existingFile.id, action: "updated" };
  } else {
    const boundary = "-------314159265358979323846";
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;
    const metadata = {
      name: fileName,
      parents: [folderId],
      mimeType: "application/json"
    };

    const p1 = encoder.encode(`${delimiter}Content-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`);
    const p2 = encoder.encode(`--${boundary}\r\nContent-Type: application/json\r\n\r\n`);
    const p3 = jsonBytes;
    const p4 = encoder.encode(closeDelimiter);

    const body = new Uint8Array(p1.length + p2.length + p3.length + p4.length);
    let offset = 0;
    body.set(p1, offset); offset += p1.length;
    body.set(p2, offset); offset += p2.length;
    body.set(p3, offset); offset += p3.length;
    body.set(p4, offset);

    const postRes = await requestWithRetry(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": `multipart/related; boundary=${boundary}`,
          "Content-Length": String(body.length)
        },
        body
      }
    );
    if (!postRes.ok) throw new Error(`ファイル新規作成失敗 (${postRes.status}): ${await postRes.text()}`);
    const created = await postRes.json();
    return { fileId: created.id, action: "created" };
  }
}

/**
 * Google Drive の projects フォルダをスキャンし、_catalog.json を差分同期する
 */



export async function uploadMp3ToDrive(folderId, fileName, mp3Uint8Array, env) {
  const token = await getAccessToken(env);
  const boundary = "-------314159265358979323846";
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const metadata = {
    name: fileName,
    parents: [folderId],
    mimeType: "audio/mp3"
  };

  const metadataPart = `${delimiter}Content-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`;
  const mediaHeader = `--${boundary}\r\nContent-Type: audio/mp3\r\n\r\n`;

  const encoder = new TextEncoder();
  const part1 = encoder.encode(metadataPart);
  const part2 = encoder.encode(mediaHeader);
  const part3 = mp3Uint8Array;
  const part4 = encoder.encode(closeDelimiter);

  const totalLength = part1.length + part2.length + part3.length + part4.length;
  const body = new Uint8Array(totalLength);
  let offset = 0;
  body.set(part1, offset); offset += part1.length;
  body.set(part2, offset); offset += part2.length;
  body.set(part3, offset); offset += part3.length;
  body.set(part4, offset);

  const res = await requestWithRetry("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
      "Content-Length": String(totalLength)
    },
    body: body
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google Drive アップロード失敗 (${res.status}): ${errText}`);
  }

  return await res.json();
}

export async function uploadPngToDrive(folderId, bytes, existingFileId, env) {
  const token = await getAccessToken(env);
  if (existingFileId) {
    const response = await requestWithRetry(`https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=media`, {
      method: "PATCH", headers: {Authorization: `Bearer ${token}`, "Content-Type": "image/png"}, body: bytes
    });
    if (!response.ok) throw new Error(`画像更新失敗 (${response.status})`);
    return {id: existingFileId};
  }
  const boundary = `visual-${crypto.randomUUID()}`;
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({name: "visual_summary.png", parents: [folderId], mimeType: "image/png"})}\r\n`,
    `--${boundary}\r\nContent-Type: image/png\r\n\r\n`, bytes, `\r\n--${boundary}--\r\n`
  ]);
  const response = await requestWithRetry("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
    method: "POST", headers: {Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}`}, body
  });
  if (!response.ok) throw new Error(`画像保存失敗 (${response.status})`);
  return response.json();
}
