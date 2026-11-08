import { driveFetch, getProjectsFolderId, getAccessToken } from "./drive.js";
import { requestWithRetry } from "./http.js";

export function summarizeProjectFiles(folder, files) {
    const visualImage = files.find(f => /^visual_summary\.(png|jpg|jpeg)$/i.test(f.name));
    const visualDone = files.find(f => f.name === "visual_done.json");
    const mangaImages = files.filter(f => /^manga_\d+\.(jpg|jpeg|png)$/i.test(f.name))
      .sort((a, b) => a.name.localeCompare(b.name));
    const titleImages = files.filter(f => /^(00_title|title).*\.(jpg|jpeg|png)$/i.test(f.name))
      .sort((a, b) => a.name.localeCompare(b.name));
    const hasNarration = files.some(f => f.name === "narration_tts.txt");
    const hasYoutube = files.some(f => f.name === "youtube.json");
    const audioFile = files.find(f => f.name === "narration_tts.mp3" || f.name === "narration.mp3");
    const hasAudio = !!audioFile;
    const mangaDoneFile = files.find(f => f.name === "manga_done.json");

    let thumbnailId = "";
    const finalTitle = titleImages.find(t => t.name.includes("final")) ||
                       titleImages.find(t => t.name.includes("perfected")) ||
                       titleImages.find(t => t.name === "00_title.jpg") ||
                       titleImages[0];
    if (visualImage) {
      thumbnailId = visualImage.id;
    } else if (finalTitle) {
      thumbnailId = finalTitle.id;
    } else if (mangaImages[0]) {
      thumbnailId = mangaImages[0].id;
    }

    let status = "GENERATING";
    if (hasNarration && (visualImage && visualDone || mangaImages.length >= 8 && mangaDoneFile)) {
      status = "COMPLETED";
    } else if (visualImage || mangaImages.length > 0 || titleImages.length > 0) {
      status = "PARTIAL";
    }

    return {
      id: folder.id,
      name: folder.name,
      createdTime: folder.createdTime,
      modifiedTime: folder.modifiedTime,
      totalFiles: files.length,
      mangaCount: mangaImages.length,
      visualMode: visualImage ? "single_page" : "legacy_panels",
      hasVisual: !!visualImage,
      visualFileId: visualImage?.id || "",
      titleCount: titleImages.length,
      hasNarration,
      hasAudio,
      audioFileId: audioFile?.id || "",
      audioFileSize: audioFile?.size ? Number(audioFile.size) : 0,
      hasYoutube,
      hasMetadata: !!(visualDone || mangaDoneFile),
      hasTitle: !!visualImage || titleImages.length > 0,
      thumbnailId,
      status
    };
}

export async function listProjectFiles(folders, env) {
  const result = new Map(folders.map(folder => [folder.id, []]));
  for (let offset = 0; offset < folders.length; offset += 25) {
    const batch = folders.slice(offset, offset + 25);
    const q = `(${batch.map(folder => `'${folder.id}' in parents`).join(" or ")}) and trashed = false`;
    let pageToken = "";
    do {
      const res = await driveFetch(
        `files?q=${encodeURIComponent(q)}&fields=nextPageToken,files(id,name,size,mimeType,parents)&pageSize=1000${pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : ""}`, env
      );
      if (!res.ok) throw new Error(`案件ファイル一覧取得失敗 (${res.status}): ${await res.text()}`);
      const data = await res.json();
      for (const file of data.files || []) {
        for (const parent of file.parents || []) result.get(parent)?.push(file);
      }
      pageToken = data.nextPageToken;
    } while (pageToken);
  }
  return result;
}

export async function getCatalog(env) {
  const pFolderId = await getProjectsFolderId(env);
  const q = `'${pFolderId}' in parents and name = '_catalog.json' and trashed = false`;
  const searchRes = await driveFetch(
    `files?q=${encodeURIComponent(q)}&fields=files(id,modifiedTime)&spaces=drive`,
    env
  );
  const searchData = await searchRes.json();
  const catalogFile = searchData.files?.[0];

  if (!catalogFile) {
    return null;
  }

  const contentRes = await driveFetch(`files/${catalogFile.id}?alt=media`, env);
  if (!contentRes.ok) {
    throw new Error(`_catalog.json の取得に失敗しました (${contentRes.status})`);
  }
  const catalog = await contentRes.json();
  catalog._fileId = catalogFile.id;
  return catalog;
}

export async function saveCatalog(catalogData, existingFileId, env) {
  const token = await getAccessToken(env);
  const pFolderId = await getProjectsFolderId(env);
  const jsonStr = JSON.stringify(catalogData, null, 2);
  const encoder = new TextEncoder();
  const jsonBytes = encoder.encode(jsonStr);

  if (existingFileId) {
    // 既存ファイルを PATCH 更新
    const patchRes = await requestWithRetry(
      `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=media`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: jsonBytes
      }
    );
    if (!patchRes.ok) {
      throw new Error(`_catalog.json PATCH更新失敗 (${patchRes.status}): ${await patchRes.text()}`);
    }
    return existingFileId;
  } else {
    // 新規ファイルを作成アップロード
    const boundary = "-------314159265358979323846";
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;
    const metadata = {
      name: "_catalog.json",
      parents: [pFolderId],
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
    if (!postRes.ok) {
      throw new Error(`_catalog.json 新規アップロード失敗 (${postRes.status}): ${await postRes.text()}`);
    }
    const created = await postRes.json();
    return created.id;
  }
}

export async function syncCatalog(env, narrationStatus = null) {
  const startTime = Date.now();
  const pFolderId = await getProjectsFolderId(env);

  // 1. projects 直下のサブフォルダ一覧を取得
  let pageToken = "";
  let currentFolders = [];
  do {
    const q = `'${pFolderId}' in parents and trashed = false and mimeType = 'application/vnd.google-apps.folder'`;
    const url = `files?q=${encodeURIComponent(q)}&fields=nextPageToken,files(id,name,createdTime,modifiedTime)&pageSize=1000${pageToken ? "&pageToken=" + pageToken : ""}`;
    const res = await driveFetch(url, env);
    if (!res.ok) throw new Error(`サブフォルダ一覧取得失敗: ${await res.text()}`);
    const data = await res.json();
    currentFolders.push(...(data.files || []));
    pageToken = data.nextPageToken;
  } while (pageToken);

  currentFolders.sort((a, b) => b.name.localeCompare(a.name));

  // 2. 既存の _catalog.json を取得
  const existingCatalog = await getCatalog(env);
  const existingMap = new Map();
  if (existingCatalog && Array.isArray(existingCatalog.projects)) {
    for (const p of existingCatalog.projects) {
      existingMap.set(p.id, p);
    }
  }

  // 子ファイルの追加で親フォルダの更新日時が変わらない場合もあるため、
  // 毎回まとめて実データを確認する。320案件でも約13回の一覧取得に抑える。
  const fileMap = await listProjectFiles(currentFolders, env);
  const finalProjects = currentFolders.map(folder => summarizeProjectFiles(folder, fileMap.get(folder.id) || []));
  const updatedFolders = finalProjects.filter(project => {
    const old = existingMap.get(project.id);
    return !old || JSON.stringify(old) !== JSON.stringify(project);
  }).length;

  // 名前降順にソート
  finalProjects.sort((a, b) => b.name.localeCompare(a.name));

  // 5. 新しいカタログ構造を作成
  const completedProjects = finalProjects.filter(p => p.status === "COMPLETED").length;
  const audioProjects = finalProjects.filter(p => p.hasAudio).length;
  const partialProjects = finalProjects.filter(p => p.status !== "COMPLETED").length;

  const newCatalog = {
    version: 1,
    generatedAt: new Date().toISOString(),
    narrationStatus: narrationStatus || existingCatalog?.narrationStatus || { status: "idle", lastRun: null },
    totalProjects: finalProjects.length,
    completedProjects,
    audioProjects,
    partialProjects,
    projects: finalProjects
  };

  // 6. Google Drive へ保存
  const fileId = await saveCatalog(newCatalog, existingCatalog?._fileId, env);
  const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);

  return {
    success: true,
    fileId,
    totalProjects: finalProjects.length,
    updatedFolders,
    elapsedSec,
    catalog: newCatalog
  };
}
