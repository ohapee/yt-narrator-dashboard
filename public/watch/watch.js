import {youtubeAppUrl} from '../youtube-links.js';
import {drawQr, publicWatchUrl} from './mobile.js';
import {installMediaSession} from './media-session.js';
const $ = id => document.getElementById(id);
const player = $("player");
const audioPlayer = $("audio-player");
let audioMode = false, preferAudio = false;
try { preferAudio = localStorage.getItem('yt-narrator.audio-mode') === 'true'; } catch (_) {}
const activePlayer = () => audioMode ? audioPlayer : player;
const pendingSeeks = new WeakMap();
function applyMode() {
  player.hidden = audioMode;
  $("audio-artwork").hidden = !audioMode;
  $("audio-panel").hidden = !audioMode;
  $("audio-toggle").checked = audioMode;
}
function restorePosition(media) {
  const position = pendingSeeks.get(media);
  if (position === undefined || !Number.isFinite(media.duration)) return;
  media.currentTime = Math.max(0, Math.min(position, Math.max(0, media.duration - 0.01)));
  pendingSeeks.delete(media);
}
const libraryMobileUrl = publicWatchUrl(undefined, location.origin);
$("library-mobile-link").href = libraryMobileUrl;
drawQr($("library-qr"), libraryMobileUrl);
$("source-youtube").addEventListener("click", () => { player.pause(); audioPlayer.pause(); });
const playbackRates = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const playbackRateKey = "yt-narrator.playback-rate";
let playbackRate = 1;
try {
  const saved = Number(localStorage.getItem(playbackRateKey));
  if (playbackRates.includes(saved)) playbackRate = saved;
} catch (_) {}
function applyPlaybackRate() {
  for (const media of [player, audioPlayer]) { media.defaultPlaybackRate = playbackRate; media.playbackRate = playbackRate; media.preservesPitch = true; }
  $("playback-rate").value = String(playbackRate);
}
$("playback-rate").addEventListener("change", event => {
  const rate = Number(event.target.value);
  if (!playbackRates.includes(rate)) return;
  playbackRate = rate;
  applyPlaybackRate();
  try { localStorage.setItem(playbackRateKey, String(rate)); } catch (_) {}
});
for (const media of [player, audioPlayer]) media.addEventListener("loadedmetadata", () => { applyPlaybackRate(); restorePosition(media); });
applyPlaybackRate();
let items = [], filtered = [], current = null, selecting = 0;
const title = text => String(text).replace(/^\d{8}_/, "").replaceAll("_", " ");
const refreshMediaSession = installMediaSession({getPlayer: activePlayer, getItem: () => current, previous: () => advance(-1), next: () => advance(1), onPlayError: () => { $("message").textContent = "プレイヤーの再生ボタンを押してください。"; }, elements: [player, audioPlayer]});
$("audio-toggle").addEventListener("change", () => {
  if (!current?.audioUrl) return;
  const previous = activePlayer(), position = previous.currentTime || 0, wasPlaying = !previous.paused;
  preferAudio = $("audio-toggle").checked;
  try { localStorage.setItem('yt-narrator.audio-mode', String(preferAudio)); } catch (_) {}
  previous.pause();
  audioMode = preferAudio;
  const media = activePlayer(); media.volume = previous.volume; media.muted = previous.muted;
  pendingSeeks.set(media, position); restorePosition(media); applyMode(); applyPlaybackRate(); refreshMediaSession();
  if (wasPlaying) media.play().catch(() => { $("message").textContent = "音声プレイヤーの再生ボタンを押してください。"; });
});
const duration = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
function updateButtons() {
  const index = filtered.findIndex(item => item.id === current?.id);
  $("previous").disabled = index <= 0 && !$("repeat").checked;
  $("next").disabled = !filtered.length || index === filtered.length - 1 && !$("repeat").checked;
  $("share").disabled = !current;
}
function renderList() {
  const query = $("search").value.trim().toLocaleLowerCase();
  filtered = items.filter(item => title(item.title).toLocaleLowerCase().includes(query));
  $("list").replaceChildren();
  for (const item of filtered) {
    const button = document.createElement("button"); button.className = `card${item.id === current?.id ? " active" : ""}`;
    button.setAttribute("aria-pressed", String(item.id === current?.id)); button.dataset.videoId = item.id;
    const image = document.createElement("img"); image.src = item.posterUrl; image.alt = ""; image.loading = "lazy";
    const body = document.createElement("span"), heading = document.createElement("strong"), detail = document.createElement("small");
    heading.textContent = title(item.title); detail.textContent = `${duration(item.duration)} · 縦型動画`;
    body.append(heading, detail); button.append(image, body); button.addEventListener("click", () => select(item, true)); $("list").append(button);
  }
  $("list-status").textContent = filtered.length ? `${filtered.length}件の動画` : items.length ? "一致する動画がありません" : "";
  updateButtons();
}
async function select(item, play) {
  const generation = ++selecting;
  player.pause(); audioPlayer.pause(); current = item;
  pendingSeeks.delete(player); pendingSeeks.delete(audioPlayer);
  player.src = item.videoUrl; player.poster = item.posterUrl;
  if (item.audioUrl) audioPlayer.src = item.audioUrl; else { audioPlayer.removeAttribute('src'); audioPlayer.load(); }
  $("audio-artwork").src = item.posterUrl;
  $("audio-toggle").disabled = !item.audioUrl;
  audioMode = preferAudio && !!item.audioUrl; applyMode();
  const downloadUrl = new URL(item.videoUrl, location.origin);
  downloadUrl.searchParams.set("download", "1");
  $("download-video").href = downloadUrl.pathname + downloadUrl.search;
  $("download-video").hidden = false;
  applyPlaybackRate();
  const sourceUrl = youtubeAppUrl(item.youtubeUrl, navigator.userAgent);
  $("source-youtube").hidden = !sourceUrl;
  $("source-note").hidden = !sourceUrl;
  if (sourceUrl) $("source-youtube").href = sourceUrl; else $("source-youtube").removeAttribute("href");
  const selectedMobileUrl = publicWatchUrl(item.id, location.origin);
  $("selected-mobile-link").href = selectedMobileUrl;
  drawQr($("selected-qr"), selectedMobileUrl);
  $("selected-mobile").hidden = false;
  $("empty").classList.add("hidden"); $("now-title").textContent = title(item.title); $("message").textContent = "再生ボタンで開始できます。";
  history.replaceState(null, "", `?video=${encodeURIComponent(item.id)}`); renderList(); refreshMediaSession();
  if (play) {
    try { await activePlayer().play(); if (generation === selecting) $("message").textContent = "再生中"; }
    catch (_) { if (generation === selecting) $("message").textContent = "プレイヤーの再生ボタンを押してください。"; }
  }
}
function advance(step) {
  if (!filtered.length) return;
  const index = filtered.findIndex(item => item.id === current?.id);
  let next = index + step;
  if (next < 0 || next >= filtered.length) { if (!$("repeat").checked) return; next = (next + filtered.length) % filtered.length; }
  select(filtered[next], true);
}
$("previous").addEventListener("click", () => advance(-1)); $("next").addEventListener("click", () => advance(1));
$("repeat").addEventListener("change", updateButtons); $("search").addEventListener("input", renderList);
for (const media of [player, audioPlayer]) {
  media.addEventListener("ended", () => { if (media === activePlayer() && $("continuous").checked) advance(1); });
  media.addEventListener("error", () => { if (media === activePlayer()) $("message").textContent = "メディアを読み込めませんでした。再読み込みするか、次の動画を選んでください。"; });
}
$("share").addEventListener("click", async () => { try { await navigator.clipboard.writeText(publicWatchUrl(current.id, location.origin)); $("message").textContent = "リンクをコピーしました。"; } catch (_) { $("message").textContent = "アドレスバーのURLをコピーして共有できます。"; } });
document.addEventListener("keydown", event => { if (["INPUT", "TEXTAREA", "SELECT", "VIDEO", "AUDIO"].includes(document.activeElement?.tagName)) return; if (["ArrowLeft", "ArrowRight"].includes(event.key)) { event.preventDefault(); advance(event.key === "ArrowLeft" ? -1 : 1); } });
try {
  const seen = new Set(); let cursor = "";
  do {
    const response = await fetch(`/watch/data${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, {signal: AbortSignal.timeout(30000)});
    const data = await response.json(); if (!response.ok) throw new Error("load failed");
    items.push(...data.items); cursor = data.cursor || "";
    if (cursor && seen.has(cursor)) throw new Error("invalid cursor"); if (cursor) seen.add(cursor);
  } while (cursor);
  items.sort((a,b) => b.title.localeCompare(a.title, "ja")); $("count").textContent = `${items.length} videos`; renderList();
  const requested = new URLSearchParams(location.search).get("video"); const first = items.find(item => item.id === requested) || items[0];
  if (first) select(first, false); else $("empty").textContent = "動画はまだ公開されていません。";
} catch (_) { $("empty").textContent = "一覧を読み込めませんでした。時間をおいて再読み込みしてください。"; }
