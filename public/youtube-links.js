const videoIdPattern = /^[A-Za-z0-9_-]{11}$/;
export function youtubeVideoId(value) {
  const input = typeof value === 'string' ? value : value?.url;
  if (typeof input === 'string') {
    try {
      const url = new URL(input);
      if (['https:', 'http:'].includes(url.protocol)) {
        const host = url.hostname.toLowerCase(); let id;
        if (host === 'youtu.be') id = url.pathname.split('/')[1];
        else if (['youtube.com','www.youtube.com','m.youtube.com','youtube-nocookie.com','www.youtube-nocookie.com'].includes(host)) {
          if (url.pathname === '/watch') id = url.searchParams.get('v');
          else if (/^\/(shorts|live|embed)\//.test(url.pathname)) id = url.pathname.split('/')[2];
        }
        if (videoIdPattern.test(id || '')) return id;
      }
    } catch (_) {}
  }
  return typeof value?.video_id === 'string' && videoIdPattern.test(value.video_id) ? value.video_id : null;
}
export function youtubeUrl(value) {
  const id = youtubeVideoId(value);
  return id ? `https://www.youtube.com/watch?v=${id}` : null;
}
export function youtubeAppUrl(value, userAgent = '') {
  const normal = youtubeUrl(value);
  if (!normal) return null;
  return /Android/i.test(userAgent)
    ? `intent://www.youtube.com/watch?v=${youtubeVideoId(normal)}#Intent;scheme=https;package=com.google.android.youtube;S.browser_fallback_url=${encodeURIComponent(normal)};end`
    : normal;
}
