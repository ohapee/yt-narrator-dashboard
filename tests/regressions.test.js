import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

function loadFunction(path, name, context) {
  const source = fs.readFileSync(new URL(path, import.meta.url), "utf8");
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1);
  const prefix = source.slice(start - 6, start) === "async " ? "async " : "";
  const end = source.indexOf("\n}", start) + 2;
  vm.createContext(context);
  vm.runInContext(prefix + source.slice(start, end), context);
  return context[name];
}

function splitTimeline(total, texts) {
  const context = {
    videoStudioTotalDuration: total,
    currentScenes: texts.map(subtitleText => ({ subtitleText })),
    markVideoMappingDirty() {}, updateTotalDurationDisplay() {}, renderVideoScenesUi() {}
  };
  loadFunction("../public/app.js", "applyScriptRatioSplit", context)();
  return context;
}

test("nine short scenes fit nine seconds without a negative final scene", () => {
  const result = splitTimeline(9, Array(9).fill("テスト"));
  assert.deepEqual(result.currentScenes.map(s => s.durationSec), Array(9).fill(1));
  assert.equal(result.videoStudioTotalDuration, 9);
});

test("skewed and empty scripts preserve duration, order, and minimum time", () => {
  for (const total of [9, 9.1, 12.3, 17.9, 18, 63, 180.7]) {
    for (const texts of [Array(9).fill(""), ["長".repeat(10000), ...Array(8).fill("短")], [...Array(8).fill("短"), "長".repeat(10000)], Array.from({ length: 9 }, (_, i) => "文".repeat(i * 37))]) {
      const { currentScenes, videoStudioTotalDuration } = splitTimeline(total, texts);
      const totalTicks = Math.round(total * 10);
      assert.equal(currentScenes[0].startSec, 0);
      assert.equal(currentScenes.at(-1).endSec, totalTicks / 10);
      assert.equal(videoStudioTotalDuration, totalTicks / 10);
      assert.equal(currentScenes.reduce((sum, s) => sum + Math.round(s.durationSec * 10), 0), totalTicks);
      currentScenes.forEach((scene, i) => {
        assert.ok(scene.durationSec >= Math.min(20, Math.floor(totalTicks / 9)) / 10);
        assert.ok(scene.endSec > scene.startSec);
        if (i) assert.equal(scene.startSec, currentScenes[i - 1].endSec);
      });
    }
  }
  const proportional = splitTimeline(90, Array.from({length: 9}, (_, i) => "字".repeat((i + 1) * 3)));
  assert.deepEqual(proportional.currentScenes.map(s => s.durationSec), [2, 4, 6, 8, 10, 12, 14, 16, 18]);
  assert.doesNotThrow(() => splitTimeline(9, []));
});

const response = (data, ok = true) => ({ ok, json: async () => data, text: async () => "request failed" });

function loadSearch(context) {
  context.HttpError = class extends Error { constructor(status, message) { super(message); this.status = status; } };
  context.getCatalog ||= async () => null;
  loadFunction("../src/catalog.js", "listProjectFiles", context);
  return loadFunction("../src/narration.js", "findNarrationCandidates", context);
}

function parentIds(query) {
  return [...query.matchAll(/'([^']+)' in parents/g)].map(match => match[1]);
}

test("search reaches folders after 100, skips known audio, and stops at four candidates", async () => {
  let requests = 0;
  const scanned = [];
  const token = "next +/ page";
  const find = loadSearch({
    getCatalog: async () => ({ projects: Array.from({length: 100}, (_, i) => ({id: `done-${i}`, hasAudio: true})) }),
    driveFetch: async endpoint => {
      requests++;
      const url = new URL(endpoint, "https://test.invalid/");
      const query = url.searchParams.get("q");
      if (query.includes("mimeType")) {
        if (!url.searchParams.has("pageToken")) return response({ files: Array.from({length: 100}, (_, i) => ({ id: `done-${i}` })), nextPageToken: token });
        assert.equal(url.searchParams.get("pageToken"), token);
        return response({ files: Array.from({length: 10}, (_, i) => ({ id: `pending-${i}`, name: `案件${i}` })), nextPageToken: "unneeded" });
      }
      const ids = parentIds(query);
      scanned.push(...ids);
      return response({files: ids.map(id => ({id: `text-${id}`, name: "narration_tts.txt", parents: [id]}))});
    }
  });
  assert.deepEqual(Array.from(await find({}, "projects", 4), c => c.projectId), ["pending-0", "pending-1", "pending-2", "pending-3"]);
  assert.equal(requests, 3);
  assert.equal(scanned.length, 10);
});

test("audio on a later file page prevents duplicate narration generation", async () => {
  const find = loadSearch({
    driveFetch: async endpoint => {
      const url = new URL(endpoint, "https://test.invalid/");
      if (url.searchParams.get("q").includes("mimeType")) return response({ files: [{id: "existing-audio"}, {id: "new"}] });
      return url.searchParams.has("pageToken")
        ? response({ files: [{name: "narration.mp3", parents: ["existing-audio"]}] })
        : response({ files: [{id: "old-text", name: "narration_tts.txt", parents: ["existing-audio"]}, {id: "new-text", name: "narration_tts.txt", parents: ["new"]}], nextPageToken: "files-next" });
    }
  });
  assert.deepEqual(Array.from(await find({}, "projects", 4), c => c.scriptId), ["new-text"]);
});

test("empty folder pages continue, while a failed later folder page reports an error", async () => {
  for (const fail of [false, true]) {
    let calls = 0;
    const find = loadSearch({
      driveFetch: async () => ++calls === 1 ? response({ files: [], nextPageToken: "next" }) : response({ files: [] }, !fail)
    });
    if (fail) await assert.rejects(find({}, "projects", 4), /案件フォルダ/);
    else assert.equal((await find({}, "projects", 4)).length, 0);
    assert.equal(calls, 2);
  }
});

test("320 project catalog refresh uses grouped reads, catches new audio without parent changes, and persists status", async () => {
  const folders = Array.from({length: 320}, (_, i) => ({id: `folder-${i}`, name: `案件${i}`, modifiedTime: "unchanged"}));
  const status = {status: "idle", lastRun: "2026-11-08T03:00:00Z", summary: {successCount: 4}};
  let reads = 0;
  let saved;
  const context = {
    console: {log() {}}, lastCronResult: {lastRun: null},
    getProjectsFolderId: async () => "projects",
    getCatalog: async () => ({_fileId: "catalog", narrationStatus: status, projects: folders.map(f => ({...f, hasAudio: false}))}),
    saveCatalog: async (catalog, id) => { saved = catalog; return id; },
    driveFetch: async endpoint => {
      reads++;
      const url = new URL(endpoint, "https://test.invalid/");
      if (url.searchParams.get("q").includes("mimeType")) return response({files: folders});
      return response({files: parentIds(url.searchParams.get("q")).flatMap(id => [
        {id: `text-${id}`, name: "narration_tts.txt", parents: [id]},
        {id: `audio-${id}`, name: "narration_tts.mp3", parents: [id]}
      ])});
    }
  };
  loadFunction("../src/catalog.js", "listProjectFiles", context);
  loadFunction("../src/catalog.js", "summarizeProjectFiles", context);
  const sync = loadFunction("../src/catalog.js", "syncCatalog", context);
  const result = await sync({});
  assert.equal(reads, 14); // フォルダ一覧1回＋25案件単位の13回
  assert.equal(result.totalProjects, 320);
  assert.equal(saved.audioProjects, 320);
  assert.equal(saved.narrationStatus.lastRun, status.lastRun);
});

test("audio pending count includes scripts whose manga is incomplete", async () => {
  const context = {driveFetch: async () => response({files: []}), console: {error() {}}, jobRequest: async () => ({})};
  const status = loadFunction("../src/index.js", "getPipelineStatus", context);
  const result = await status({}, {projects: [{id: "pending", status: "GENERATING", hasNarration: true, hasAudio: false}]});
  assert.equal(result.audio.pendingCount, 1);
  const empty = await status({}, {projects: []});
  assert.equal(empty.audio.status, "IDLE");
  assert.equal(empty.audio.isStopped, false);
});
