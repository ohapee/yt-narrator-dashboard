import {jobRequest} from "./job-client.js";
import {getCatalog, syncCatalog} from "./catalog.js";
import { proxyMedia } from "./media.js";
import { getProjectsFolderId, driveFetch, saveJsonToFolder, assertProjectAccess, listFolderFiles } from "./drive.js";
import { requestWithRetry, HttpError, readJson } from "./http.js";
import { authRoute, requireAuthentication } from "./auth.js";
import { validateMapping } from "./validation.js";
import { enqueueNarration, retryNarrationJob } from "./narration.js";
import {saveVisual} from "./visuals.js";
export { NarrationCoordinator } from "./jobs.js";

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
      driveFetch("files?q=(name='manga_done.json'+or+name='visual_done.json')+and+trashed=false&orderBy=modifiedTime+desc&pageSize=3&fields=files(id,name,modifiedTime,parents)", env),
      driveFetch("files?q=(name='title_done.json'+or+name='visual_done.json')+and+trashed=false&orderBy=modifiedTime+desc&pageSize=3&fields=files(id,name,modifiedTime,parents)", env),
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

  const unvoicedProjects = allProjects.filter(p => p.hasNarration && !p.hasAudio);
  const untitledProjects = allProjects.filter(p => (p.hasVisual || p.mangaCount >= 8) && !p.hasTitle);

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
      ...(unvoicedProjects.length === 0 ? { status: "IDLE", label: "待機中（音声待ちなし）", isStopped: false } : {}),
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
    cronStatus: await jobRequest(env, "/status")
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // CORS ヘッダー
    const corsHeaders = { "Cache-Control": "no-store" };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      if (pathname.startsWith("/api/auth/")) return await authRoute(request, env);
      if (pathname.startsWith("/api/")) {
        await requireAuthentication(request, env, request.method === "POST" && /^\/api\/visuals\/[A-Za-z0-9_-]{10,200}$/.test(pathname) ? 17 * 1024 * 1024 : 262144);
        if (["/api/sync-catalog", "/api/cron/process-narration"].includes(pathname) && request.method !== "POST" || pathname.endsWith("/video-mapping") && request.method !== "POST") {
          return Response.json({ success: false, error: "POSTを使用してください" }, { status: 405, headers: { Allow: "POST" } });
        }
      }
      if (pathname.startsWith("/api/job-coordinator/")) {
        if (!request.headers.get("Authorization")?.startsWith("Bearer ")) throw new HttpError(403, "サービス認証が必要です");
        const path = pathname.replace("/api/job-coordinator", "");
        if (!["/status", "/enqueue", "/retry", "/login", "/discovery-error"].includes(path)) throw new HttpError(404, "見つかりません");
        return env.JOBS.get(env.JOBS.idFromName("narration")).fetch(`https://jobs${path}`, {method: request.method, ...(request.method === "POST" ? {body: JSON.stringify(await readJson(request))} : {})});
      }
      if (pathname === "/api/jobs") return Response.json(await jobRequest(env, "/status"));
      const visualMatch = pathname.match(/^\/api\/visuals\/([A-Za-z0-9_-]{10,200})$/);
      if (visualMatch) {
        if (request.method !== "POST") return Response.json({error: "POSTを使用してください"}, {status: 405, headers: {Allow: "POST"}});
        const result = await saveVisual(visualMatch[1], await readJson(request, 17 * 1024 * 1024), env);
        // 保存結果を先に返し、カタログ更新の失敗で画像を再生成しない。
        ctx.waitUntil(syncCatalog(env).catch(error => console.error("visual catalog sync", error.message)));
        return Response.json(result);
      }
      if (pathname === "/api/jobs/retry" && request.method === "POST") {
        const body = await readJson(request);
        return Response.json(await retryNarrationJob(env, body.id));
      }
      // ----------------------------------------------------
      // 1. API: 全体サマリー・ステータス (/api/overview)
      // ----------------------------------------------------
      if (pathname === "/api/overview") {
        const rootId = env.TARGET_FOLDER_ID;
        if (!rootId) throw new Error("TARGET_FOLDER_ID が未設定です。");

        // カタログからサマリーを即座に取得
        let catalog = await getCatalog(env);
        if (!catalog) throw new HttpError(409, "カタログがありません。カタログ同期を実行してください。");

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
        if (!catalog) throw new HttpError(409, "カタログがありません。カタログ同期を実行してください。");
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
        if (!catalog) throw new HttpError(409, "カタログがありません。カタログ同期を実行してください。");

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
      if (pathname.startsWith("/api/project/") && !pathname.endsWith("/video-mapping")) {
        const projectId = pathname.replace("/api/project/", "").trim();
        if (!projectId) throw new Error("プロジェクトIDが指定されていません。");

        await assertProjectAccess(projectId, env);
        const files = await listFolderFiles(projectId, env);

        // 本編漫画画像
        const visualFile = files.find(f => /^visual_summary\.(png|jpg|jpeg)$/i.test(f.name));
        const mangaFiles = visualFile ? [visualFile] : files.filter(f => /^manga_\d+\.(jpg|jpeg|png)$/i.test(f.name))
          .sort((a, b) => a.name.localeCompare(b.name));

        // タイトルカード画像
        const titleFiles = visualFile ? [visualFile] : files.filter(f => /^(00_title|title).*\.(jpg|jpeg|png)$/i.test(f.name))
          .sort((a, b) => a.name.localeCompare(b.name));

        const narrationFile = files.find(f => f.name === "narration_tts.txt");
        const audioFile = files.find(f => f.name === "narration_tts.mp3" || f.name === "narration.mp3");
        const metadataFile = files.find(f => f.name === (visualFile ? "visual_done.json" : "manga_done.json"));
        const titleDoneFile = visualFile ? metadataFile : files.find(f => f.name === "title_done.json");
        const youtubeFile = files.find(f => f.name === "youtube.json");
        const videoMappingFile = files.find(f => f.name === "video_mapping.json");

        // フォルダ内のMP4動画クリップ（AI生成動画など）
        const videoFiles = files.filter(f => /\.mp4$/i.test(f.name) && f.name !== "narration_tts.mp3")
          .sort((a, b) => a.name.localeCompare(b.name));

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

        let videoMappingJson = null;
        if (videoMappingFile) {
          const vmRes = await driveFetch(`files/${videoMappingFile.id}?alt=media`, env);
          if (vmRes.ok) {
            try {
              videoMappingJson = await vmRes.json();
            } catch (e) {}
          }
        }

        return new Response(JSON.stringify({
          success: true,
          projectId,
          files,
          visualMode: visualFile ? "single_page" : "legacy_panels",
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
          videoClips: videoFiles.map(v => ({
            id: v.id,
            name: v.name,
            size: v.size ? Number(v.size) : 0,
            url: `/api/video/${v.id}`
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
          youtube: youtubeJson,
          videoMapping: videoMappingJson
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" }
        });
      }

      // ----------------------------------------------------
      // 3-2. API: 動画シーン割当 保存 (/api/project/:id/video-mapping)
      // ----------------------------------------------------
      if (pathname.startsWith("/api/project/") && pathname.endsWith("/video-mapping") && request.method === "POST") {
        const projectId = pathname.replace("/api/project/", "").replace("/video-mapping", "").trim();
        if (!projectId) throw new Error("プロジェクトIDが指定されていません。");

        await assertProjectAccess(projectId, env);
        const files = await listFolderFiles(projectId, env);
        const body = validateMapping(await readJson(request), projectId, files);
        const result = await saveJsonToFolder(projectId, "video_mapping.json", body, env);

        return new Response(JSON.stringify({
          success: true,
          projectId,
          ...result,
          savedAt: new Date().toISOString()
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" }
        });
      }

      const mediaMatch = pathname.match(/^\/api\/(image|audio|video)\/([A-Za-z0-9_-]+)$/);
      if (mediaMatch && ["GET", "HEAD"].includes(request.method)) return proxyMedia(request, env, mediaMatch[1], mediaMatch[2]);

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
        const body = await readJson(request);
        const { engine = "edge", text, voice, speed = 1.0, caption } = body;

        if (typeof text !== "string" || !text.trim() || text.length > 20000 || !["edge", "irodori"].includes(engine) || !Number.isFinite(Number(speed)) || Number(speed) < 0.5 || Number(speed) > 2) {
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

        const ttsRes = await requestWithRetry(targetEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        }, {timeoutMs: 120000, retries: 1});

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
        const maxCount = countParam ? Number(countParam) : 4;
        if (!Number.isInteger(maxCount) || maxCount < 1 || maxCount > 4) {
          return Response.json({ success: false, error: "countは1〜4の整数を指定してください" }, { status: 400, headers: corsHeaders });
        }
        const summary = await enqueueNarration(env, maxCount);
        return Response.json(summary, { status: 202 });
      }
      if (pathname === "/api/cron/status" && request.method === "GET") {
        return Response.json(await jobRequest(env, "/status"));
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
        error: err.publicMessage || (err.status && err.status < 500 ? err.message : "処理に失敗しました。実行履歴を確認してください。")
      }), {
        status: err.status || 500,
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
    ctx.waitUntil(enqueueNarration(env, 4).catch(async error => {
      console.error("scheduled", error.message);
      await jobRequest(env, "/discovery-error", {message: "案件の検出・登録に失敗しました。Drive接続とカタログ同期を確認してください。"});
    }));
  }
};
