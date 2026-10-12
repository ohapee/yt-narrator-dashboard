/**
 * YouTube ナレーター ＆ 漫画生成 管理ダッシュボード
 * クライアント側制御スクリプト
 */

let allProjects = [];
let allQueues = [];
let currentProjectDetail = null;
let currentMangaIndex = 0;

// DOM 要素
const statTotalProjects = document.getElementById("stat-total-projects");
const statCompletedProjects = document.getElementById("stat-completed-projects");
const statAudioProjects = document.getElementById("stat-audio-projects");
const statPartialProjects = document.getElementById("stat-partial-projects");
const statQueueStatus = document.getElementById("stat-queue-status");
const statQueueDesc = document.getElementById("stat-queue-desc");
const tabProjectCount = document.getElementById("tab-project-count");
const tabQueueCount = document.getElementById("tab-queue-count");

const projectsGrid = document.getElementById("projects-grid");
const searchInput = document.getElementById("search-input");
const clearSearchBtn = document.getElementById("clear-search-btn");
const statusFilter = document.getElementById("status-filter");
const sortSelect = document.getElementById("sort-select");
const refreshBtn = document.getElementById("refresh-btn");
const queueList = document.getElementById("queue-list");

// モーダル要素
const projectModal = document.getElementById("project-modal");
const closeModalBtn = document.getElementById("close-modal-btn");
const modalCloseBottomBtn = document.getElementById("modal-close-bottom-btn");
const modalTitle = document.getElementById("modal-project-title");
const modalStatusBadge = document.getElementById("modal-status-badge");
const modalDateBadge = document.getElementById("modal-date-badge");
const modalMangaCount = document.getElementById("modal-manga-count");
const modalTitleCount = document.getElementById("modal-title-count");
const modalDriveLink = document.getElementById("modal-drive-link");
const modalTabAudioBadge = document.getElementById("modal-tab-audio-badge");

// Google Drive 登録済みナレーション音声要素
const driveAudioBadge = document.getElementById("drive-audio-badge");
const driveAudioDesc = document.getElementById("drive-audio-desc");
const driveAudioActions = document.getElementById("drive-audio-actions");
const driveAudioDownloadLink = document.getElementById("drive-audio-download-link");
const driveAudioPlayerWrap = document.getElementById("drive-audio-player-wrap");
const driveAudioElement = document.getElementById("drive-audio-element");
const driveAudioEmptyWrap = document.getElementById("drive-audio-empty-wrap");

// 漫画ビューア要素
const mangaCurrentImage = document.getElementById("manga-current-image");
const mangaPageIndicator = document.getElementById("manga-page-indicator");
const mangaFileName = document.getElementById("manga-file-name");
const mangaPrevBtn = document.getElementById("manga-prev-btn");
const mangaNextBtn = document.getElementById("manga-next-btn");
const mangaThumbnails = document.getElementById("manga-thumbnails");

// タイトルカード要素
const titleCardsGrid = document.getElementById("title-cards-grid");

// ナレーション要素
const narrationTextArea = document.getElementById("narration-text-area");
const narrationCharCount = document.getElementById("narration-char-count");
const narrationDurationEst = document.getElementById("narration-duration-est");
const copyNarrationBtn = document.getElementById("copy-narration-btn");

// TTS（音声合成プレビュー）要素
const ttsEngineSelect = document.getElementById("tts-engine-select");
const ttsVoiceSelect = document.getElementById("tts-voice-select");
const ttsSpeedSelect = document.getElementById("tts-speed-select");
const ttsGenerateBtn = document.getElementById("tts-generate-btn");
const ttsBtnIcon = document.getElementById("tts-btn-icon");
const ttsBtnText = document.getElementById("tts-btn-text");
const ttsBrowserPlayBtn = document.getElementById("tts-browser-play-btn");
const ttsStopBtn = document.getElementById("tts-stop-btn");
const ttsDownloadBtn = document.getElementById("tts-download-btn");
const ttsPlayerBox = document.getElementById("tts-player-box");
const ttsAudioElement = document.getElementById("tts-audio-element");
const ttsStatusMsg = document.getElementById("tts-status-msg");

// エンジン別話者定義
const TTS_VOICES_BY_ENGINE = {
  irodori: [
    { id: "female-bright", name: "明るく元気な若い女性（アナウンス調・推奨）" },
    { id: "female-calm", name: "落ち着いた優しい大人の女性（穏やか）" },
    { id: "smiling-fast", name: "微笑みながら少し早口（YouTubeショート推奨）" },
    { id: "young-girl", name: "可愛らしくあどけない少女の声" },
    { id: "neutral-voice", name: "中性的な声（自然でフラットな語り口）" },
    { id: "female-whisper", name: "優しくささやくような女性（ウィスパー）" },
    { id: "female-anime", name: "感情豊かで可愛らしいアニメ風の女性" },
    { id: "male-calm", name: "落ち着いた深みのある男性アナウンサー" },
    { id: "male-energetic", name: "ハキハキとした爽やかな男性" },
    { id: "male-narrator", name: "重厚で渋いプロのドキュメンタリー男性" },
    { id: "neutral-clear", name: "ニュートラルでクリアな機械アナウンス風" }
  ],
  edge: [
    { id: "ja-JP-NanamiNeural", name: "七海（明るく自然な女性アナウンス・定番人気）" },
    { id: "ja-JP-KeitaNeural", name: "啓太（落ち着いた自然な男性ナレーション・定番人気）" },
    { id: "ja-JP-AoiNeural", name: "葵（感情豊かで表現力のある女性）" },
    { id: "ja-JP-DaichiNeural", name: "大地（明瞭で聞き取りやすい男性解説）" },
    { id: "ja-JP-MayuNeural", name: "真由（穏やかで優しい女性）" },
    { id: "ja-JP-NaokiNeural", name: "直樹（爽やかで活力のある若い男性）" },
    { id: "ja-JP-ShioriNeural", name: "詩織（落ち着いた大人の女性）" }
  ]
};

let currentTtsAudioBlobUrl = null;
let currentTtsAudioBlob = null;

// メタデータ要素
const metaSynopsis = document.getElementById("meta-synopsis");
const metaFileList = document.getElementById("meta-file-list");

// YouTube元動画要素
const modalYoutubeBadge = document.getElementById("modal-youtube-badge");
const modalYoutubeLink = document.getElementById("modal-youtube-link");
const narrationYoutubeSource = document.getElementById("narration-youtube-source");
const narrationYoutubeLink = document.getElementById("narration-youtube-link");
const narrationYoutubeMeta = document.getElementById("narration-youtube-meta");
const narrationYoutubeBtn = document.getElementById("narration-youtube-btn");

const metaYoutubeSection = document.getElementById("meta-youtube-section");
const ytCardThumb = document.getElementById("yt-card-thumb");
const ytCardPlayOverlay = document.getElementById("yt-card-play-overlay");
const ytCardTitle = document.getElementById("yt-card-title");
const ytCardChannel = document.getElementById("yt-card-channel");
const ytCardPublish = document.getElementById("yt-card-publish");
const ytCardDuration = document.getElementById("yt-card-duration");
const ytCardViews = document.getElementById("yt-card-views");
const ytCardLinkBtn = document.getElementById("yt-card-link-btn");

// 動画シーン割当スタジオ要素
const modalTabVideoBadge = document.getElementById("modal-tab-video-badge");
const videoMappingStatusBadge = document.getElementById("video-mapping-status-badge");
const videoAutoEqualizeBtn = document.getElementById("video-auto-equalize-btn");
const videoAutoScriptBtn = document.getElementById("video-auto-script-btn");
const videoAudioPlayBtn = document.getElementById("video-audio-play-btn");
const videoAudioPlayIcon = document.getElementById("video-audio-play-icon");
const videoAudioTimeDisplay = document.getElementById("video-audio-time-display");
const videoAudioSeekbar = document.getElementById("video-audio-seekbar");
const videoTotalDurationDisplay = document.getElementById("video-total-duration-display");
const videoSubtitleEnableChk = document.getElementById("video-subtitle-enable-chk");
const videoScenesContainer = document.getElementById("video-scenes-container");
const videoSaveDriveBtn = document.getElementById("video-save-drive-btn");
const videoSaveStatus = document.getElementById("video-save-status");
const videoExportSrtBtn = document.getElementById("video-export-srt-btn");
const videoCopyFfmpegBtn = document.getElementById("video-copy-ffmpeg-btn");

// 動画スタジオ用状態
let currentScenes = [];
let currentVideoAudio = new Audio();
let videoStudioTotalDuration = 63.0; // デフォルト63秒 (7秒×9シーン)
let isAudioSeeking = false;

// ----------------------------------------------------
// 初期化
// ----------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  initEvents();
  loadData();
});

function initEvents() {
  // タブ切り替え
  document.querySelectorAll(".nav-tabs .tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".nav-tabs .tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(c => c.classList.add("hidden"));
      btn.classList.add("active");
      const targetId = btn.dataset.tab;
      document.getElementById(targetId)?.classList.remove("hidden");
    });
  });

  // モーダル内タブ切り替え
  document.querySelectorAll(".modal-tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".modal-tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".modal-tab-content").forEach(c => c.classList.add("hidden"));
      btn.classList.add("active");
      const targetId = btn.dataset.modaltab;
      document.getElementById(targetId)?.classList.remove("hidden");
    });
  });

  // 検索・フィルター
  searchInput.addEventListener("input", () => {
    clearSearchBtn.classList.toggle("hidden", !searchInput.value);
    applyFilters();
  });

  clearSearchBtn.addEventListener("click", () => {
    searchInput.value = "";
    clearSearchBtn.classList.add("hidden");
    applyFilters();
  });

  statusFilter.addEventListener("change", applyFilters);
  sortSelect.addEventListener("change", applyFilters);

  // リフレッシュボタン
  refreshBtn.addEventListener("click", () => {
    refreshBtn.classList.add("spinning");
    loadData().finally(() => refreshBtn.classList.remove("spinning"));
  });

  // モーダル閉じる
  closeModalBtn.addEventListener("click", closeModal);
  modalCloseBottomBtn.addEventListener("click", closeModal);
  projectModal.querySelector(".modal-backdrop").addEventListener("click", closeModal);

  // 漫画送り
  mangaPrevBtn.addEventListener("click", (e) => { e.stopPropagation(); prevMangaPage(); });
  mangaNextBtn.addEventListener("click", (e) => { e.stopPropagation(); nextMangaPage(); });

  // キーボード操作（左右キーでコマ送り、ESCで閉じる）
  document.addEventListener("keydown", (e) => {
    if (!projectModal.classList.contains("hidden")) {
      if (e.key === "ArrowLeft") prevMangaPage();
      else if (e.key === "ArrowRight") nextMangaPage();
      else if (e.key === "Escape") closeModal();
    }
  });

  // 原稿コピー
  copyNarrationBtn.addEventListener("click", () => {
    if (narrationTextArea.value) {
      navigator.clipboard.writeText(narrationTextArea.value).then(() => {
        copyNarrationBtn.textContent = "✅ コピーしました！";
        setTimeout(() => copyNarrationBtn.textContent = "📋 原稿をコピー", 2000);
      });
    }
  });

  // 音声合成（TTS）プレビュー操作
  if (ttsEngineSelect) {
    ttsEngineSelect.addEventListener("change", updateVoiceSelectOptions);
  }
  updateVoiceSelectOptions();

  ttsGenerateBtn.addEventListener("click", generateAiTts);
  ttsBrowserPlayBtn.addEventListener("click", playBrowserSpeech);
  ttsStopBtn.addEventListener("click", stopTts);
  ttsDownloadBtn.addEventListener("click", downloadTtsMp3);

  ttsAudioElement.addEventListener("play", () => {
    ttsStopBtn.classList.remove("hidden");
  });
  ttsAudioElement.addEventListener("ended", () => {
    ttsStopBtn.classList.add("hidden");
  });
  ttsAudioElement.addEventListener("pause", () => {
    if (window.speechSynthesis && !window.speechSynthesis.speaking) {
      ttsStopBtn.classList.add("hidden");
    }
  });

  // 手動Cronトリガーボタン（1時間待たずに即時4件実行）
  const triggerCronBtn = document.getElementById("trigger-cron-btn");
  const triggerCronText = document.getElementById("trigger-cron-text");
  const triggerCronIcon = document.getElementById("trigger-cron-icon");

  if (triggerCronBtn) {
    triggerCronBtn.addEventListener("click", async () => {
      if (!confirm("未処理の案件フォルダから最大4件を抽出し、Edge-TTS (Nanami 1.3x) でナレーション音声を生成してGoogle Driveに保存します。\n実行しますか？")) {
        return;
      }

      triggerCronBtn.disabled = true;
      triggerCronIcon.textContent = "⏳";
      triggerCronText.textContent = "音声生成＆アップロード中...";

      try {
        const res = await fetch("/api/cron/process-narration", { method: "POST" });
        const data = await res.json();

        if (data.success) {
          const successList = (data.results || []).filter(r => r.status === "success").map(r => `・${r.folderName}`).join("\n");
          alert(`🎉 ナレーション自動生成が完了しました！\n\n処理完了: ${data.successCount} 件 (所要時間: ${data.totalElapsedSec}秒)\n\n${successList || "（未処理フォルダはありませんでした）"}`);
          loadData();
        } else {
          alert(`エラー: ${data.error || "バッチ実行に失敗しました"}`);
        }
      } catch (err) {
        alert(`通信エラー: ${err.message}`);
      } finally {
        triggerCronBtn.disabled = false;
        triggerCronIcon.textContent = "⚡";
        triggerCronText.textContent = "今すぐ4件を手動実行";
      }
    });
  }

  // カタログ即時差分同期ボタン
  const syncCatalogBtn = document.getElementById("sync-catalog-btn");
  const syncCatalogIcon = document.getElementById("sync-catalog-icon");
  const syncCatalogText = document.getElementById("sync-catalog-text");

  if (syncCatalogBtn) {
    syncCatalogBtn.addEventListener("click", async () => {
      syncCatalogBtn.disabled = true;
      syncCatalogIcon.textContent = "⏳";
      syncCatalogText.textContent = "差分同期中...";

      try {
        const res = await fetch("/api/sync-catalog", { method: "POST" });
        const data = await res.json();
        if (data.success) {
          alert(`⚡ カタログ同期が完了しました！\n\n・総フォルダ数: ${data.totalProjects} 件\n・更新フォルダ数: ${data.updatedFolders} 件\n・所要時間: ${data.elapsedSec} 秒`);
          loadData();
        } else {
          alert(`同期エラー: ${data.error || "カタログ同期に失敗しました"}`);
        }
      } catch (err) {
        alert(`通信エラー: ${err.message}`);
      } finally {
        syncCatalogBtn.disabled = false;
        syncCatalogIcon.textContent = "⚡";
        syncCatalogText.textContent = "カタログ同期";
      }
    });
  }

  // 停滞案件リストの表示・非表示トグル
  const showStalledBtn = document.getElementById("show-stalled-btn");
  const stalledListContainer = document.getElementById("stalled-list-container");
  if (showStalledBtn && stalledListContainer) {
    showStalledBtn.addEventListener("click", () => {
      const isHidden = stalledListContainer.classList.contains("hidden");
      stalledListContainer.classList.toggle("hidden", !isHidden);
      showStalledBtn.textContent = isHidden ? "停滞案件の内訳を閉じる ▴" : "停滞案件の内訳を表示 ▾";
    });
  }

  // 🎬 動画シーン割当スタジオイベント登録
  if (videoAutoEqualizeBtn) {
    videoAutoEqualizeBtn.addEventListener("click", () => {
      applyEqualSplit();
    });
  }
  if (videoAutoScriptBtn) {
    videoAutoScriptBtn.addEventListener("click", () => {
      applyScriptRatioSplit();
    });
  }
  if (videoAudioPlayBtn) {
    videoAudioPlayBtn.addEventListener("click", () => {
      toggleVideoAudioPlay();
    });
  }
  if (videoAudioSeekbar) {
    videoAudioSeekbar.addEventListener("input", () => {
      isAudioSeeking = true;
      if (currentVideoAudio && currentVideoAudio.duration) {
        const targetTime = (videoAudioSeekbar.value / 100) * currentVideoAudio.duration;
        if (videoAudioTimeDisplay) {
          videoAudioTimeDisplay.textContent = `${formatSeconds(targetTime)} / ${formatSeconds(currentVideoAudio.duration)}`;
        }
      }
    });
    videoAudioSeekbar.addEventListener("change", () => {
      isAudioSeeking = false;
      if (currentVideoAudio && currentVideoAudio.duration) {
        currentVideoAudio.currentTime = (videoAudioSeekbar.value / 100) * currentVideoAudio.duration;
      }
    });
  }
  if (videoSubtitleEnableChk) {
    videoSubtitleEnableChk.addEventListener("change", () => {
      updateSubtitleVisibility();
    });
  }
  if (videoSaveDriveBtn) {
    videoSaveDriveBtn.addEventListener("click", () => {
      saveVideoMappingToDrive();
    });
  }
  if (videoExportSrtBtn) {
    videoExportSrtBtn.addEventListener("click", () => {
      exportSrtFile();
    });
  }
  if (videoCopyFfmpegBtn) {
    videoCopyFfmpegBtn.addEventListener("click", () => {
      copyFfmpegCommand();
    });
  }

  // 音声再生プレビューとシークバーの連動イベント
  currentVideoAudio.addEventListener("timeupdate", () => {
    if (!currentVideoAudio.duration || isAudioSeeking) return;
    const cur = currentVideoAudio.currentTime;
    const dur = currentVideoAudio.duration;
    const pct = (cur / dur) * 100;
    if (videoAudioSeekbar) videoAudioSeekbar.value = pct;
    if (videoAudioTimeDisplay) {
      videoAudioTimeDisplay.textContent = `${formatSeconds(cur)} / ${formatSeconds(dur)}`;
    }
    highlightActiveScene(cur);
  });

  currentVideoAudio.addEventListener("ended", () => {
    if (videoAudioPlayIcon) videoAudioPlayIcon.textContent = "▶️";
    highlightActiveScene(-1);
  });

  currentVideoAudio.addEventListener("pause", () => {
    if (videoAudioPlayIcon) videoAudioPlayIcon.textContent = "▶️";
  });

  currentVideoAudio.addEventListener("play", () => {
    if (videoAudioPlayIcon) videoAudioPlayIcon.textContent = "⏸️";
  });
}

// ----------------------------------------------------
// データ読み込み
// ----------------------------------------------------
async function loadData() {
  try {
    // 概要の取得
    const overviewRes = await fetch("/api/overview");
    const overviewData = await overviewRes.json();
    if (overviewData.success) {
      updateOverview(overviewData);
    }

    // プロジェクト一覧の取得（_catalog.jsonから全件瞬時取得）
    const projRes = await fetch("/api/projects");
    const projData = await projRes.json();
    if (projData.success) {
      allProjects = projData.projects || [];
      tabProjectCount.textContent = allProjects.length;
      updateStats();
      applyFilters();
    }

    // キュー一覧の取得
    const queueRes = await fetch("/api/queues");
    const queueData = await queueRes.json();
    if (queueData.success) {
      allQueues = queueData.queues || [];
      tabQueueCount.textContent = allQueues.length;
      renderQueues(allQueues);
    }
  } catch (err) {
    console.error("データ読み込みエラー:", err);
    projectsGrid.innerHTML = `
      <div class="empty-state">
        <p>⚠️ データの取得に失敗しました: ${err.message}</p>
        <button class="btn btn-secondary btn-sm" onclick="loadData()" style="margin-top:12px;">再試行</button>
      </div>
    `;
  }
}

function updateOverview(data) {
  statTotalProjects.textContent = `${data.totalProjects} 件`;
  if (data.queueFiles && data.queueFiles.length > 0) {
    const latestQueue = data.queueFiles[0];
    statQueueStatus.textContent = latestQueue.name.replace(".txt", "").slice(0, 18);
    statQueueDesc.textContent = `更新: ${formatDate(latestQueue.modifiedTime)}`;
  } else {
    statQueueStatus.textContent = "0 件";
    statQueueDesc.textContent = "待機中キューなし";
  }

  // パイプライン稼働状況モニターの描画
  if (data.pipelineStatus) {
    updatePipelineMonitor(data.pipelineStatus);
  }
}

function updatePipelineMonitor(status) {
  // 1. 8コマ漫画生成
  const m = status.manga;
  if (m) {
    const timeEl = document.getElementById("time-monitor-manga");
    const diffEl = document.getElementById("diff-monitor-manga");
    const badgeEl = document.getElementById("badge-monitor-manga");
    const projEl = document.getElementById("project-monitor-manga");
    const pendEl = document.getElementById("pending-monitor-manga");

    if (timeEl) timeEl.textContent = formatDateTime(m.lastExecutedAt);
    if (diffEl) diffEl.textContent = m.timeAgo ? `(${m.timeAgo})` : "";
    if (badgeEl) {
      badgeEl.textContent = m.label;
      badgeEl.className = `badge ${m.status === "ACTIVE" ? "badge-success" : m.status === "WARN" ? "badge-warning" : "badge-danger"}`;
    }
    if (projEl) projEl.textContent = formatProjectTitle(m.projectName);
    if (pendEl) pendEl.textContent = `${m.pendingCount} 件`;
  }

  // 2. タイトル画像作成
  const t = status.title;
  if (t) {
    const timeEl = document.getElementById("time-monitor-title");
    const diffEl = document.getElementById("diff-monitor-title");
    const badgeEl = document.getElementById("badge-monitor-title");
    const projEl = document.getElementById("project-monitor-title");
    const pendEl = document.getElementById("pending-monitor-title");

    if (timeEl) timeEl.textContent = formatDateTime(t.lastExecutedAt);
    if (diffEl) diffEl.textContent = t.timeAgo ? `(${t.timeAgo})` : "";
    if (badgeEl) {
      badgeEl.textContent = t.label;
      badgeEl.className = `badge ${t.status === "ACTIVE" ? "badge-success" : t.status === "WARN" ? "badge-warning" : "badge-danger"}`;
    }
    if (projEl) projEl.textContent = formatProjectTitle(t.projectName);
    if (pendEl) pendEl.textContent = `${t.pendingCount} 件`;
  }

  // 3. ナレーション音声生成
  const a = status.audio;
  if (a) {
    const timeEl = document.getElementById("time-monitor-audio");
    const diffEl = document.getElementById("diff-monitor-audio");
    const badgeEl = document.getElementById("badge-monitor-audio");
    const projEl = document.getElementById("project-monitor-audio");
    const pendEl = document.getElementById("pending-monitor-audio");

    if (timeEl) timeEl.textContent = formatDateTime(a.lastExecutedAt);
    if (diffEl) diffEl.textContent = a.timeAgo ? `(${a.timeAgo})` : "";
    if (badgeEl) {
      badgeEl.textContent = a.label;
      badgeEl.className = `badge ${a.status === "ACTIVE" ? "badge-success" : a.status === "WARN" ? "badge-warning" : "badge-danger"}`;
    }
    if (projEl) projEl.textContent = formatProjectTitle(a.projectName);
    if (pendEl) pendEl.textContent = `${a.pendingCount} 件`;
  }

  // 4. 停滞・エラー警告バナーの制御
  const stalledBox = document.getElementById("stalled-alert-box");
  const stalledUl = document.getElementById("stalled-list-ul");
  const stalledTitle = document.getElementById("stalled-alert-title");
  const stalledDesc = document.getElementById("stalled-alert-desc");

  const stalledList = status.stalledProjects || [];
  const titleStopped = status.title && status.title.status === "STOPPED";

  if (stalledList.length > 0 || titleStopped) {
    if (stalledBox) stalledBox.classList.remove("hidden");

    let warnings = [];
    if (titleStopped) {
      warnings.push(`タイトル画像生成が【${status.title.timeAgo}】から停止しています（現在 ${status.title.pendingCount} 件がタイトル未生成）`);
    }
    if (stalledList.length > 0) {
      warnings.push(`漫画画像が未生成のまま長時間経過している案件が ${stalledList.length} 件あります`);
    }

    if (stalledTitle) {
      stalledTitle.textContent = titleStopped ? "🚨 タイトル画像生成停止 ＆ 漫画未完の警告" : "⚠️ 漫画生成待ち・停滞案件の警告";
    }
    if (stalledDesc) {
      stalledDesc.textContent = warnings.join(" / ");
    }

    if (stalledUl) {
      stalledUl.innerHTML = stalledList.map(item => {
        const ageHours = ((Date.now() - new Date(item.createdTime).getTime()) / 3600000).toFixed(1);
        return `
          <li style="display:flex; justify-content:space-between; align-items:center; background:#ffffff; border:1px solid #fee2e2; padding:8px 12px; border-radius:6px; box-shadow:0 1px 2px rgba(0,0,0,0.03);">
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="color:#ef4444; font-size:14px;">⏳</span>
              <span style="font-weight:700; color:var(--text-main); font-size:13px;">${escapeHtml(formatProjectTitle(item.name))}</span>
              <span style="color:var(--text-muted); font-size:11px;">(${ageHours}時間前に投入)</span>
            </div>
            <div style="display:flex; align-items:center; gap:8px;">
              <span class="badge badge-warning" style="font-size:11px; font-weight:600;">漫画: ${item.mangaCount}/8コマ</span>
              <span class="badge ${item.hasTitle ? 'badge-success' : 'badge-subtle'}" style="font-size:11px;">${item.hasTitle ? '表紙あり' : '表紙なし'}</span>
              <button class="btn btn-secondary btn-sm" onclick="filterByProjectName('${escapeHtml(item.name)}')" style="font-size:11px; padding:3px 10px; font-weight:600;">確認</button>
            </div>
          </li>
        `;
      }).join("");
    }
  } else {
    if (stalledBox) stalledBox.classList.add("hidden");
  }
}

function filterByProjectName(name) {
  searchInput.value = name;
  clearSearchBtn.classList.remove("hidden");
  applyFilters();
  window.scrollTo({ top: document.getElementById("projects-view").offsetTop - 80, behavior: "smooth" });
}

function formatDateTime(iso) {
  if (!iso) return "記録なし";
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, "0");
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const mins = pad(d.getMinutes());
  return `${year}/${month}/${day} ${hours}:${mins}`;
}

function updateStats() {
  let completedCount = 0;
  let partialCount = 0;
  let audioCount = 0;

  allProjects.forEach(p => {
    if (p.status === "COMPLETED") completedCount++;
    else partialCount++;
    if (p.hasAudio) audioCount++;
  });

  statCompletedProjects.textContent = `${completedCount} 件`;
  statPartialProjects.textContent = `${partialCount} 件`;
  if (statAudioProjects) {
    statAudioProjects.textContent = `${audioCount} 件`;
  }
}

// ----------------------------------------------------
// フィルター・ソート・一覧レンダリング
// ----------------------------------------------------
function applyFilters() {
  const query = searchInput.value.trim().toLowerCase();
  const statusVal = statusFilter.value;
  const sortVal = sortSelect.value;

  let filtered = allProjects.filter(p => {
    const matchQuery = !query || p.name.toLowerCase().includes(query);
    let matchStatus = true;
    if (statusVal === "COMPLETED") {
      matchStatus = (p.status === "COMPLETED");
    } else if (statusVal === "PARTIAL") {
      matchStatus = (p.status !== "COMPLETED");
    } else if (statusVal === "AUDIO_READY") {
      matchStatus = !!p.hasAudio;
    } else if (statusVal === "AUDIO_PENDING") {
      matchStatus = !p.hasAudio;
    }
    return matchQuery && matchStatus;
  });

  // ソート
  filtered.sort((a, b) => {
    if (sortVal === "name-desc") return b.name.localeCompare(a.name);
    if (sortVal === "name-asc") return a.name.localeCompare(b.name);
    if (sortVal === "manga-desc") return (b.mangaCount || 0) - (a.mangaCount || 0);
    return 0;
  });

  renderProjects(filtered);
}

function renderProjects(projects) {
  if (projects.length === 0) {
    projectsGrid.innerHTML = `
      <div class="empty-state">
        <p>該当するプロジェクトが見つかりませんでした。</p>
      </div>
    `;
    return;
  }

  projectsGrid.innerHTML = projects.map(p => {
    const thumbHtml = p.thumbnailId
      ? `<img src="/api/image/${p.thumbnailId}" alt="${escapeHtml(p.name)}" loading="lazy">`
      : `<div class="thumb-placeholder">🖼️</div>`;

    const statusBadge = p.status === "COMPLETED"
      ? `<span class="badge badge-success">✅ 完備 (8コマ)</span>`
      : `<span class="badge badge-warning">⏳ 生成中 (${p.mangaCount}/8コマ)</span>`;

    const audioBadge = p.hasAudio
      ? `<span class="badge" style="background:#065f46; color:#34d399; font-weight:600; border:1px solid #059669;" title="Google Driveに narration_tts.mp3 が生成・保存されています">🎙️ 音声あり (MP3)</span>`
      : `<span class="badge" style="background:#1e293b; color:#94a3b8; border:1px solid #334155;" title="ナレーション音声はまだ生成されていません">⏳ 音声未生成</span>`;

    const narrationBadge = p.hasNarration
      ? `<span class="badge badge-subtle">📝 原稿あり</span>`
      : `<span class="badge badge-subtle" style="opacity:0.5;">原稿なし</span>`;

    const titleBadge = p.hasTitle
      ? `<span class="badge badge-subtle" style="color:var(--primary); font-weight:600;">🎨 表紙あり</span>`
      : ``;

    const displayTitle = formatProjectTitle(p.name);

    return `
      <div class="project-card" onclick="openProjectDetail('${p.id}', '${escapeHtml(p.name)}')">
        <div class="project-thumb-box">
          ${thumbHtml}
          <div class="thumb-badges">
            ${p.titleCount > 0 ? `<span class="thumb-manga-badge" style="background:rgba(26,115,232,0.85);">🎨 表紙 ${p.titleCount}</span>` : ''}
            <span class="thumb-manga-badge">漫画 ${p.mangaCount}コマ</span>
            ${p.hasAudio ? `<span class="thumb-manga-badge" style="background:rgba(16,185,129,0.9); font-weight:700;">🎙️ MP3</span>` : ''}
          </div>
        </div>
        <div class="project-content">
          <div class="project-badge-row">
            ${statusBadge}
            ${audioBadge}
            ${narrationBadge}
            ${titleBadge}
            ${p.hasYoutube ? `<span class="badge-yt" title="作成元YouTube動画情報（youtube.json）あり">📺 元動画</span>` : ''}
          </div>
          <h3 class="project-title" title="${escapeHtml(p.name)}">${displayTitle}</h3>
          <div class="project-meta-row">
            <span>🕒 ${formatDate(p.modifiedTime)}</span>
            <span style="margin-left:auto; color:var(--primary); font-weight:500;">詳細・プレビュー &rarr;</span>
          </div>
        </div>
      </div>
    `;
  }).join("");
}

// ----------------------------------------------------
// キュー（yt-links）のレンダリング
// ----------------------------------------------------
function renderQueues(queues) {
  if (queues.length === 0) {
    queueList.innerHTML = `<p class="empty-state">キューファイルはありません。</p>`;
    return;
  }

  queueList.innerHTML = queues.map(q => {
    const urlListHtml = q.urls.map(u => `<div>${escapeHtml(u)}</div>`).join("") || '<span style="color:#94a3b8;">(空または処理済み)</span>';
    return `
      <div class="queue-item">
        <div class="queue-item-header">
          <div>
            <span class="queue-filename">📄 ${escapeHtml(q.name)}</span>
            <span class="badge badge-subtle" style="margin-left:8px;">${q.lineCount} 件のURL</span>
          </div>
          <span style="font-size:12px; color:var(--text-muted);">更新: ${formatDate(q.modifiedTime)}</span>
        </div>
        <div class="queue-urls-box">
          ${urlListHtml}
        </div>
      </div>
    `;
  }).join("");
}

// ----------------------------------------------------
// プロジェクト詳細モーダル
// ----------------------------------------------------
async function openProjectDetail(projectId, projectName) {
  projectModal.classList.remove("hidden");
  modalTitle.textContent = formatProjectTitle(projectName);
  modalDriveLink.href = `https://drive.google.com/drive/folders/${projectId}`;

  // 初期化状態
  mangaCurrentImage.src = "";
  mangaThumbnails.innerHTML = `<div class="spinner"></div>`;
  titleCardsGrid.innerHTML = `<div class="spinner"></div>`;
  narrationTextArea.value = "読み込み中...";
  metaSynopsis.textContent = "読み込み中...";
  metaFileList.innerHTML = "";

  try {
    const res = await fetch(`/api/project/${projectId}`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    currentProjectDetail = data;
    renderProjectDetail(data, projectName);
  } catch (err) {
    alert(`プロジェクト詳細の取得に失敗しました: ${err.message}`);
    closeModal();
  }
}

function renderProjectDetail(data, projectName) {
  resetTtsPlayer();
  if (driveAudioElement) {
    driveAudioElement.pause();
    driveAudioElement.src = "";
  }

  const images = data.mangaImages || [];
  const titles = data.titleImages || [];
  modalMangaCount.textContent = images.length;
  modalTitleCount.textContent = titles.length;

  if (images.length >= 8 && data.narrationText) {
    modalStatusBadge.className = "badge badge-success";
    modalStatusBadge.textContent = "✅ 生成完備";
  } else {
    modalStatusBadge.className = "badge badge-warning";
    modalStatusBadge.textContent = `⏳ 生成中 (${images.length}/8コマ)`;
  }

  modalDateBadge.textContent = `総ファイル数: ${data.files.length}`;

  // 0. Google Drive 登録済みナレーション音声のセットアップ
  if (data.hasAudio && data.audioFile) {
    if (modalTabAudioBadge) {
      modalTabAudioBadge.textContent = "MP3完備";
      modalTabAudioBadge.className = "badge badge-success";
      modalTabAudioBadge.classList.remove("hidden");
    }
    if (driveAudioBadge) {
      driveAudioBadge.className = "badge badge-success";
      driveAudioBadge.textContent = "✅ 登録済み (MP3)";
    }
    const sizeMb = data.audioFile.size ? `${(data.audioFile.size / (1024 * 1024)).toFixed(2)} MB` : "";
    if (driveAudioDesc) {
      driveAudioDesc.textContent = `ファイル名: ${data.audioFile.name}${sizeMb ? ` (${sizeMb})` : ""} - Google Driveからストリーミング再生・ダウンロード可能`;
    }
    if (driveAudioDownloadLink) {
      driveAudioDownloadLink.href = data.audioFile.url;
      driveAudioDownloadLink.setAttribute("download", data.audioFile.name || "narration_tts.mp3");
    }
    driveAudioActions?.classList.remove("hidden");
    driveAudioPlayerWrap?.classList.remove("hidden");
    if (driveAudioElement) {
      driveAudioElement.src = data.audioFile.url;
    }
    driveAudioEmptyWrap?.classList.add("hidden");
  } else {
    if (modalTabAudioBadge) {
      modalTabAudioBadge.classList.add("hidden");
    }
    if (driveAudioBadge) {
      driveAudioBadge.className = "badge badge-warning";
      driveAudioBadge.textContent = "⏳ 未生成";
    }
    if (driveAudioDesc) {
      driveAudioDesc.textContent = "この案件フォルダには narration_tts.mp3 がまだ存在しません。";
    }
    driveAudioActions?.classList.add("hidden");
    driveAudioPlayerWrap?.classList.add("hidden");
    driveAudioEmptyWrap?.classList.remove("hidden");
  }

  // 1. 漫画ビューアのセットアップ
  currentMangaIndex = 0;
  setupMangaViewer(images);

  // 2. タイトルカードのセットアップ
  setupTitleCards(titles);

  // 3. ナレーション原稿のセットアップ
  const text = data.narrationText || "";
  narrationTextArea.value = text;
  narrationCharCount.textContent = text.length;
  // 1分350文字換算の所要時間計算
  const seconds = Math.round((text.length / 350) * 60);
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  narrationDurationEst.textContent = `${mins}分${secs.toString().padStart(2, "0")}秒`;

  // 4. メタデータ＆ファイル一覧のセットアップ
  const synopsis = data.metadata?.synopsis || data.titleMetadata?.synopsis || "あらすじ情報なし";
  metaSynopsis.textContent = synopsis;

  metaFileList.innerHTML = data.files.map(f => {
    const sizeStr = f.size ? `${(parseInt(f.size) / (1024*1024)).toFixed(2)} MB` : "-";
    return `
      <div class="meta-file-row">
        <span>📄 ${escapeHtml(f.name)}</span>
        <span style="color:var(--text-muted); font-size:12px;">${sizeStr}</span>
      </div>
    `;
  }).join("");

  // 5. YouTube 元動画情報（youtube.json）のセットアップ
  setupYoutubeInfo(data.youtube);

  // 6. 動画シーン割当スタジオのセットアップ
  setupVideoMapping(data, projectName);
}

function setupMangaViewer(images) {
  if (images.length === 0) {
    mangaCurrentImage.src = "";
    mangaPageIndicator.textContent = "画像がありません";
    mangaFileName.textContent = "-";
    mangaThumbnails.innerHTML = `<span style="font-size:13px; color:var(--text-muted);">生成された漫画コマ画像がまだありません</span>`;
    return;
  }

  mangaThumbnails.innerHTML = images.map((img, idx) => `
    <div class="manga-thumb-item ${idx === 0 ? 'active' : ''}" onclick="selectMangaPage(${idx})">
      <img src="${img.url}" alt="${img.name}" loading="lazy">
    </div>
  `).join("");

  showMangaPage(0);
}

function setupTitleCards(titles) {
  if (titles.length === 0) {
    titleCardsGrid.innerHTML = `<p class="empty-state" style="grid-column:1/-1;">タイトルカード画像はありません。</p>`;
    return;
  }

  titleCardsGrid.innerHTML = titles.map(t => `
    <div class="title-card-item">
      <div class="title-card-img-box">
        <a href="${t.url}" target="_blank" title="クリックしてフルサイズ表示">
          <img src="${t.url}" alt="${escapeHtml(t.name)}" loading="lazy">
        </a>
      </div>
      <div class="title-card-label">${escapeHtml(t.name)}</div>
    </div>
  `).join("");
}

function showMangaPage(index) {
  if (!currentProjectDetail || !currentProjectDetail.mangaImages.length) return;
  const images = currentProjectDetail.mangaImages;
  if (index < 0 || index >= images.length) return;

  currentMangaIndex = index;
  const img = images[index];
  mangaCurrentImage.src = img.url;
  mangaPageIndicator.textContent = `${index + 1} / ${images.length} コマ目`;
  mangaFileName.textContent = img.name;

  // サムネイルのアクティブ更新
  const thumbs = mangaThumbnails.querySelectorAll(".manga-thumb-item");
  thumbs.forEach((t, i) => t.classList.toggle("active", i === index));
}

function prevMangaPage() {
  if (currentMangaIndex > 0) {
    showMangaPage(currentMangaIndex - 1);
  }
}

function nextMangaPage() {
  if (currentProjectDetail && currentMangaIndex < currentProjectDetail.mangaImages.length - 1) {
    showMangaPage(currentMangaIndex + 1);
  }
}

window.selectMangaPage = function(index) {
  showMangaPage(index);
};

function closeModal() {
  resetTtsPlayer();
  if (driveAudioElement) {
    driveAudioElement.pause();
    driveAudioElement.src = "";
  }
  if (currentVideoAudio) {
    currentVideoAudio.pause();
    currentVideoAudio.src = "";
  }
  if (videoAudioPlayIcon) {
    videoAudioPlayIcon.textContent = "▶️";
  }
  modalYoutubeBadge.classList.add("hidden");
  modalYoutubeLink.classList.add("hidden");
  narrationYoutubeSource.classList.add("hidden");
  metaYoutubeSection.classList.add("hidden");
  projectModal.classList.add("hidden");
  currentProjectDetail = null;
}

// ----------------------------------------------------
// YouTube 元動画情報（youtube.json）のセットアップ
// ----------------------------------------------------
function setupYoutubeInfo(yt) {
  if (!yt || !yt.url) {
    modalYoutubeBadge.classList.add("hidden");
    modalYoutubeLink.classList.add("hidden");
    narrationYoutubeSource.classList.add("hidden");
    metaYoutubeSection.classList.add("hidden");
    return;
  }

  // 1. モーダルヘッダーバッジ
  modalYoutubeBadge.href = yt.url;
  modalYoutubeBadge.textContent = `▶️ 元動画: ${yt.channel_name || "YouTube"}`;
  modalYoutubeBadge.classList.remove("hidden");

  // 2. モーダルフッターボタン
  modalYoutubeLink.href = yt.url;
  modalYoutubeLink.classList.remove("hidden");

  // 3. ナレーション原稿タブのクイックバー
  narrationYoutubeLink.href = yt.url;
  narrationYoutubeLink.textContent = yt.title || "元動画を開く";
  narrationYoutubeMeta.textContent = `チャンネル: ${yt.channel_name || "-"} | 動画尺: ${formatDuration(yt.video_length)} | 再生数: ${formatViews(yt.view_count)}`;
  narrationYoutubeBtn.href = yt.url;
  narrationYoutubeSource.classList.remove("hidden");

  // 4. メタデータタブのYouTube詳細カード
  const thumbUrl = yt.video_id ? `https://img.youtube.com/vi/${yt.video_id}/mqdefault.jpg` : "";
  ytCardThumb.src = thumbUrl;
  ytCardPlayOverlay.href = yt.url;
  ytCardTitle.href = yt.url;
  ytCardTitle.textContent = yt.title || "元動画タイトルなし";
  ytCardChannel.textContent = yt.channel_name || "-";
  ytCardPublish.textContent = yt.publish_date || "-";
  ytCardDuration.textContent = formatDuration(yt.video_length);
  ytCardViews.textContent = formatViews(yt.view_count);
  ytCardLinkBtn.href = yt.url;
  metaYoutubeSection.classList.remove("hidden");
}

// ----------------------------------------------------
// 音声合成（TTS）プレビュー制御
// ----------------------------------------------------
function resetTtsPlayer() {
  // 再生停止
  stopTts();

  // Blob URL解放
  if (currentTtsAudioBlobUrl) {
    URL.revokeObjectURL(currentTtsAudioBlobUrl);
    currentTtsAudioBlobUrl = null;
  }
  currentTtsAudioBlob = null;

  // プレイヤー非表示
  ttsAudioElement.removeAttribute("src");
  ttsPlayerBox.classList.add("hidden");
  ttsDownloadBtn.classList.add("hidden");
  ttsStopBtn.classList.add("hidden");

  // ボタンローディング解除
  ttsGenerateBtn.disabled = false;
  ttsBtnIcon.textContent = "▶️";
  ttsBtnText.textContent = "AI音声プレビュー生成";
  ttsBrowserPlayBtn.disabled = false;

  // ステータスメッセージ非表示
  ttsStatusMsg.className = "tts-status-msg hidden";
  ttsStatusMsg.textContent = "";
}

function updateVoiceSelectOptions() {
  if (!ttsVoiceSelect) return;
  const engine = ttsEngineSelect ? ttsEngineSelect.value : "irodori";
  const voices = TTS_VOICES_BY_ENGINE[engine] || TTS_VOICES_BY_ENGINE.irodori;
  ttsVoiceSelect.innerHTML = voices.map((v, idx) => `
    <option value="${v.id}" ${idx === 0 ? "selected" : ""}>${escapeHtml(v.name)}</option>
  `).join("");

  // ボタンの表記を微調整
  if (ttsBtnText) {
    if (engine === "irodori") {
      ttsBtnText.textContent = "AI音声プレビュー生成（選択または冒頭）";
    } else {
      ttsBtnText.textContent = "AI音声プレビュー生成（全文）";
    }
  }
}

function showTtsStatus(message, type = "info") {
  ttsStatusMsg.className = `tts-status-msg ${type}`;
  ttsStatusMsg.textContent = message;
  ttsStatusMsg.classList.remove("hidden");
}

function hideTtsStatus() {
  ttsStatusMsg.className = "tts-status-msg hidden";
  ttsStatusMsg.textContent = "";
}

async function generateAiTts() {
  const fullText = narrationTextArea.value ? narrationTextArea.value.trim() : "";
  if (!fullText) {
    alert("ナレーション原稿がありません。");
    return;
  }

  // 1. テキストエリアで選択（ハイライト）されている範囲があるか確認
  const selStart = narrationTextArea.selectionStart;
  const selEnd = narrationTextArea.selectionEnd;
  let textToSynthesize = fullText;
  let isSelected = false;

  if (selStart !== undefined && selEnd !== undefined && selEnd > selStart) {
    const selected = narrationTextArea.value.substring(selStart, selEnd).trim();
    if (selected.length > 0) {
      textToSynthesize = selected;
      isSelected = true;
    }
  }

  // 既存の再生を停止
  stopTts();
  hideTtsStatus();

  const engine = ttsEngineSelect ? ttsEngineSelect.value : "irodori";
  const voice = ttsVoiceSelect.value;
  const speed = parseFloat(ttsSpeedSelect.value) || 1.0;

  // Irodori-TTS の場合、長文（120文字超）は句点で安全に冒頭文を切り出す
  let isTrimmedForIrodori = false;
  if (engine === "irodori" && textToSynthesize.length > 120) {
    const sentences = textToSynthesize.split(/(?<=[。！？\n])/);
    let chunk = "";
    for (const s of sentences) {
      if ((chunk + s).length <= 100) {
        chunk += s;
      } else {
        break;
      }
    }
    if (chunk && chunk.length >= 15) {
      textToSynthesize = chunk.trim();
    } else {
      textToSynthesize = textToSynthesize.slice(0, 90).replace(/[、\s]+$/, "") + "。";
    }
    isTrimmedForIrodori = true;
  }

  // ボタンをローディング表示に
  ttsGenerateBtn.disabled = true;
  ttsBtnIcon.textContent = "⏳";
  ttsBtnText.textContent = "AI音声生成中...";

  if (engine === "irodori") {
    if (isSelected) {
      showTtsStatus(`🌸 選択した文章（${textToSynthesize.length}文字）を Irodori-TTS (GPU) で生成しています...`, "info");
    } else {
      showTtsStatus(`🌸 冒頭の文章（${textToSynthesize.length}文字）を Irodori-TTS (GPU) で高音質生成しています...（初回は約10〜15秒）`, "info");
    }
  } else {
    showTtsStatus("⚡ Microsoft Edge TTS で高品質AI音声を生成しています...", "info");
  }

  try {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ engine, text: textToSynthesize, voice, speed })
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || "音声の生成に失敗しました");
    }

    // Base64からBlob URLを作成
    const byteCharacters = atob(data.audioBase64);
    const byteNumbers = new Uint8Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const blob = new Blob([byteNumbers], { type: data.mimeType || "audio/mp3" });
    currentTtsAudioBlob = blob;

    if (currentTtsAudioBlobUrl) {
      URL.revokeObjectURL(currentTtsAudioBlobUrl);
    }
    currentTtsAudioBlobUrl = URL.createObjectURL(blob);

    // オーディオプレイヤーに設定して再生
    ttsAudioElement.src = currentTtsAudioBlobUrl;
    ttsPlayerBox.classList.remove("hidden");
    ttsDownloadBtn.classList.remove("hidden");
    ttsStopBtn.classList.remove("hidden");

    if (engine === "irodori") {
      const scopeLabel = isSelected ? "選択部分" : "冒頭部分";
      showTtsStatus(`✅ 🌸 Irodori-TTS の音声生成が完了しました（${scopeLabel}・${data.charCount || textToSynthesize.length}文字）。自動再生を開始します。`, "success");
    } else {
      showTtsStatus(`✅ ⚡ Edge TTS の音声生成が完了しました！自動再生を開始します。`, "success");
    }

    await ttsAudioElement.play();
  } catch (err) {
    console.error("TTS生成エラー:", err);
    showTtsStatus(`❌ 音声生成エラー: ${err.message}`, "error");
  } finally {
    ttsGenerateBtn.disabled = false;
    ttsBtnIcon.textContent = "▶️";
    if (engine === "irodori") {
      ttsBtnText.textContent = "AI音声プレビュー生成（選択または冒頭）";
    } else {
      ttsBtnText.textContent = "AI音声プレビュー生成（全文）";
    }
  }
}

function playBrowserSpeech() {
  const fullText = narrationTextArea.value ? narrationTextArea.value.trim() : "";
  if (!fullText) {
    alert("ナレーション原稿がありません。");
    return;
  }

  // 選択範囲があればそれを優先
  const selStart = narrationTextArea.selectionStart;
  const selEnd = narrationTextArea.selectionEnd;
  let text = fullText;
  if (selStart !== undefined && selEnd !== undefined && selEnd > selStart) {
    const selected = narrationTextArea.value.substring(selStart, selEnd).trim();
    if (selected.length > 0) text = selected;
  }

  if (!("speechSynthesis" in window)) {
    alert("お使いのブラウザはWeb Speech APIに対応していません。AI音声生成をご利用ください。");
    return;
  }

  stopTts();
  hideTtsStatus();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "ja-JP";
  utterance.rate = parseFloat(ttsSpeedSelect.value) || 1.0;

  // 日本語ボイスを探す
  const voices = window.speechSynthesis.getVoices();
  const jaVoice = voices.find(v => v.lang === "ja-JP" || v.lang === "ja_JP");
  if (jaVoice) {
    utterance.voice = jaVoice;
  }

  utterance.onstart = () => {
    ttsStopBtn.classList.remove("hidden");
    showTtsStatus("⚡ ブラウザ標準音声で即時プレビュー再生中...", "info");
  };

  utterance.onend = () => {
    ttsStopBtn.classList.add("hidden");
    hideTtsStatus();
  };

  utterance.onerror = (e) => {
    console.error("SpeechSynthesis error:", e);
    ttsStopBtn.classList.add("hidden");
    showTtsStatus("ブラウザ音声の再生が終了または中断されました", "info");
  };

  window.speechSynthesis.speak(utterance);
}

function stopTts() {
  if (window.speechSynthesis && window.speechSynthesis.speaking) {
    window.speechSynthesis.cancel();
  }
  if (ttsAudioElement) {
    ttsAudioElement.pause();
    ttsAudioElement.currentTime = 0;
  }
  ttsStopBtn.classList.add("hidden");
  hideTtsStatus();
}

function downloadTtsMp3() {
  if (!currentTtsAudioBlobUrl) {
    alert("ダウンロード可能な音声データがありません。先にAI音声を生成してください。");
    return;
  }

  const projTitle = (modalTitle.textContent || "narration").replace(/[\\/:*?"<>|]/g, "_").trim();
  const engineTag = ttsEngineSelect && ttsEngineSelect.value === "irodori" ? "irodori" : "edge";
  const filename = `${projTitle}_${engineTag}_tts.mp3`;

  const a = document.createElement("a");
  a.href = currentTtsAudioBlobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ----------------------------------------------------
// ユーティリティ
// ----------------------------------------------------
function formatProjectTitle(name) {
  // 例: "20261011_FXで稼ぐ波の原理原則と損小利大_水島翔"
  const parts = name.split("_");
  if (parts.length >= 3) {
    const title = parts.slice(1, -1).join("_");
    const author = parts[parts.length - 1];
    return `[${author}] ${title}`;
  }
  return name;
}

function formatDate(isoStr) {
  if (!isoStr) return "-";
  try {
    const d = new Date(isoStr);
    return `${d.getFullYear()}/${(d.getMonth()+1).toString().padStart(2, "0")}/${d.getDate().toString().padStart(2, "0")} ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  } catch (e) {
    return isoStr;
  }
}

function escapeHtml(str) {
  if (!str) return "";
  return str.replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[m]);
}

function formatDuration(iso) {
  if (!iso) return "-";
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return iso;
  const hours = m[1] ? `${parseInt(m[1])}時間` : "";
  const mins = m[2] ? `${parseInt(m[2])}分` : (hours ? "00分" : "0分");
  const secs = m[3] ? `${m[3].padStart(2, "0")}秒` : "00秒";
  return `${hours}${mins}${secs}`;
}

function formatViews(count) {
  if (count === undefined || count === null) return "-";
  const n = Number(count);
  if (isNaN(n)) return String(count);
  return `${n.toLocaleString("ja-JP")} 回`;
}

// ----------------------------------------------------
// 🎬 動画シーン割当スタジオ（タイムライン編集）
// ----------------------------------------------------

/**
 * プロジェクト詳細モーダル表示時に動画シーン割当スタジオを初期化
 */
function setupVideoMapping(data, projectName) {
  if (videoSaveStatus) videoSaveStatus.textContent = "";

  // 1. ナレーション音声の準備
  if (data.hasAudio && data.audioFile) {
    currentVideoAudio.src = data.audioFile.url;
    currentVideoAudio.onloadedmetadata = () => {
      if (currentVideoAudio.duration && !isNaN(currentVideoAudio.duration) && currentVideoAudio.duration > 0) {
        // 保存済みデータがなければ音声実尺を採用
        if (!data.videoMapping || !data.videoMapping.totalDuration) {
          videoStudioTotalDuration = +(currentVideoAudio.duration).toFixed(1);
          applyEqualSplit(false);
          updateTotalDurationDisplay();
          renderVideoScenesUi();
        } else {
          updateTotalDurationDisplay();
        }
      }
    };
  } else {
    // 音声がまだない場合は原稿文字数から推定総尺を算出（1分350文字、最低30秒、既定63秒）
    const text = data.narrationText || "";
    const estSec = text.length > 0 ? Math.max(30, Math.round((text.length / 350) * 60)) : 63;
    videoStudioTotalDuration = estSec;
    currentVideoAudio.removeAttribute("src");
  }

  // 2. 既存の Drive 割当データ（video_mapping.json）の復元または新規9シーン作成
  if (data.videoMapping && Array.isArray(data.videoMapping.scenes) && data.videoMapping.scenes.length === 9) {
    // 既存保存データを復元
    currentScenes = JSON.parse(JSON.stringify(data.videoMapping.scenes));
    if (data.videoMapping.totalDuration) {
      videoStudioTotalDuration = parseFloat(data.videoMapping.totalDuration) || videoStudioTotalDuration;
    }
    if (data.videoMapping.subtitlesEnabled !== undefined && videoSubtitleEnableChk) {
      videoSubtitleEnableChk.checked = !!data.videoMapping.subtitlesEnabled;
    }
    if (videoMappingStatusBadge) {
      videoMappingStatusBadge.textContent = "✅ Drive保存済み";
      videoMappingStatusBadge.className = "badge badge-success";
    }
    if (modalTabVideoBadge) {
      modalTabVideoBadge.classList.remove("hidden");
    }
  } else {
    // 新規作成：全9シーン（表紙1枚 ＋ 8コマ漫画8枚）
    const fullText = (data.narrationText || "").trim();
    const sentences = fullText
      ? fullText.split(/(?<=[。！？\n])/).map(s => s.trim()).filter(Boolean)
      : [];
    const sceneTexts = splitIntoChunks(sentences, 9);

    currentScenes = [];

    // シーン0: 表紙・タイトルカード
    const titleImg = (data.titleImages && data.titleImages.length > 0) ? data.titleImages[0] : null;
    currentScenes.push({
      index: 0,
      label: "🎨 表紙・タイトルカード",
      type: "title",
      imageFileId: titleImg ? titleImg.id : "",
      imageFileName: titleImg ? titleImg.name : "00_title.jpg",
      imageUrl: titleImg ? titleImg.url : "",
      clipFileId: "",
      clipFileName: "",
      startSec: 0,
      endSec: 0,
      durationSec: 0,
      transition: "zoom_in",
      subtitleText: sceneTexts[0] || (titleImg ? (data.metadata?.synopsis ? data.metadata.synopsis.slice(0, 40) : "") : "")
    });

    // シーン1〜8: 1コマ目〜8コマ目
    for (let i = 1; i <= 8; i++) {
      const mangaImg = (data.mangaImages && data.mangaImages[i - 1]) ? data.mangaImages[i - 1] : null;
      currentScenes.push({
        index: i,
        label: `🖼️ 第${i}コマ`,
        type: "manga",
        imageFileId: mangaImg ? mangaImg.id : "",
        imageFileName: mangaImg ? mangaImg.name : `manga_0${i}.jpg`,
        imageUrl: mangaImg ? mangaImg.url : "",
        clipFileId: "",
        clipFileName: "",
        startSec: 0,
        endSec: 0,
        durationSec: 0,
        transition: (i % 2 === 0) ? "zoom_out" : "zoom_in",
        subtitleText: sceneTexts[i] || ""
      });
    }

    // 初期の自動均等割り（9分割）を適用
    applyEqualSplit(false);

    if (videoMappingStatusBadge) {
      videoMappingStatusBadge.textContent = "未保存";
      videoMappingStatusBadge.className = "badge badge-subtle";
    }
    if (modalTabVideoBadge) {
      modalTabVideoBadge.classList.add("hidden");
    }
  }

  updateTotalDurationDisplay();
  renderVideoScenesUi();
  updateSubtitleVisibility();
}

/**
 * テキスト文配列を N 個のチャンクに均等配分する
 */
function splitIntoChunks(sentences, n) {
  const result = Array.from({ length: n }, () => "");
  if (!sentences || sentences.length === 0) return result;

  const chunkSize = Math.max(1, Math.ceil(sentences.length / n));
  for (let i = 0; i < n; i++) {
    const start = i * chunkSize;
    const end = Math.min(sentences.length, start + chunkSize);
    if (start < sentences.length) {
      result[i] = sentences.slice(start, end).join(" ");
    }
  }
  return result;
}

/**
 * ⏱️ 秒数の自動均等割り (9分割)
 */
function applyEqualSplit(shouldRender = true) {
  const total = Math.max(9.0, videoStudioTotalDuration);
  const unitSec = +(total / 9).toFixed(1);
  let currentStart = 0.0;

  currentScenes.forEach((scene, idx) => {
    const isLast = (idx === currentScenes.length - 1);
    scene.startSec = +currentStart.toFixed(1);
    if (isLast) {
      scene.endSec = +total.toFixed(1);
      scene.durationSec = +(scene.endSec - scene.startSec).toFixed(1);
    } else {
      scene.durationSec = unitSec;
      scene.endSec = +(currentStart + unitSec).toFixed(1);
      currentStart += unitSec;
    }
  });

  markVideoMappingDirty();
  updateTotalDurationDisplay();
  if (shouldRender) {
    renderVideoScenesUi();
  }
}

/**
 * ⚡ ナレーション原稿の文字数比率で秒数を自動配分
 */
function applyScriptRatioSplit() {
  const total = Math.max(9.0, videoStudioTotalDuration);
  // 各シーンの文字数（最低3文字とみなす）
  const charCounts = currentScenes.map(s => Math.max(3, (s.subtitleText || "").replace(/\s/g, "").length));
  const sumChars = charCounts.reduce((a, b) => a + b, 0);

  let currentStart = 0.0;
  currentScenes.forEach((scene, idx) => {
    const isLast = (idx === currentScenes.length - 1);
    scene.startSec = +currentStart.toFixed(1);
    if (isLast) {
      scene.endSec = +total.toFixed(1);
      scene.durationSec = +(scene.endSec - scene.startSec).toFixed(1);
    } else {
      // 比率で秒数を算出（最低2.0秒保証）
      const ratio = charCounts[idx] / sumChars;
      const rawSec = Math.max(2.0, +(total * ratio).toFixed(1));
      scene.durationSec = rawSec;
      scene.endSec = +(currentStart + rawSec).toFixed(1);
      currentStart += rawSec;
    }
  });

  // 最終シーンが超過または不足した場合は全体を調整
  const lastEnd = currentScenes[currentScenes.length - 1].endSec;
  if (Math.abs(lastEnd - total) > 0.5) {
    videoStudioTotalDuration = +lastEnd.toFixed(1);
  }

  markVideoMappingDirty();
  updateTotalDurationDisplay();
  renderVideoScenesUi();
}

/**
 * 変更ありマークを付与
 */
function markVideoMappingDirty() {
  if (videoMappingStatusBadge) {
    videoMappingStatusBadge.textContent = "⚠️ 未保存の変更あり";
    videoMappingStatusBadge.className = "badge badge-warning";
  }
}

/**
 * 合計尺表示を更新
 */
function updateTotalDurationDisplay() {
  if (!videoTotalDurationDisplay) return;
  const mins = Math.floor(videoStudioTotalDuration / 60);
  const secs = (videoStudioTotalDuration % 60).toFixed(1);
  videoTotalDurationDisplay.textContent = `${videoStudioTotalDuration.toFixed(1)} 秒 (${mins}分${secs}秒)`;

  if (videoAudioTimeDisplay && currentVideoAudio && currentVideoAudio.duration) {
    videoAudioTimeDisplay.textContent = `${formatSeconds(currentVideoAudio.currentTime)} / ${formatSeconds(currentVideoAudio.duration)}`;
  } else if (videoAudioTimeDisplay) {
    videoAudioTimeDisplay.textContent = `00:00 / ${formatSeconds(videoStudioTotalDuration)}`;
  }
}

/**
 * 全9シーンのUIカードを描画
 */
function renderVideoScenesUi() {
  if (!videoScenesContainer) return;
  videoScenesContainer.innerHTML = "";

  const clips = (currentProjectDetail && currentProjectDetail.videoClips) ? currentProjectDetail.videoClips : [];

  currentScenes.forEach((scene, idx) => {
    const card = document.createElement("div");
    card.className = "video-scene-card";
    card.id = `video-scene-card-${idx}`;
    card.dataset.sceneIndex = idx;

    // サムネイル部分
    const thumbSrc = scene.imageUrl || (scene.imageFileId ? `/api/image/${scene.imageFileId}` : "");
    const thumbHtml = thumbSrc
      ? `<img src="${thumbSrc}" alt="${escapeHtml(scene.label)}" loading="lazy">`
      : `<div style="display:flex; align-items:center; justify-content:center; height:100%; color:#94a3b8; font-size:24px;">🖼️</div>`;

    // 動画クリップ選択肢
    const clipOptions = [
      `<option value="" ${!scene.clipFileId ? "selected" : ""}>🖼️ 静止画（画像演出エフェクト適用）</option>`,
      ...clips.map(c => `
        <option value="${c.id}" ${scene.clipFileId === c.id ? "selected" : ""}>
          🎥 動画: ${escapeHtml(c.name)} ${c.size ? `(${(c.size / (1024*1024)).toFixed(1)}MB)` : ''}
        </option>
      `)
    ].join("");

    // カメラ演出オプション
    const transitions = [
      { id: "zoom_in", label: "🔍 ズームイン（標準）" },
      { id: "zoom_out", label: "🔎 ズームアウト" },
      { id: "pan_left", label: "⬅️ 左へパン" },
      { id: "pan_right", label: "➡️ 右へパン" },
      { id: "fade", label: "✨ フェードイン/アウト" },
      { id: "none", label: "⏹️ 固定（演出なし）" }
    ];
    const transOptions = transitions.map(t => `
      <option value="${t.id}" ${scene.transition === t.id ? "selected" : ""}>${t.label}</option>
    `).join("");

    card.innerHTML = `
      <div class="scene-thumb-col">
        <div class="scene-thumb-wrap" title="クリックしてフル画像を表示">
          ${thumbHtml}
          ${scene.clipFileId ? `<span class="scene-clip-badge">🎥 動画使用</span>` : ''}
        </div>
        <div class="scene-label">${escapeHtml(scene.label)}</div>
      </div>

      <div class="scene-controls-col">
        <!-- 上段：素材選択 ＆ カメラ演出 ＆ 再生ボタン -->
        <div class="scene-controls-grid">
          <div>
            <label class="scene-field-label">🎞️ 使用する素材（静止画 または 動画クリップ）:</label>
            <select class="scene-select scene-clip-select">
              ${clipOptions}
            </select>
          </div>
          <div>
            <label class="scene-field-label">🎥 カメラ・画面演出:</label>
            <select class="scene-select scene-trans-select">
              ${transOptions}
            </select>
          </div>
          <div style="display:flex; align-items:flex-end;">
            <button type="button" class="btn btn-secondary btn-sm scene-play-btn" style="width:100%; font-weight:600;" title="このシーンの開始秒から音声をプレビュー再生します">
              ▶️ このシーンから再生
            </button>
          </div>
        </div>

        <!-- 中段：タイムライン秒数コントロール -->
        <div class="scene-time-row" style="margin-top:10px; display:flex; gap:16px; align-items:center; flex-wrap:wrap; background:#f8fafc; padding:8px 12px; border-radius:6px; border:1px solid #e2e8f0;">
          <div style="font-size:12px; color:var(--text-main);">
            開始: <strong class="scene-start-display" style="color:#2563eb; font-size:13px;">${scene.startSec.toFixed(1)}s</strong>
          </div>
          <div style="font-size:12px; color:var(--text-main);">
            終了: <strong class="scene-end-display" style="color:#2563eb; font-size:13px;">${scene.endSec.toFixed(1)}s</strong>
          </div>
          <div style="display:flex; align-items:center; gap:6px; margin-left:auto;">
            <label class="scene-field-label" style="margin-bottom:0;">長さ（秒）:</label>
            <input type="number" step="0.1" min="0.5" class="scene-duration-input" value="${scene.durationSec.toFixed(1)}" style="width:75px; padding:4px 8px; border:1px solid #cbd5e1; border-radius:4px; font-weight:700; font-size:13px; text-align:right;">
            <span style="font-size:12px; color:var(--text-muted);">秒</span>
          </div>
        </div>

        <!-- 下段：字幕テキスト（オプション） -->
        <div class="scene-subtitle-box" style="margin-top:10px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
            <label class="scene-field-label" style="margin-bottom:0;">💬 ナレーション字幕文（オプション・任意）:</label>
            <span class="scene-sub-chars" style="font-size:11px; color:var(--text-muted);">
              <strong>${(scene.subtitleText || "").length}</strong> 文字
            </span>
          </div>
          <textarea class="scene-sub-textarea" placeholder="このシーンで表示する字幕テキストを入力（空欄でも動画化可能）" rows="2" style="width:100%; padding:6px 10px; border:1px solid #cbd5e1; border-radius:6px; font-size:12px; resize:vertical;">${escapeHtml(scene.subtitleText || "")}</textarea>
        </div>
      </div>
    `;

    // イベントバインド
    const clipSelect = card.querySelector(".scene-clip-select");
    const transSelect = card.querySelector(".scene-trans-select");
    const playBtn = card.querySelector(".scene-play-btn");
    const durInput = card.querySelector(".scene-duration-input");
    const subTextarea = card.querySelector(".scene-sub-textarea");
    const subCharsSpan = card.querySelector(".scene-sub-chars strong");

    clipSelect.addEventListener("change", () => {
      scene.clipFileId = clipSelect.value;
      scene.clipFileName = clipSelect.selectedOptions[0]?.text || "";
      markVideoMappingDirty();
      renderVideoScenesUi();
    });

    transSelect.addEventListener("change", () => {
      scene.transition = transSelect.value;
      markVideoMappingDirty();
    });

    playBtn.addEventListener("click", () => {
      playFromScene(idx);
    });

    durInput.addEventListener("change", () => {
      const newDur = Math.max(0.5, parseFloat(durInput.value) || 1.0);
      scene.durationSec = +newDur.toFixed(1);
      recalculateSceneTimingsFrom(idx);
    });

    subTextarea.addEventListener("input", () => {
      scene.subtitleText = subTextarea.value;
      if (subCharsSpan) subCharsSpan.textContent = subTextarea.value.length;
      markVideoMappingDirty();
    });

    videoScenesContainer.appendChild(card);
  });
}

/**
 * 任意のシーンの長さ変更を受けて以降の開始・終了秒を自動再計算
 */
function recalculateSceneTimingsFrom(fromIndex) {
  for (let i = fromIndex; i < currentScenes.length; i++) {
    const s = currentScenes[i];
    if (i === 0) {
      s.startSec = 0.0;
    } else {
      s.startSec = +currentScenes[i - 1].endSec.toFixed(1);
    }
    s.endSec = +(s.startSec + s.durationSec).toFixed(1);
  }

  videoStudioTotalDuration = +currentScenes[currentScenes.length - 1].endSec.toFixed(1);
  markVideoMappingDirty();
  updateTotalDurationDisplay();

  // カード表示の数値のみを更新（再描画によるフォーカス喪失を防止）
  for (let i = fromIndex; i < currentScenes.length; i++) {
    const card = document.getElementById(`video-scene-card-${i}`);
    if (card) {
      const s = currentScenes[i];
      const startEl = card.querySelector(".scene-start-display");
      const endEl = card.querySelector(".scene-end-display");
      const durInput = card.querySelector(".scene-duration-input");
      if (startEl) startEl.textContent = `${s.startSec.toFixed(1)}s`;
      if (endEl) endEl.textContent = `${s.endSec.toFixed(1)}s`;
      if (durInput && i > fromIndex) durInput.value = s.durationSec.toFixed(1);
    }
  }
}

/**
 * 指定シーンの開始秒から音声プレビュー再生
 */
function playFromScene(index) {
  if (index < 0 || index >= currentScenes.length) return;
  const scene = currentScenes[index];
  if (!currentVideoAudio || !currentVideoAudio.src) {
    alert("ナレーション音声（narration_tts.mp3）がまだ登録されていません。\nナレーションタブから音声を生成するか、Google Driveに音声を配置してください。");
    return;
  }

  currentVideoAudio.currentTime = scene.startSec;
  currentVideoAudio.play().catch(e => console.warn("音声再生エラー:", e));
  if (videoAudioPlayIcon) videoAudioPlayIcon.textContent = "⏸️";
  highlightActiveScene(scene.startSec);
}

/**
 * 音声再生トグル
 */
function toggleVideoAudioPlay() {
  if (!currentVideoAudio || !currentVideoAudio.src) {
    alert("ナレーション音声がまだ登録されていません。");
    return;
  }

  if (currentVideoAudio.paused) {
    currentVideoAudio.play().then(() => {
      if (videoAudioPlayIcon) videoAudioPlayIcon.textContent = "⏸️";
    }).catch(e => alert("再生エラー: " + e.message));
  } else {
    currentVideoAudio.pause();
    if (videoAudioPlayIcon) videoAudioPlayIcon.textContent = "▶️";
  }
}

/**
 * 現在再生中の秒数に該当するシーンカードをハイライト
 */
function highlightActiveScene(currentTime) {
  if (currentTime < 0) {
    document.querySelectorAll(".video-scene-card").forEach(c => c.classList.remove("active-scene"));
    return;
  }

  currentScenes.forEach((s, idx) => {
    const card = document.getElementById(`video-scene-card-${idx}`);
    if (card) {
      const isActive = (currentTime >= s.startSec && currentTime < s.endSec);
      card.classList.toggle("active-scene", isActive);
    }
  });
}

/**
 * 字幕オプションチェックボックスの切り替え時の表示更新
 */
function updateSubtitleVisibility() {
  const isEnabled = videoSubtitleEnableChk ? videoSubtitleEnableChk.checked : true;
  document.querySelectorAll(".scene-subtitle-box").forEach(box => {
    box.style.opacity = isEnabled ? "1.0" : "0.55";
    const textarea = box.querySelector(".scene-sub-textarea");
    if (textarea) {
      textarea.title = isEnabled ? "字幕有効" : "字幕は無効化設定中です（出力から除外されます）";
    }
  });
}

/**
 * 💾 Google Drive に動画割当（video_mapping.json）を保存
 */
async function saveVideoMappingToDrive() {
  if (!currentProjectDetail) return;
  const projectId = currentProjectDetail.id;

  const payload = {
    projectId,
    version: "1.0",
    updatedAt: new Date().toISOString(),
    subtitlesEnabled: videoSubtitleEnableChk ? videoSubtitleEnableChk.checked : true,
    totalDuration: videoStudioTotalDuration,
    scenes: currentScenes.map(s => ({
      index: s.index,
      label: s.label,
      type: s.type,
      imageFileId: s.imageFileId || null,
      imageFileName: s.imageFileName || null,
      clipFileId: s.clipFileId || null,
      clipFileName: s.clipFileName || null,
      startSec: s.startSec,
      endSec: s.endSec,
      durationSec: s.durationSec,
      transition: s.transition,
      subtitleText: (s.subtitleText || "").trim()
    }))
  };

  videoSaveDriveBtn.disabled = true;
  const originalBtnText = videoSaveDriveBtn.innerHTML;
  videoSaveDriveBtn.innerHTML = `⏳ 保存中...`;
  videoSaveStatus.textContent = "Google Drive へ保存しています...";

  try {
    const res = await fetch(`/api/project/${projectId}/video-mapping`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await res.json();
    if (!result.success) throw new Error(result.error || "保存に失敗しました");

    // 保存完了
    currentProjectDetail.videoMapping = payload;
    videoSaveStatus.textContent = `✅ Google Drive に保存しました (${new Date().toLocaleTimeString()})`;
    if (videoMappingStatusBadge) {
      videoMappingStatusBadge.textContent = "✅ Drive保存済み";
      videoMappingStatusBadge.className = "badge badge-success";
    }
    if (modalTabVideoBadge) {
      modalTabVideoBadge.classList.remove("hidden");
    }
    alert("🎉 動画シーン割当設定を Google Drive に保存しました！\n（video_mapping.json が作成・更新されました）");
  } catch (err) {
    console.error("動画割当保存エラー:", err);
    videoSaveStatus.textContent = `❌ 保存エラー: ${err.message}`;
    alert(`保存に失敗しました: ${err.message}`);
  } finally {
    videoSaveDriveBtn.disabled = false;
    videoSaveDriveBtn.innerHTML = originalBtnText;
  }
}

/**
 * 📝 SRT字幕ファイルをダウンロード
 */
function exportSrtFile() {
  const isEnabled = videoSubtitleEnableChk ? videoSubtitleEnableChk.checked : true;
  if (!isEnabled) {
    if (!confirm("字幕オプションが現在OFFになっています。\n字幕を出力しますか？")) {
      return;
    }
  }

  let srtContent = "";
  let counter = 1;

  currentScenes.forEach((s) => {
    const text = (s.subtitleText || "").trim();
    if (text) {
      const startTime = formatSrtTimestamp(s.startSec);
      const endTime = formatSrtTimestamp(s.endSec);
      srtContent += `${counter}\n${startTime} --> ${endTime}\n${text}\n\n`;
      counter++;
    }
  });

  if (!srtContent) {
    alert("出力可能な字幕テキストがありません。各シーンの字幕欄に入力してください。");
    return;
  }

  const projTitle = (modalTitle.textContent || "video").replace(/[\\/:*?"<>|]/g, "_").trim();
  const filename = `${projTitle}_subtitles.srt`;
  const blob = new Blob([srtContent], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * 📋 FFmpeg動画結合コマンドをコピー
 */
function copyFfmpegCommand() {
  const projTitle = (modalTitle.textContent || "output").replace(/[\\/:*?"<>|]/g, "_").trim();
  let cmd = `# YouTube漫画動画 一括生成コマンド (FFmpeg)\n`;
  cmd += `# ナレーション音声と9シーンの画像・動画を合成して一本化します\n\n`;

  // concat用リストファイルの作成例
  cmd += `cat << 'EOF' > list.txt\n`;
  currentScenes.forEach(s => {
    const srcFile = s.clipFileName || s.imageFileName || `scene_${s.index}.jpg`;
    cmd += `file '${srcFile}'\n`;
    cmd += `duration ${s.durationSec.toFixed(2)}\n`;
  });
  cmd += `EOF\n\n`;

  cmd += `# 音声と結合して動画を出力\n`;
  cmd += `ffmpeg -f concat -safe 0 -i list.txt -i narration_tts.mp3 -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "${projTitle}.mp4"\n`;

  navigator.clipboard.writeText(cmd).then(() => {
    alert("📋 FFmpeg動画結合コマンドをクリップボードにコピーしました！\nターミナルに貼り付けて実行できます。");
  }).catch(err => {
    prompt("以下のFFmpegコマンドをコピーしてください:", cmd);
  });
}

/**
 * 秒数を 00:00 形式に変換
 */
function formatSeconds(sec) {
  if (isNaN(sec) || sec < 0) return "00:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

/**
 * 秒数を 00:00:00,000 (SRTタイムスタンプ形式) に変換
 */
function formatSrtTimestamp(sec) {
  if (isNaN(sec) || sec < 0) sec = 0;
  const hours = Math.floor(sec / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  const seconds = Math.floor(sec % 60);
  const millis = Math.floor((sec % 1) * 1000);

  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")},${millis.toString().padStart(3, "0")}`;
}

