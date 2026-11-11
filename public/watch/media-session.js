export function installMediaSession({getPlayer, getItem, previous, next, onPlayError, elements}) {
  if (!('mediaSession' in navigator)) return () => {};
  const session = navigator.mediaSession;
  function updatePosition() {
    const player = getPlayer();
    if (session.setPositionState && Number.isFinite(player.duration) && player.duration > 0) {
      try { session.setPositionState({duration: player.duration, playbackRate: player.playbackRate, position: Math.max(0, Math.min(player.duration, player.currentTime))}); } catch (_) {}
    }
  }
  function update() {
    const player = getPlayer(), item = getItem();
    if (!item) return;
    if (typeof MediaMetadata !== 'undefined') {
      try { session.metadata = new MediaMetadata({title: item.title.replace(/^\d{8}_/, '').replaceAll('_', ' '), artist: '漫画と音声の動画ライブラリ', artwork: [{src: new URL(item.posterUrl, location.origin).href, sizes: '270x480', type: 'image/jpeg'}]}); } catch (_) {}
    }
    session.playbackState = player.paused ? 'paused' : 'playing';
    updatePosition();
  }
  const handlers = {
    play: () => { getPlayer().play().catch(onPlayError); },
    pause: () => getPlayer().pause(),
    previoustrack: previous,
    nexttrack: next,
    seekbackward: details => { const player = getPlayer(); player.currentTime = Math.max(0, player.currentTime - (details.seekOffset || 10)); updatePosition(); },
    seekforward: details => { const player = getPlayer(); if (Number.isFinite(player.duration)) player.currentTime = Math.min(player.duration, player.currentTime + (details.seekOffset || 10)); updatePosition(); },
    seekto: details => { const player = getPlayer(); if (Number.isFinite(details.seekTime) && Number.isFinite(player.duration)) player.currentTime = Math.max(0, Math.min(player.duration, details.seekTime)); updatePosition(); }
  };
  for (const [action, handler] of Object.entries(handlers)) { try { session.setActionHandler(action, handler); } catch (_) {} }
  for (const player of elements) {
    for (const name of ['play', 'pause', 'loadedmetadata', 'ratechange']) player.addEventListener(name, () => { if (player === getPlayer()) update(); });
    for (const name of ['timeupdate', 'seeked']) player.addEventListener(name, () => { if (player === getPlayer()) updatePosition(); });
  }
  return update;
}
