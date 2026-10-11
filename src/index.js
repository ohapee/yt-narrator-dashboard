/**
 * yt-narrator-dashboard - Cloudflare Workers バックエンド
 * Google Drive API を中継し、成果物と進捗状況を安全かつ高速に提供します。
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

        // projects フォルダと yt-links フォルダを取得
        const subRes = await driveFetch(
          `files?q='${rootId}'+in+parents+and+trashed=false&fields=files(id,name,mimeType,modifiedTime)&spaces=drive`,
          env
        );
        const subData = await subRes.json();
        const folders = subData.files || [];

        const projectsFolder = folders.find(f => f.name === "projects");
        const linksFolder = folders.find(f => f.name.includes("yt") && f.name.includes("link"));

        let totalProjects = 0;
        let recentProjects = [];
        let queueFiles = [];

        if (projectsFolder) {
          const pListRes = await driveFetch(
            `files?q='${projectsFolder.id}'+in+parents+and+trashed=false&fields=files(id,name,mimeType,createdTime,modifiedTime)&orderBy=name+desc&pageSize=50&spaces=drive`,
            env
          );
          const pListData = await pListRes.json();
          const pList = pListData.files || [];
          totalProjects = pList.length;
          recentProjects = pList.slice(0, 5);
        }

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
          totalProjects,
          recentProjects,
          queueFiles,
          updatedAt: new Date().toISOString()
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" }
        });
      }

      // ----------------------------------------------------
      // 2. API: プロジェクト一覧取得 (/api/projects)
      // ----------------------------------------------------
      if (pathname === "/api/projects") {
        const rootId = env.TARGET_FOLDER_ID;
        const subRes = await driveFetch(
          `files?q='${rootId}'+in+parents+and+name='projects'+and+trashed=false&fields=files(id)&spaces=drive`,
          env
        );
        const subData = await subRes.json();
        const pFolder = subData.files?.[0];
        if (!pFolder) {
          return new Response(JSON.stringify({ success: false, error: "projects フォルダが見つかりません" }), {
            headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" }
          });
        }

        const pageSize = Math.min(parseInt(url.searchParams.get("limit") || "60", 10), 100);
        const pageToken = url.searchParams.get("pageToken") || "";

        let q = `'${pFolder.id}'+in+parents+and+trashed=false`;
        let queryUrl = `files?q=${q}&fields=nextPageToken,files(id,name,mimeType,createdTime,modifiedTime)&orderBy=name+desc&pageSize=${pageSize}&spaces=drive`;
        if (pageToken) queryUrl += `&pageToken=${pageToken}`;

        const listRes = await driveFetch(queryUrl, env);
        const listData = await listRes.json();
        const rawProjects = listData.files || [];

        // 各プロジェクト直下のファイル構造を並列にクイック調査
        const projectSummaries = await Promise.all(
          rawProjects.map(async (p) => {
            try {
              const filesRes = await driveFetch(
                `files?q='${p.id}'+in+parents+and+trashed=false&fields=files(id,name,size,mimeType)&pageSize=50&spaces=drive`,
                env
              );
              const filesData = await filesRes.json();
              const files = filesData.files || [];

              // 本編漫画画像
              const mangaImages = files.filter(f => /^manga_\d+\.(jpg|jpeg|png)$/i.test(f.name))
                .sort((a, b) => a.name.localeCompare(b.name));

              // タイトルカード画像
              const titleImages = files.filter(f => /^(00_title|title).*\.(jpg|jpeg|png)$/i.test(f.name))
                .sort((a, b) => a.name.localeCompare(b.name));

              const hasNarration = files.some(f => f.name === "narration_tts.txt");
              const hasYoutube = files.some(f => f.name === "youtube.json");
              const mangaDoneFile = files.find(f => f.name === "manga_done.json");
              const titleDoneFile = files.find(f => f.name === "title_done.json");

              // サムネイル用：00_title_final.jpg > 00_title.jpg > 他のtitle > manga_01.jpg
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

              let status = "GENERATING"; // 生成中
              if (mangaImages.length >= 8 && hasNarration && mangaDoneFile) {
                status = "COMPLETED"; // 8コマ・原稿・メタデータ完備
              } else if (mangaImages.length > 0 || titleImages.length > 0) {
                status = "PARTIAL"; // 一部生成完了
              }

              return {
                id: p.id,
                name: p.name,
                createdTime: p.createdTime,
                modifiedTime: p.modifiedTime,
                totalFiles: files.length,
                mangaCount: mangaImages.length,
                titleCount: titleImages.length,
                hasNarration,
                hasYoutube,
                hasMetadata: !!mangaDoneFile,
                hasTitle: titleImages.length > 0,
                mangaDoneId: mangaDoneFile?.id || "",
                thumbnailId,
                status
              };
            } catch (err) {
              return {
                id: p.id,
                name: p.name,
                createdTime: p.createdTime,
                modifiedTime: p.modifiedTime,
                totalFiles: 0,
                mangaCount: 0,
                titleCount: 0,
                hasNarration: false,
                hasYoutube: false,
                hasMetadata: false,
                hasTitle: false,
                thumbnailId: "",
                status: "UNKNOWN"
              };
            }
          })
        );

        return new Response(JSON.stringify({
          success: true,
          projects: projectSummaries,
          nextPageToken: listData.nextPageToken || null
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" }
        });
      }

      // ----------------------------------------------------
      // 3. API: プロジェクト詳細取得 (/api/project/:id)
      // ----------------------------------------------------
      if (pathname.startsWith("/api/project/")) {
        const projectId = pathname.replace("/api/project/", "").trim();
        if (!projectId) throw new Error("プロジェクトIDが指定されていません。");

        // フォルダ内の全ファイルを取得
        const filesRes = await driveFetch(
          `files?q='${projectId}'+in+parents+and+trashed=false&fields=files(id,name,size,mimeType,modifiedTime,webViewLink)&orderBy=name+asc&pageSize=50&spaces=drive`,
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

        // 各キューファイルの内容を読み込む
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
          // 国産Flow Matching音声合成モデル Irodori-TTS (NVIDIA T4 GPU)
          targetEndpoint = `${modalUrl}/api/synthesize`;
          payload = {
            text: text,
            voice: voice || "female-bright",
            caption: caption || undefined,
            speed: Number(speed) || 1.0,
            format: "mp3"
          };
        } else {
          // Microsoft Edge TTS (CPU即時実行・完全無料)
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
          speed: payload.speed
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" }
        });
      }

      // ----------------------------------------------------
      // 7. 静的アセット（HTML / CSS / JS）の配信
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
  }
};
