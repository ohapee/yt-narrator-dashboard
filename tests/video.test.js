import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {execFileSync} from "node:child_process";
import {buildVideoExport, storedZip} from "../public/video-export.js";

test("export preserves subtitles and camera effects, normalizes media, and renders a playable video", async () => {
  const directory = `/tmp/yt-narrator-render-${Date.now()}`;
  await fs.mkdir(directory);
  const scenes = ["zoom_in", "pan_left", "fade"].map((transition, index) => ({imageFileId: `image${index}`, imageFileName: "image.png", transition, startSec: index * 0.5, endSec: (index + 1) * 0.5, durationSec: 0.5, subtitleText: "テスト字幕"}));
  const result = buildVideoExport(scenes, true, null);
  assert.match(result.script, /zoompan/); assert.match(result.script, /fade=t=in/); assert.match(result.script, /subtitles=subtitles.srt/);
  assert.match(result.subtitles, /00:00:00,500 --> 00:00:01,000/);
  for (const asset of result.assets) execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=blue:s=100x100", "-frames:v", "1", directory + "/" + asset.name]);
  await fs.writeFile(directory + "/render.sh", result.script);
  await fs.writeFile(directory + "/subtitles.srt", result.subtitles);
  execFileSync("bash", [directory + "/render.sh"], {timeout: 120000});
  const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=width,height,codec_name", "-of", "json", directory + "/output.mp4"], {encoding: "utf8"}));
  assert.equal(probe.streams[0].codec_name, "h264"); assert.equal(probe.streams[0].width, 1080); assert.equal(probe.streams[0].height, 1920);
  assert.ok(Math.abs(Number(probe.format.duration) - 1.5) < 0.1);
  assert.doesNotMatch(buildVideoExport(scenes, false, null).script, /subtitles=/);
  const archive = storedZip([{name: "render.sh", data: result.script}, {name: "subtitles.srt", data: result.subtitles}]);
  await fs.writeFile(directory + "/export.zip", new Uint8Array(await archive.arrayBuffer()));
  execFileSync("unzip", ["-t", directory + "/export.zip"]);
});
