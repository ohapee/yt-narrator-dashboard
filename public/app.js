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
