/**
 * yt-narrator-dashboard - Cloudflare Workers バックエンド
 * Google Drive API を中継し、成果物と進捗状況を安全かつ超高速に提供します。
 * 
 * 【最適化アーキテクチャ】
 * - Google Drive 上の _catalog.json（メタデータインデックス）を活用し、
 *   一覧表示時は Drive API を1回だけ取得（約0.3秒・全64件以上を一括返却）。
 * - コマ画像や詳細テキストはモーダル詳細表示時（/api/project/:id）にオンデマンド取得。
 * - 新規フォルダの追加・更新は差分同期（/api/sync-catalog）および定期Cronで自動管理。
 */

let cachedToken = null;
let tokenExpiry = 0;

/**
 * Google OAuth 2.0 アクセストークンの取得・キャッシュ
 */
async function getAccessToken(env) {
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

  const res = await fetch("https://oauth2.googleapis.com/token", {
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
async function driveFetch(endpoint, env, options = {}) {
  const token = await getAccessToken(env);
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    ...(options.headers || {})
  };

  const url = endpoint.startsWith("https://") ? endpoint : `https://www.googleapis.com/drive/v3/${endpoint}`;
  const res = await fetch(url, { ...options, headers });
  return res;
}

/**
 * projects フォルダの ID を取得
 */
let cachedProjectsFolderId = null;
async function getProjectsFolderId(env) {
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

/**
 * 単一プロジェクトフォルダの成果物構成をスキャンする
 */
async function scanProjectFolder(folderId, folderName, createdTime, modifiedTime, env) {
  try {
    const q = `'${folderId}' in parents and trashed = false`;
    const res = await driveFetch(
      `files?q=${encodeURIComponent(q)}&fields=files(id,name,size,mimeType)&pageSize=100`,
      env
    );
    const data = await res.json();
    const files = data.files || [];

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
    if (finalTitle) {
      thumbnailId = finalTitle.id;
    } else if (mangaImages[0]) {
      thumbnailId = mangaImages[0].id;
    }

    let status = "GENERATING";
    if (mangaImages.length >= 8 && hasNarration && mangaDoneFile) {
      status = "COMPLETED";
    } else if (mangaImages.length > 0 || titleImages.length > 0) {
      status = "PARTIAL";
    }

    return {
      id: folderId,
      name: folderName,
      createdTime,
      modifiedTime,
      totalFiles: files.length,
      mangaCount: mangaImages.length,
      titleCount: titleImages.length,
      hasNarration,
      hasAudio,
      audioFileId: audioFile?.id || "",
      audioFileSize: audioFile?.size ? Number(audioFile.size) : 0,
      hasYoutube,
      hasMetadata: !!mangaDoneFile,
      hasTitle: titleImages.length > 0,
      thumbnailId,
      status
    };
  } catch (err) {
    return {
      id: folderId,
      name: folderName,
      createdTime,
      modifiedTime,
      totalFiles: 0,
      mangaCount: 0,
      titleCount: 0,
      hasNarration: false,
      hasAudio: false,
      audioFileId: "",
      audioFileSize: 0,
      hasYoutube: false,
      hasMetadata: false,
      hasTitle: false,
      thumbnailId: "",
      status: "UNKNOWN"
    };
  }
}

/**
 * Google Drive 上の _catalog.json を取得する
 */
async function getCatalog(env) {
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

/**
 * Google Drive 上の _catalog.json を保存・更新する
 */
async function saveCatalog(catalogData, existingFileId, env) {
  const token = await getAccessToken(env);
  const pFolderId = await getProjectsFolderId(env);
  const jsonStr = JSON.stringify(catalogData, null, 2);
  const encoder = new TextEncoder();
  const jsonBytes = encoder.encode(jsonStr);

  if (existingFileId) {
    // 既存ファイルを PATCH 更新
    const patchRes = await fetch(
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

    const postRes = await fetch(
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

/**
 * Google Drive の projects フォルダをスキャンし、_catalog.json を差分同期する
 */
async function syncCatalog(env) {
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

  // 3. 差分の検出（新規フォルダ、または更新されたフォルダ）
  const toScan = [];
  const finalProjects = [];

  for (const folder of currentFolders) {
    const existing = existingMap.get(folder.id);
    if (!existing || existing.modifiedTime !== folder.modifiedTime) {
      toScan.push(folder);
    } else {
      finalProjects.push(existing);
    }
  }

  console.log(`[Catalog Sync] 総フォルダ: ${currentFolders.length} 件, 差分更新対象: ${toScan.length} 件`);

  // 4. 差分対象フォルダをスキャン（4件ずつ並列処理）
  if (toScan.length > 0) {
    const BATCH_SIZE = 4;
    for (let i = 0; i < toScan.length; i += BATCH_SIZE) {
      const batch = toScan.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(f => scanProjectFolder(f.id, f.name, f.createdTime, f.modifiedTime, env))
      );
      finalProjects.push(...batchResults);
    }
  }

  // 名前降順にソート
  finalProjects.sort((a, b) => b.name.localeCompare(a.name));

  // 5. 新しいカタログ構造を作成
  const completedProjects = finalProjects.filter(p => p.status === "COMPLETED").length;
  const audioProjects = finalProjects.filter(p => p.hasAudio).length;
  const partialProjects = finalProjects.filter(p => p.status !== "COMPLETED").length;

  const newCatalog = {
    version: 1,
    generatedAt: new Date().toISOString(),
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
    updatedFolders: toScan.length,
    elapsedSec,
    catalog: newCatalog
  };
}

/**
 * パイプライン3大工程（漫画・タイトル・音声）の最終実行時間および停滞・エラー検知
 */
async function getPipelineStatus(env, catalog) {
  const pMap = new Map((catalog?.projects || []).map(p => [p.id, p]));

  let latestMangaFile = null;
  let latestTitleFile = null;
  let latestAudioFile = null;

  try {
    const [mRes, tRes, aRes] = await Promise.all([
      driveFetch("files?q=name='manga_done.json'+and+trashed=false&orderBy=modifiedTime+desc&pageSize=3&fields=files(id,name,modifiedTime,parents)", env),
      driveFetch("files?q=name='title_done.json'+and+trashed=false&orderBy=modifiedTime+desc&pageSize=3&fields=files(id,name,modifiedTime,parents)", env),
      driveFetch("files?q=name='narration_tts.mp3'+and+trashed=false&orderBy=modifiedTime+desc&pageSize=3&fields=files(id,name,modifiedTime,parents)", env),
    ]);

    const [mData, tData, aData] = await Promise.all([mRes.json(), tRes.json(), aRes.json()]);

    latestMangaFile = (mData.files || []).find(f => f.parents?.[0] && pMap.has(f.parents[0])) || mData.files?.[0];
    latestTitleFile = (tData.files || []).find(f => f.parents?.[0] && pMap.has(f.parents[0])) || tData.files?.[0];
    latestAudioFile = (aData.files || []).find(f => f.parents?.[0] && pMap.has(f.parents[0])) || aData.files?.[0];
  } catch (e) {
    console.error("[Pipeline Status] Drive API 検索エラー:", e);
  }

  const now = Date.now();

  function evaluateHealth(modifiedTime, warnHours = 3, stopHours = 6) {
    if (!modifiedTime) {
      return { status: "UNKNOWN", label: "データ取得中", timeAgo: "-", isStopped: false };
    }
    const diffMs = now - new Date(modifiedTime).getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = (diffMs / 3600000).toFixed(1);

    let timeAgo = "";
    if (diffMins < 60) timeAgo = `${diffMins}分前`;
    else if (diffHours < 24) timeAgo = `${diffHours}時間前`;
    else timeAgo = `${(diffHours / 24).toFixed(1)}日前`;

    if (diffMs < warnHours * 3600000) {
      return { status: "ACTIVE", label: "🟢 正常稼働中", timeAgo, isStopped: false };
    } else if (diffMs < stopHours * 3600000) {
      return { status: "WARN", label: "🟡 やや間隔あり", timeAgo, isStopped: false };
    } else {
      return { status: "STOPPED", label: "🔴 停止中（要確認）", timeAgo, isStopped: true };
    }
  }

  const mangaParent = latestMangaFile?.parents?.[0] ? pMap.get(latestMangaFile.parents[0]) : null;
  const titleParent = latestTitleFile?.parents?.[0] ? pMap.get(latestTitleFile.parents[0]) : null;
  const audioParent = latestAudioFile?.parents?.[0] ? pMap.get(latestAudioFile.parents[0]) : null;

  const allProjects = catalog?.projects || [];
  const stalledProjects = allProjects.filter(p => {
    if (p.status === "COMPLETED") return false;
    const ageMs = now - new Date(p.createdTime || p.modifiedTime).getTime();
    return ageMs > 2 * 3600000;
  });

  const unvoicedProjects = allProjects.filter(p => p.status === "COMPLETED" && !p.hasAudio);
  const untitledProjects = allProjects.filter(p => p.mangaCount >= 8 && !p.hasTitle);

  return {
    manga: {
      lastExecutedAt: latestMangaFile?.modifiedTime || null,
      projectName: mangaParent?.name || "最新案件",
      projectId: mangaParent?.id || "",
      ...evaluateHealth(latestMangaFile?.modifiedTime, 3, 6),
      completedCount: allProjects.filter(p => p.status === "COMPLETED").length,
      pendingCount: allProjects.filter(p => p.status !== "COMPLETED").length
    },
    title: {
      lastExecutedAt: latestTitleFile?.modifiedTime || null,
      projectName: titleParent?.name || "最新タイトル生成案件",
      projectId: titleParent?.id || "",
      ...evaluateHealth(latestTitleFile?.modifiedTime, 3, 6),
      completedCount: allProjects.filter(p => p.hasTitle).length,
      pendingCount: untitledProjects.length
    },
    audio: {
      lastExecutedAt: latestAudioFile?.modifiedTime || null,
      projectName: audioParent?.name || "最新音声生成案件",
      projectId: audioParent?.id || "",
      ...evaluateHealth(latestAudioFile?.modifiedTime, 2, 4),
      completedCount: allProjects.filter(p => p.hasAudio).length,
      pendingCount: unvoicedProjects.length
    },
    stalledProjects: stalledProjects.map(p => ({
      id: p.id,
      name: p.name,
      mangaCount: p.mangaCount,
      hasTitle: p.hasTitle,
      createdTime: p.createdTime,
      totalFiles: p.totalFiles
    })),
    cronStatus: lastCronResult
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // CORS ヘッダー
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // ----------------------------------------------------
      // 1. API: 全体サマリー・ステータス (/api/overview)
      // ----------------------------------------------------
      if (pathname === "/api/overview") {
        const rootId = env.TARGET_FOLDER_ID;
        if (!rootId) throw new Error("TARGET_FOLDER_ID が未設定です。");

        // カタログからサマリーを即座に取得
        let catalog = await getCatalog(env);
        if (!catalog) {
          const syncRes = await syncCatalog(env);
          catalog = syncRes.catalog;
        }

        // パイプライン3大工程の稼働ヘルスチェック
        const pipelineStatus = await getPipelineStatus(env, catalog);

        // yt-links フォルダ（キューファイル）の取得
        const subRes = await driveFetch(
          `files?q='${rootId}'+in+parents+and+trashed=false&fields=files(id,name)&spaces=drive`,
          env
        );
        const subData = await subRes.json();
        const linksFolder = subData.files?.find(f => f.name.includes("yt") && f.name.includes("link"));

        let queueFiles = [];
        if (linksFolder) {
          const qListRes = await driveFetch(
            `files?q='${linksFolder.id}'+in+parents+and+trashed=false&fields=files(id,name,size,modifiedTime)&orderBy=modifiedTime+desc&pageSize=10&spaces=drive`,
            env
          );
          const qListData = await qListRes.json();
          queueFiles = qListData.files || [];
        }

        return new Response(JSON.stringify({
          success: true,
          rootId,
          totalProjects: catalog.totalProjects,
          completedProjects: catalog.completedProjects,
          audioProjects: catalog.audioProjects,
          partialProjects: catalog.partialProjects,
          recentProjects: (catalog.projects || []).slice(0, 5),
          queueFiles,
          pipelineStatus,
          catalogGeneratedAt: catalog.generatedAt,
          updatedAt: new Date().toISOString()
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" }
        });
      }

      // ----------------------------------------------------
      // 1-2. API: パイプライン稼働ステータス (/api/pipeline-status)
      // ----------------------------------------------------
      if (pathname === "/api/pipeline-status") {
        let catalog = await getCatalog(env);
        if (!catalog) {
          const syncRes = await syncCatalog(env);
          catalog = syncRes.catalog;
        }
        const pipelineStatus = await getPipelineStatus(env, catalog);
        return new Response(JSON.stringify({
          success: true,
          pipelineStatus
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" }
        });
      }

      // ----------------------------------------------------
      // 2. API: プロジェクト一覧取得 (/api/projects)
      // ※ _catalog.json を 1 fetch で取得して即座に返却（0.3秒未満）
      // ----------------------------------------------------
      if (pathname === "/api/projects") {
        let catalog = await getCatalog(env);
        if (!catalog) {
          // 初回など未作成時は同期を実行
          const syncRes = await syncCatalog(env);
          catalog = syncRes.catalog;
        }

        return new Response(JSON.stringify({
          success: true,
          totalProjects: catalog.totalProjects,
          completedProjects: catalog.completedProjects,
          audioProjects: catalog.audioProjects,
          partialProjects: catalog.partialProjects,
          catalogGeneratedAt: catalog.generatedAt,
          projects: catalog.projects || []
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" }
        });
      }

      // ----------------------------------------------------
      // 2-2. API: カタログインデックス同期 (/api/sync-catalog)
      // ----------------------------------------------------
      if (pathname === "/api/sync-catalog" && (request.method === "POST" || request.method === "GET")) {
        const syncResult = await syncCatalog(env);
        return new Response(JSON.stringify({
          success: true,
          ...syncResult
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" }
        });
      }

      // ----------------------------------------------------
      // 3. API: プロジェクト詳細取得 (/api/project/:id)
      // ※ モーダルクリック時にオンデマンドで個別フォルダ内を取得
      // ----------------------------------------------------
      if (pathname.startsWith("/api/project/")) {
        const projectId = pathname.replace("/api/project/", "").trim();
        if (!projectId) throw new Error("プロジェクトIDが指定されていません。");

        // フォルダ内の全ファイルを取得
        const filesRes = await driveFetch(
          `files?q='${projectId}'+in+parents+and+trashed=false&fields=files(id,name,size,mimeType,modifiedTime,webViewLink)&orderBy=name+asc&pageSize=60&spaces=drive`,
          env
        );
        const filesData = await filesRes.json();
        const files = filesData.files || [];

        // 本編漫画画像
        const mangaFiles = files.filter(f => /^manga_\d+\.(jpg|jpeg|png)$/i.test(f.name))
          .sort((a, b) => a.name.localeCompare(b.name));

        // タイトルカード画像
        const titleFiles = files.filter(f => /^(00_title|title).*\.(jpg|jpeg|png)$/i.test(f.name))
          .sort((a, b) => a.name.localeCompare(b.name));

        const narrationFile = files.find(f => f.name === "narration_tts.txt");
        const audioFile = files.find(f => f.name === "narration_tts.mp3" || f.name === "narration.mp3");
        const metadataFile = files.find(f => f.name === "manga_done.json");
        const titleDoneFile = files.find(f => f.name === "title_done.json");
        const youtubeFile = files.find(f => f.name === "youtube.json");

        let narrationText = "";
        if (narrationFile) {
          const txtRes = await driveFetch(`files/${narrationFile.id}?alt=media`, env);
          if (txtRes.ok) {
            narrationText = await txtRes.text();
          }
        }

        let metadataJson = null;
        if (metadataFile) {
          const metaRes = await driveFetch(`files/${metadataFile.id}?alt=media`, env);
          if (metaRes.ok) {
            try {
              metadataJson = await metaRes.json();
            } catch (e) {}
          }
        }

        let titleJson = null;
        if (titleDoneFile) {
          const tRes = await driveFetch(`files/${titleDoneFile.id}?alt=media`, env);
          if (tRes.ok) {
            try {
              titleJson = await tRes.json();
            } catch (e) {}
          }
        }

        let youtubeJson = null;
        if (youtubeFile) {
          const yRes = await driveFetch(`files/${youtubeFile.id}?alt=media`, env);
          if (yRes.ok) {
            try {
              youtubeJson = await yRes.json();
            } catch (e) {}
          }
        }

        return new Response(JSON.stringify({
          success: true,
          projectId,
          files,
          mangaImages: mangaFiles.map(m => ({
            id: m.id,
            name: m.name,
            size: m.size,
            url: `/api/image/${m.id}`
          })),
          titleImages: titleFiles.map(t => ({
            id: t.id,
            name: t.name,
            size: t.size,
            url: `/api/image/${t.id}`
          })),
          narrationText,
          hasAudio: !!audioFile,
          audioFile: audioFile ? {
            id: audioFile.id,
            name: audioFile.name,
            size: audioFile.size ? Number(audioFile.size) : 0,
            url: `/api/audio/${audioFile.id}`
          } : null,
          metadata: metadataJson,
          titleMetadata: titleJson,
          youtube: youtubeJson
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" }
        });
      }

      // ----------------------------------------------------
      // 4. API: 画像プロキシ配信 (/api/image/:fileId)
      // ----------------------------------------------------
      if (pathname.startsWith("/api/image/")) {
        const fileId = pathname.replace("/api/image/", "").trim();
        if (!fileId) return new Response("File ID Required", { status: 400 });

        const imgRes = await driveFetch(`files/${fileId}?alt=media`, env);
        if (!imgRes.ok) {
          return new Response("Image Not Found", { status: imgRes.status });
        }

        const contentType = imgRes.headers.get("content-type") || "image/jpeg";
        return new Response(imgRes.body, {
          headers: {
            "Content-Type": contentType,
            "Cache-Control": "public, max-age=86400, s-maxage=86400",
            ...corsHeaders
          }
        });
      }

      // ----------------------------------------------------
      // 4-2. API: 音声プロキシ配信 (/api/audio/:fileId)
      // ----------------------------------------------------
      if (pathname.startsWith("/api/audio/")) {
        const fileId = pathname.replace("/api/audio/", "").trim();
        if (!fileId) return new Response("File ID Required", { status: 400 });

        const audioRes = await driveFetch(`files/${fileId}?alt=media`, env);
        if (!audioRes.ok) {
          return new Response("Audio Not Found", { status: audioRes.status });
        }

        const contentType = audioRes.headers.get("content-type") || "audio/mpeg";
        return new Response(audioRes.body, {
          headers: {
            "Content-Type": contentType,
            "Accept-Ranges": "bytes",
            "Cache-Control": "public, max-age=86400, s-maxage=86400",
            ...corsHeaders
          }
        });
      }

      // ----------------------------------------------------
      // 5. API: キューファイル詳細 (/api/queues)
      // ----------------------------------------------------
      if (pathname === "/api/queues") {
        const rootId = env.TARGET_FOLDER_ID;
        const subRes = await driveFetch(
          `files?q='${rootId}'+in+parents+and+trashed=false&fields=files(id,name)&spaces=drive`,
          env
        );
        const subData = await subRes.json();
        const linksFolder = subData.files?.find(f => f.name.includes("yt") && f.name.includes("link"));

        if (!linksFolder) {
          return new Response(JSON.stringify({ success: false, error: "yt-links フォルダが見つかりません" }), {
            headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" }
          });
        }

        const qRes = await driveFetch(
          `files?q='${linksFolder.id}'+in+parents+and+trashed=false&fields=files(id,name,size,modifiedTime)&orderBy=modifiedTime+desc&pageSize=15&spaces=drive`,
          env
        );
        const qData = await qRes.json();
        const files = qData.files || [];

        const queueDetails = await Promise.all(
          files.map(async (qf) => {
            let content = "";
            try {
              const cRes = await driveFetch(`files/${qf.id}?alt=media`, env);
              if (cRes.ok) content = await cRes.text();
            } catch (e) {}

            const lines = content.split("\n").map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith("#"));
            return {
              id: qf.id,
              name: qf.name,
              size: qf.size,
              modifiedTime: qf.modifiedTime,
              lineCount: lines.length,
              urls: lines
            };
          })
        );

        return new Response(JSON.stringify({ success: true, queues: queueDetails }), {
          headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" }
        });
      }

      // ----------------------------------------------------
      // 6. API: 音声合成プレビュー (/api/tts)
      // ----------------------------------------------------
      if (pathname === "/api/tts" && request.method === "POST") {
        const body = await request.json();
        const { engine = "edge", text, voice, speed = 1.0, caption } = body;

        if (!text || !text.trim()) {
          return new Response(JSON.stringify({ error: "読み上げテキストが入力されていません。" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" }
          });
        }

        const modalUrl = (env.MODAL_TTS_URL || "https://ohapee--irodori-tts-service-web.modal.run").replace(/\/$/, "");

        let targetEndpoint;
        let payload;

        if (engine === "irodori") {
          let targetText = text.trim();
          if (targetText.length > 120) {
            const sentences = targetText.split(/(?<=[。！？\n])/);
            let chunk = "";
            for (const s of sentences) {
              if ((chunk + s).length <= 100) {
                chunk += s;
              } else {
                break;
              }
            }
            if (chunk && chunk.length >= 15) {
              targetText = chunk.trim();
            } else {
              targetText = targetText.slice(0, 90).replace(/[、\s]+$/, "") + "。";
            }
          }

          targetEndpoint = `${modalUrl}/api/synthesize`;
          payload = {
            text: targetText,
            voice: voice || "female-bright",
            caption: caption || undefined,
            speed: Number(speed) || 1.0,
            format: "mp3"
          };
        } else {
          targetEndpoint = `${modalUrl}/api/edge-tts`;
          payload = {
            text: text,
            voice: voice || "ja-JP-NanamiNeural",
            speed: Number(speed) || 1.0,
            pitch: 0.0
          };
        }

        const ttsRes = await fetch(targetEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        if (!ttsRes.ok) {
          const errText = await ttsRes.text();
          return new Response(JSON.stringify({
            error: `TTSサーバーエラー (${engine}): ${errText}`
          }), {
            status: ttsRes.status,
            headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" }
          });
        }

        const ttsData = await ttsRes.json();
        return new Response(JSON.stringify({
          success: true,
          audioBase64: ttsData.audioBase64,
          mimeType: ttsData.mimeType || "audio/mp3",
          engine: engine,
          voice: payload.voice,
          speed: payload.speed,
          usedText: payload.text,
          charCount: payload.text.length
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" }
        });
      }

      // ----------------------------------------------------
      // 7. API: 定期ナレーション生成 手動実行・確認 (/api/cron/process-narration)
      // ----------------------------------------------------
      if (pathname === "/api/cron/process-narration" && (request.method === "POST" || request.method === "GET")) {
        const countParam = url.searchParams.get("count");
        const maxCount = countParam ? parseInt(countParam, 10) : 4;
        const summary = await processHourlyNarration(env, maxCount);
        return new Response(JSON.stringify({ success: true, ...summary }), {
          headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" }
        });
      }

      if (pathname === "/api/cron/status" && request.method === "GET") {
        return new Response(JSON.stringify({ success: true, ...lastCronResult }), {
          headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" }
        });
      }

      // ----------------------------------------------------
      // 8. 静的アセット（HTML / CSS / JS）の配信
      // ----------------------------------------------------
      if (env.ASSETS) {
        return env.ASSETS.fetch(request);
      }

      return new Response("Not Found", { status: 404 });

    } catch (err) {
      return new Response(JSON.stringify({
        success: false,
        error: err.message || "サーバーエラーが発生しました"
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" }
      });
    }
  },

  /**
   * Cloudflare Cron Trigger (毎時定期実行)
   * ナレーション自動生成 ＆ カタログ差分同期
   */
  async scheduled(event, env, ctx) {
    console.log(`[Cron Trigger] 定期スケジュール起動 (cron: ${event.cron})`);
    ctx.waitUntil((async () => {
      try {
        await processHourlyNarration(env, 4);
      } catch (e) {
        console.error("[Cron Trigger] ナレーション処理失敗:", e);
      }
      try {
        await syncCatalog(env);
      } catch (e) {
        console.error("[Cron Trigger] カタログ同期失敗:", e);
      }
    })());
  }
};

// ---------------------------------------------------------------------------
// 定期ナレーション自動生成バッチ処理 (Google Drive ＆ Edge-TTS)
// ---------------------------------------------------------------------------
let lastCronResult = {
  status: "idle",
  lastRun: null,
  summary: null
};

/**
 * Google Drive へ MP3 ファイルをマルチパートアップロードする
 */
async function uploadMp3ToDrive(folderId, fileName, mp3Uint8Array, env) {
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

  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
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

/**
 * 1時間ごとの定期ナレーション生成バッチ
 */
async function processHourlyNarration(env, maxFolders = 4) {
  const startTime = Date.now();
  console.log(`[Hourly Cron] ナレーション自動生成バッチ開始 (最大 ${maxFolders} フォルダ)...`);
  lastCronResult.status = "running";

  const projectsFolderId = await getProjectsFolderId(env);
  const modalUrl = (env.MODAL_TTS_URL || "https://ohapee--irodori-tts-service-web.modal.run").replace(/\/$/, "");

  try {
    // 1. projects フォルダ直下のサブフォルダ一覧を取得 (作成日時古い順)
    const folderQuery = `'${projectsFolderId}' in parents and trashed = false and mimeType = 'application/vnd.google-apps.folder'`;
    const foldersRes = await driveFetch(
      `files?q=${encodeURIComponent(folderQuery)}&fields=files(id,name,createdTime)&orderBy=createdTime&pageSize=100`,
      env
    );
    if (!foldersRes.ok) {
      throw new Error(`projects フォルダのサブフォルダ一覧取得失敗: ${await foldersRes.text()}`);
    }
    const foldersData = await foldersRes.json();
    const allSubFolders = foldersData.files || [];

    // 2. 未処理フォルダの選定 (narration_tts.txt があり、narration_tts.mp3 が無いもの)
    const candidates = [];
    for (const folder of allSubFolders) {
      if (candidates.length >= maxFolders) break;

      const filesQuery = `'${folder.id}' in parents and trashed = false`;
      const fRes = await driveFetch(
        `files?q=${encodeURIComponent(filesQuery)}&fields=files(id,name,size)&spaces=drive`,
        env
      );
      if (!fRes.ok) continue;

      const fData = await fRes.json();
      const files = fData.files || [];

      const narrationTxtFile = files.find(f => f.name === "narration_tts.txt");
      const narrationMp3File = files.find(f => f.name === "narration_tts.mp3" || f.name === "narration.mp3");

      if (narrationTxtFile && !narrationMp3File) {
        candidates.push({
          folderId: folder.id,
          folderName: folder.name,
          txtFileId: narrationTxtFile.id
        });
      }
    }

    console.log(`[Hourly Cron] 未処理候補抽出完了: ${candidates.length} 件`);
    const results = [];

    // 3. 候補フォルダごとに Edge-TTS 生成＆Drive アップロード
    for (const item of candidates) {
      const itemStart = Date.now();
      try {
        console.log(`[Hourly Cron] 処理開始: フォルダ「${item.folderName}」`);

        // 3-1. narration_tts.txt の中身を取得
        const txtRes = await driveFetch(`files/${item.txtFileId}?alt=media`, env);
        if (!txtRes.ok) {
          throw new Error(`原稿テキストのダウンロード失敗 (${txtRes.status})`);
        }
        const textContent = (await txtRes.text()).trim();
        if (!textContent) {
          throw new Error("原稿テキストが空です");
        }

        // 3-2. Modal Edge-TTS API 呼び出し (Nanami, 速度 1.3)
        const edgePayload = {
          text: textContent,
          voice: "ja-JP-NanamiNeural",
          speed: 1.3,
          pitch: 0.0
        };

        const ttsRes = await fetch(`${modalUrl}/api/edge-tts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(edgePayload)
        });

        if (!ttsRes.ok) {
          const errText = await ttsRes.text();
          throw new Error(`Edge-TTS API エラー (${ttsRes.status}): ${errText}`);
        }

        const ttsData = await ttsRes.json();
        if (!ttsData.audioBase64) {
          throw new Error("Edge-TTS から audioBase64 が返却されませんでした");
        }

        // 3-3. Base64 を Uint8Array にデコード
        const binaryStr = atob(ttsData.audioBase64);
        const mp3Bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          mp3Bytes[i] = binaryStr.charCodeAt(i);
        }

        // 3-4. Google Drive へ narration_tts.mp3 として保存
        const uploadRes = await uploadMp3ToDrive(item.folderId, "narration_tts.mp3", mp3Bytes, env);

        const elapsed = ((Date.now() - itemStart) / 1000).toFixed(1);
        console.log(`[Hourly Cron] ✅ 完了: 「${item.folderName}」 (${elapsed}秒, File ID: ${uploadRes.id})`);

        results.push({
          status: "success",
          folderName: item.folderName,
          folderId: item.folderId,
          charCount: textContent.length,
          fileId: uploadRes.id,
          durationSec: elapsed
        });
      } catch (err) {
        console.error(`[Hourly Cron] ❌ 失敗: 「${item.folderName}」: ${err.message}`);
        results.push({
          status: "error",
          folderName: item.folderName,
          folderId: item.folderId,
          error: err.message
        });
      }
    }

    const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const summary = {
      executedAt: new Date().toISOString(),
      totalElapsedSec: totalElapsed,
      candidatesCount: candidates.length,
      successCount: results.filter(r => r.status === "success").length,
      errorCount: results.filter(r => r.status === "error").length,
      results: results
    };

    lastCronResult = {
      status: "idle",
      lastRun: new Date().toISOString(),
      summary: summary
    };

    console.log(`[Hourly Cron] 全処理完了 (${totalElapsed}秒): 成功 ${summary.successCount} 件, エラー ${summary.errorCount} 件`);
    return summary;
  } catch (globalErr) {
    console.error(`[Hourly Cron] 致命的エラー: ${globalErr.message}`);
    lastCronResult = {
      status: "error",
      lastRun: new Date().toISOString(),
      error: globalErr.message
    };
    throw globalErr;
  }
}
