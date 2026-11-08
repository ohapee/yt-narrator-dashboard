const text = value => new TextEncoder().encode(value);
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
export function srtTimestamp(seconds) {
  const ms = Math.round(seconds * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
}

export function buildVideoExport(scenes, subtitlesEnabled, audioFile) {
  if (!scenes.length) throw new Error("シーンがありません");
  const assets = [];
  let subtitles = "";
  let subtitleNumber = 0;
  let previousEnd = 0;
  let script = '#!/usr/bin/env bash\nset -euo pipefail\ncd -- "$(dirname -- "$0")"\ncommand -v ffmpeg >/dev/null || { echo "FFmpegをインストールしてください"; exit 1; }\n';
  const clipNames = [];
  scenes.forEach((scene, index) => {
    const duration = Number(scene.durationSec);
    if (!Number.isFinite(duration) || duration < 0.1 || Math.abs(scene.startSec - previousEnd) > 0.11 || Math.abs(scene.endSec - scene.startSec - duration) > 0.11) throw new Error("シーン時間を確認してください");
    previousEnd = scene.endSec;
    const isClip = !!scene.clipFileId;
    const id = isClip ? scene.clipFileId : scene.imageFileId;
    if (!id) throw new Error(`${scene.label || index + 1}の素材がありません`);
    const extension = isClip ? "mp4" : (scene.imageFileName || "").match(/\.(png|jpe?g)$/i)?.[1]?.toLowerCase() || "jpg";
    const name = `scene_${String(index + 1).padStart(2, "0")}.${extension}`;
    assets.push({name, url: `/api/${isClip ? "video" : "image"}/${id}`});
    const frames = Math.max(1, Math.round(duration * 30) - 1);
    let effect = "";
    const zoom = `zoompan=z='1+0.1*on/${frames}':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=1080x1920:fps=30`;
    if (scene.transition === "zoom_in") effect = "," + zoom;
    if (scene.transition === "zoom_out") effect = "," + zoom.replace(`1+0.1*on/${frames}`, `1.1-0.1*on/${frames}`);
    if (["pan_left", "pan_right"].includes(scene.transition)) effect = `,zoompan=z=1.1:x='(iw-iw/zoom)*${scene.transition === "pan_left" ? `(1-on/${frames})` : `on/${frames}` }':y='ih/2-ih/zoom/2':d=1:s=1080x1920:fps=30`;
    if (scene.transition === "fade") {
      const fade = Math.min(0.25, duration / 3);
      effect = `,fade=t=in:st=0:d=${fade.toFixed(3)},fade=t=out:st=${(duration - fade).toFixed(3)}:d=${fade.toFixed(3)}`;
    }
    const filter = `scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30${effect},format=yuv420p`;
    const output = `render_${String(index + 1).padStart(2, "0")}.mp4`;
    clipNames.push(output);
    script += `ffmpeg -hide_banner -loglevel error -y ${isClip ? "-stream_loop -1" : "-loop 1 -framerate 30"} -i ${quote(name)} -t ${duration.toFixed(3)} -vf ${quote(filter)} -an -c:v libx264 -preset fast -crf 20 -pix_fmt yuv420p ${quote(output)}\n`;
    const caption = (scene.subtitleText || "").trim();
    if (subtitlesEnabled && caption) subtitles += `${++subtitleNumber}\n${srtTimestamp(scene.startSec)} --> ${srtTimestamp(scene.endSec)}\n${caption}\n\n`;
  });
  script += "cat > scenes.txt <<'SCENES'\n" + clipNames.map(name => `file '${name}'`).join("\n") + "\nSCENES\n";
  if (audioFile?.url) assets.push({name: "narration.mp3", url: audioFile.url});
  const audio = audioFile?.url ? "-i narration.mp3 -map 0:v:0 -map 1:a:0 -af apad -c:a aac" : "-an";
  const video = subtitles ? "-vf 'subtitles=subtitles.srt:charenc=UTF-8' -c:v libx264 -preset fast -crf 20" : "-c:v copy";
  script += `ffmpeg -hide_banner -loglevel error -y -f concat -safe 0 -i scenes.txt ${audio} ${video} -t ${previousEnd.toFixed(3)} -movflags +faststart output.mp4\nprintf '動画を output.mp4 に保存しました\\n'\n`;
  return {script, subtitles, assets};
}

// 無圧縮ZIP。画像・MP3・MP4は既に圧縮済みなので追加ライブラリを使わない。
export function storedZip(entries) {
  const parts = [], directory = [];
  let offset = 0, centralSize = 0;
  const crc = bytes => {
    let result = 0xffffffff;
    for (const byte of bytes) { result ^= byte; for (let bit = 0; bit < 8; bit++) result = result >>> 1 ^ (result & 1 ? 0xedb88320 : 0); }
    return (result ^ 0xffffffff) >>> 0;
  };
  for (const entry of entries) {
    const name = text(entry.name), data = typeof entry.data === "string" ? text(entry.data) : entry.data;
    const checksum = crc(data);
    const local = new Uint8Array(30 + name.length), view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0x800, true); view.setUint16(12, 0x21, true);
    view.setUint32(14, checksum, true); view.setUint32(18, data.length, true); view.setUint32(22, data.length, true); view.setUint16(26, name.length, true); local.set(name, 30);
    parts.push(local, data);
    const central = new Uint8Array(46 + name.length), cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x800, true); cv.setUint16(14, 0x21, true);
    cv.setUint32(16, checksum, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true); cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true); central.set(name, 46);
    directory.push(central); centralSize += central.length; offset += local.length + data.length;
  }
  const end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true); ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true);
  return new Blob([...parts, ...directory, end], {type: "application/zip"});
}
