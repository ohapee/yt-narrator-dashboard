import test from 'node:test';
import assert from 'node:assert/strict';
import {youtubeUrl,youtubeAppUrl} from '../public/youtube-links.js';
import {publicWatchUrl} from '../public/watch/mobile.js';
const id='ZeUAQ_d57QY',canonical=`https://www.youtube.com/watch?v=${id}`;
test('supported YouTube URL forms normalize to an explicit HTTPS video URL',()=>{
 for(const url of [`https://youtu.be/${id}?t=30`,`https://m.youtube.com/watch?v=${id}&list=abc`,`https://www.youtube.com/shorts/${id}`,`https://youtube.com/live/${id}`,`https://www.youtube-nocookie.com/embed/${id}`])assert.equal(youtubeUrl(url),canonical);
 assert.equal(youtubeUrl({video_id:id}),canonical);
 for(const url of ['javascript:alert(1)',`https://youtube.com.evil.test/watch?v=${id}`,'https://youtube.com/watch?v=invalid','https://example.com/'])assert.equal(youtubeUrl(url),null);
});
test('Android app links include the browser fallback; iOS and desktop use universal HTTPS links',()=>{
 const android=youtubeAppUrl(canonical,'Mozilla Android');assert.match(android,/^intent:\/\/www.youtube.com\/watch\?v=ZeUAQ_d57QY#Intent;/);assert.ok(android.includes('package=com.google.android.youtube;'));assert.ok(android.includes(`S.browser_fallback_url=${encodeURIComponent(canonical)};`));assert.equal(youtubeAppUrl(canonical,'iPhone'),canonical);assert.equal(youtubeAppUrl(null,'Android'),null);
});
test('phone QR URLs use production rather than localhost or LAN-only addresses',()=>{
 const id='a'.repeat(32),production='https://yt-narrator-dashboard.eiichi-okamine.workers.dev';
 for(const origin of ['http://localhost:8792','https://127.0.0.1','https://192.168.1.10','https://[::1]'])assert.equal(publicWatchUrl(id,origin),`${production}/watch/?video=${id}`);
 assert.equal(publicWatchUrl(undefined,'https://videos.example.com'),'https://videos.example.com/watch/');assert.throws(()=>publicWatchUrl('../private'),/公開ID/);
});
