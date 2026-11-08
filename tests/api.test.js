import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { requestWithRetry, readJson } from "../src/http.js";

const env = {ADMIN_TOKEN: "test-administrator-secret", PROJECTS_FOLDER_ID: "projectsroot000", GOOGLE_CLIENT_ID: "test", GOOGLE_CLIENT_SECRET: "test", GOOGLE_REFRESH_TOKEN: "test"};
const auth = {Authorization: `Bearer ${env.ADMIN_TOKEN}`};
const request = (path, options = {}) => new Request(`https://app.invalid${path}`, options);

test("API rejects anonymous requests, wrong password, and cross-origin writes", async () => {
  assert.equal((await worker.fetch(request("/api/projects"), env)).status, 401);
  assert.equal((await worker.fetch(request("/api/auth/login", {method: "POST", headers: {"Content-Type": "application/json"}, body: '{"password":"wrong"}'}), env)).status, 401);
  assert.equal((await worker.fetch(request("/api/sync-catalog", {method: "POST", headers: {...auth, Origin: "https://other.invalid"}}), env)).status, 403);
  assert.equal((await worker.fetch(request("/api/sync-catalog", {headers: auth}), env)).status, 405);
});

test("login creates a signed HttpOnly session and logout expires it", async () => {
  const login = await worker.fetch(request("/api/auth/login", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({password: env.ADMIN_TOKEN})}), env);
  assert.equal(login.status, 200);
  assert.match(login.headers.get("Set-Cookie"), /HttpOnly/);
  const cookie = login.headers.get("Set-Cookie").split(";")[0];
  const status = await worker.fetch(request("/api/auth/status", {headers: {Cookie: cookie}}), env);
  assert.equal((await status.json()).authenticated, true);
  const tampered = await worker.fetch(request("/api/auth/status", {headers: {Cookie: cookie + "changed"}}), env);
  assert.equal((await tampered.json()).authenticated, false);
  assert.match((await worker.fetch(request("/api/auth/logout", {method: "POST"}), env)).headers.get("Set-Cookie"), /Max-Age=0/);
});

test("read-only catalog requests do not create files when the catalog is missing", async t => {
  const methods = [];
  t.mock.method(globalThis, "fetch", async (url, options = {}) => {
    if (new URL(url).hostname === "oauth2.googleapis.com") return Response.json({access_token: "fake", expires_in: 3600});
    methods.push(options.method || "GET");
    return Response.json({files: []});
  });
  assert.equal((await worker.fetch(request("/api/projects", {headers: auth}), env)).status, 409);
  assert.ok(methods.every(method => method === "GET"));
});

test("Drive scope validation rejects outside projects and preserves partial audio responses", async t => {
  let range;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const parsed = new URL(url);
    if (parsed.hostname === "oauth2.googleapis.com") return Response.json({access_token: "fake", expires_in: 3600});
    if (parsed.pathname.endsWith("/outside00001")) return Response.json({mimeType: "application/vnd.google-apps.folder", parents: ["elsewhere000"]});
    if (parsed.pathname.endsWith("/project00001")) return Response.json({mimeType: "application/vnd.google-apps.folder", parents: [env.PROJECTS_FOLDER_ID]});
    if (parsed.pathname.endsWith("/audio0000001") && parsed.searchParams.has("fields")) return Response.json({mimeType: "audio/mp3", parents: ["project00001"]});
    if (parsed.searchParams.get("alt") === "media") {
      range = options.headers.Range;
      return new Response(new Uint8Array([1, 2, 3, 4]), {status: 206, headers: {"Content-Range": "bytes 0-3/100", "Content-Length": "4", "Content-Type": "audio/mp3"}});
    }
    throw new Error(`Unexpected URL: ${parsed.pathname}`);
  });
  assert.equal((await worker.fetch(request("/api/project/outside00001", {headers: auth}), env)).status, 403);
  const audio = await worker.fetch(request("/api/audio/audio0000001", {headers: {...auth, Range: "bytes=0-3"}}), env);
  assert.equal(audio.status, 206);
  assert.equal(range, "bytes=0-3");
  assert.equal(audio.headers.get("Content-Range"), "bytes 0-3/100");
  assert.equal((await audio.arrayBuffer()).byteLength, 4);
});

test("invalid scene timing and files from outside the project are rejected", async () => {
  const {validateMapping} = await import("../src/validation.js");
  const scenes = Array.from({length: 9}, (_, index) => ({startSec: index, endSec: index + 1, durationSec: 1, transition: "none", imageFileId: "image0000001"}));
  const body = {projectId: "project00001", totalDuration: 9, subtitlesEnabled: true, scenes};
  assert.throws(() => validateMapping(body, body.projectId, []), /素材/);
  const files = [{id: "image0000001", mimeType: "image/png"}];
  assert.equal(validateMapping(body, body.projectId, files).scenes.length, 9);
  body.scenes[8].durationSec = -7;
  assert.throws(() => validateMapping(body, body.projectId, files), /シーン時間/);
});

test("project file listing reads subsequent pages rather than truncating after 60 files", async t => {
  const {listFolderFiles} = await import("../src/drive.js");
  const pages = [];
  t.mock.method(globalThis, "fetch", async url => {
    const parsed = new URL(url);
    if (parsed.hostname === "oauth2.googleapis.com") return Response.json({access_token: "fake", expires_in: 3600});
    const page = parsed.searchParams.get("pageToken"); pages.push(page);
    return Response.json(page ? {files: [{id: "last-audio", name: "narration_tts.mp3"}]} : {files: Array.from({length: 60}, (_, i) => ({id: `image${i}`})), nextPageToken: "next +/ page"});
  });
  const files = await listFolderFiles("project00001", env);
  assert.equal(files.length, 61);
  assert.equal(files.at(-1).name, "narration_tts.mp3");
  assert.deepEqual(pages, [null, "next +/ page"]);
});

test("only transient requests retry, uploads do not retry implicitly, and oversized JSON is rejected", async () => {
  let count = 0;
  const result = await requestWithRetry("https://test.invalid", {}, {fetcher: async () => ++count === 1 ? new Response("busy", {status: 503}) : new Response("ok"), sleep: async () => {}});
  assert.equal(result.status, 200); assert.equal(count, 2);
  count = 0;
  await requestWithRetry("https://test.invalid", {method: "POST"}, {fetcher: async () => {count++; return new Response("busy", {status: 503});}});
  assert.equal(count, 1);
  await assert.rejects(readJson(request("/api/test", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({text: "x".repeat(50)})}), 10), /大きすぎ/);
});

test("only the visual upload route accepts image-sized JSON, with bounded streaming limits", async () => {
  const options = {method: "POST", headers: {...auth, "Content-Type": "application/json", "Content-Length": "3500000"}, body: "{}"};
  assert.equal((await worker.fetch(request("/api/jobs/retry", options), env)).status, 413);
  // Validation is reached (rather than the generic 256KB gate) for image uploads.
  const tooLarge = {...options, headers: {...options.headers, "Content-Length": String(18 * 1024 * 1024)}};
  assert.equal((await worker.fetch(request("/api/visuals/project00001", tooLarge), env)).status, 413);
  assert.equal((await worker.fetch(request("/api/visuals/project00001", {headers: auth}), env)).status, 405);
});
