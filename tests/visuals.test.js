import test from "node:test";
import assert from "node:assert/strict";
import {deflateSync} from "node:zlib";
import {inspectPng, saveVisual, textHash, VISUAL_PROMPT_VERSION} from "../src/visuals.js";
import {summarizeProjectFiles} from "../src/catalog.js";
import {validateMapping} from "../src/validation.js";

const chunk = (type, data) => {const result = Buffer.alloc(data.length + 12); result.writeUInt32BE(data.length); result.write(type, 4); data.copy(result, 8); return result;};
const header = Buffer.alloc(13); header.writeUInt32BE(1080); header.writeUInt32BE(1920, 4); header[8] = 8; header[9] = 2;
const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.from([0,0,0]))), chunk("IEND", Buffer.alloc(0))]);

test("single page completes the project and supplies the same title thumbnail, preserving legacy completion", () => {
  const files = [{id: "singleimage01", name: "visual_summary.png"}, {name: "visual_done.json"}, {name: "narration_tts.txt"}];
  const project = summarizeProjectFiles({id: "project00001"}, files);
  assert.equal(project.status, "COMPLETED"); assert.equal(project.hasTitle, true); assert.equal(project.thumbnailId, "singleimage01"); assert.equal(project.visualMode, "single_page");
  assert.equal(summarizeProjectFiles({}, files.filter(f => f.name !== "visual_done.json")).status, "PARTIAL");
  const legacy = [...Array.from({length: 8}, (_, i) => ({name: `manga_0${i+1}.jpg`})), {name: "manga_done.json"}, {name: "narration_tts.txt"}];
  assert.equal(summarizeProjectFiles({}, legacy).status, "COMPLETED");
});

test("single-page mapping keeps one full-duration scene and rejects foreign material", () => {
  const body = {projectId: "project00001", totalDuration: 63, subtitlesEnabled: true, scenes: [{imageFileId: "singleimage01", startSec: 0, endSec: 63, durationSec: 63, transition: "none"}]};
  assert.equal(validateMapping(body, body.projectId, [{id: "singleimage01", mimeType: "image/png"}]).scenes.length, 1);
  assert.throws(() => validateMapping(body, body.projectId, []), /素材/);
});

test("PNG gate rejects truncated or non-raster outputs", () => {
  assert.deepEqual(inspectPng(png), {width: 1080, height: 1920, bytes: png.length});
  assert.throws(() => inspectPng(png.subarray(0, png.length - 4)), /破損|完了/);
  assert.throws(() => inspectPng(Buffer.from('<svg width="1024"/>')), /PNG/);
});

test("Shorts uploads require 1080x1920 while native generation may use a larger 9:16 canvas", () => {
  for (const [width, height] of [[1024, 1536], [1920, 1080], [1152, 2048]]) {
    const other = Buffer.from(png); other.writeUInt32BE(width, 16); other.writeUInt32BE(height, 20);
    assert.throws(() => inspectPng(other), /1080×1920/);
    assert.equal(inspectPng(other, {requireShorts: false}).width, width);
  }
});

test("a script change during CLI generation prevents any Drive upload", async t => {
  const methods = [];
  const env = {GOOGLE_CLIENT_ID: "test", GOOGLE_CLIENT_SECRET: "test", GOOGLE_REFRESH_TOKEN: "test", PROJECTS_FOLDER_ID: "projectsroot000"};
  t.mock.method(globalThis, "fetch", async (url, options = {}) => {
    const parsed = new URL(url);
    if (parsed.hostname === "oauth2.googleapis.com") return Response.json({access_token: "fake", expires_in: 3600});
    methods.push(options.method || "GET");
    if (parsed.searchParams.get("alt") === "media") return new Response("new text");
    if (parsed.pathname.endsWith("/project00001")) return Response.json({mimeType: "application/vnd.google-apps.folder", parents: [env.PROJECTS_FOLDER_ID]});
    return Response.json({files: [{id: "script000001", name: "narration_tts.txt"}]});
  });
  await assert.rejects(saveVisual("project00001", {provider: "codex", style: "comic", promptVersion: VISUAL_PROMPT_VERSION, inputHash: await textHash("old text"), imageBase64: png.toString("base64")}, env), /原稿が更新/);
  assert.ok(methods.every(method => method === "GET"));
});
