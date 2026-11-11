import {qrcode} from '../vendor/qrcode-generator.mjs';
const productionOrigin = 'https://yt-narrator-dashboard.eiichi-okamine.workers.dev';
export function publicWatchUrl(id, origin = productionOrigin) {
  if (id !== undefined && !/^[a-f0-9]{32}$/.test(id)) throw new Error('公開IDが不正です');
  let base = productionOrigin;
  try {
    const url = new URL(origin);
    const local = /^(localhost|127\.|0\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname) || url.hostname.includes(':') || url.hostname.endsWith('.local');
    if (url.protocol === 'https:' && !local) base = url.origin;
  } catch (_) {}
  return `${base}/watch/${id ? `?video=${id}` : ''}`;
}
export function drawQr(canvas, value) {
  const code = qrcode(0, 'M'); code.addData(value, 'Byte'); code.make();
  const count = code.getModuleCount(), quiet = 4, scale = 5;
  canvas.width = canvas.height = (count + quiet * 2) * scale;
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#000';
  for (let row = 0; row < count; row++) for (let column = 0; column < count; column++) if (code.isDark(row, column)) context.fillRect((column + quiet) * scale, (row + quiet) * scale, scale, scale);
  canvas.dataset.url = value;
}
