import {youtubeAppUrl} from '../youtube-links.js';
import {drawQr, publicWatchUrl} from './mobile.js';
const $ = id => document.getElementById(id);
const player = $("player");
const libraryMobileUrl = publicWatchUrl(undefined, location.origin);
$("library-mobile-link").href = libraryMobileUrl;
drawQr($("library-qr"), libraryMobileUrl);
$("source-youtube").addEventListener("click", () => player.pause());
const playbackRates = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const playbackRateKey = "yt-narrator.playback-rate";
let playbackRate = 1;
try {
  const saved = Number(localStorage.getItem(playbackRateKey));
  if (playbackRates.includes(saved)) playbackRate = saved;
} catch (_) {}
function applyPlaybackRate() {
  player.defaultPlaybackRate = playbackRate;
  player.playbackRate = playbackRate;
  player.preservesPitch = true;
  $("playback-rate").value = String(playbackRate);
}
$("playback-rate").addEventListener("change", event => {
  const rate = Number(event.target.value);
  if (!playbackRates.includes(rate)) return;
  playbackRate = rate;
  applyPlaybackRate();
  try { localStorage.setItem(playbackRateKey, String(rate)); } catch (_) {}
});
player.addEventListener("loadedmetadata", applyPlaybackRate);
applyPlaybackRate();
let items = [], filtered = [], current = null, selecting = 0;
const title = text => String(text).replace(/^\d{8}_/, "").replaceAll("_", " ");
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
  player.pause(); current = item; player.src = item.videoUrl; player.poster = item.posterUrl;
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
  history.replaceState(null, "", `?video=${encodeURIComponent(item.id)}`); renderList();
  if (play) {
    try { await player.play(); if (generation === selecting) $("message").textContent = "再生中"; }
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
player.addEventListener("ended", () => { if ($("continuous").checked) advance(1); });
player.addEventListener("error", () => { $("message").textContent = "この動画を読み込めませんでした。再読み込みするか、次の動画を選んでください。"; });
$("share").addEventListener("click", async () => { try { await navigator.clipboard.writeText(publicWatchUrl(current.id, location.origin)); $("message").textContent = "リンクをコピーしました。"; } catch (_) { $("message").textContent = "アドレスバーのURLをコピーして共有できます。"; } });
document.addEventListener("keydown", event => { if (["INPUT", "TEXTAREA", "SELECT", "VIDEO"].includes(document.activeElement?.tagName)) return; if (["ArrowLeft", "ArrowRight"].includes(event.key)) { event.preventDefault(); advance(event.key === "ArrowLeft" ? -1 : 1); } });
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
