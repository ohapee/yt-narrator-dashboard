import test from "node:test";
import assert from "node:assert/strict";
import { NarrationCoordinator } from "../src/jobs.js";
import { HttpError } from "../src/http.js";

function fixture(execute) {
  const data = new Map();
  const state = {blockConcurrencyWhile: async callback => callback(), storage: {
    get: async key => structuredClone(data.get(key)),
    put: async (key, value) => data.set(key, structuredClone(value)),
    list: async ({prefix}) => new Map([...data].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => [key, structuredClone(value)])),
    setAlarm: async time => { state.alarm = time; }
  }};
  return {data, state, coordinator: new NarrationCoordinator(state, {}, {execute, sync: async () => {}})};
}
const job = index => ({id: String(index).padStart(64, "0"), projectId: `project000${index}`, projectName: `案件${index}`, scriptHash: "abc", settings: {voice: "ja-JP-NanamiNeural", speed: 1.3}});
const send = (coordinator, path, body) => coordinator.fetch(new Request(`https://jobs${path}`, {method: "POST", body: JSON.stringify(body)}));

test("duplicate registrations and a recovered instance do not execute the same completed job twice", async () => {
  let calls = 0;
  const {coordinator, state} = fixture(async () => { calls++; return {fileId: "audio"}; });
  const first = await send(coordinator, "/enqueue", {jobs: [job(1)]});
  assert.equal((await first.json()).queuedCount, 1);
  const duplicate = await send(coordinator, "/enqueue", {jobs: [job(1)]});
  assert.equal((await duplicate.json()).queuedCount, 0);
  await coordinator.alarm();
  const recovered = new NarrationCoordinator(state, {}, {execute: async () => {calls++;}, sync: async () => {}});
  await recovered.alarm();
  assert.equal(calls, 1);
  assert.equal((await recovered.status()).jobs[0].status, "succeeded");
});

test("failed first job is delayed and the following job still runs", async () => {
  const {coordinator} = fixture(async item => {
    if (item.projectId === job(1).projectId) throw new HttpError(502, "TTS timeout");
    return {fileId: "audio"};
  });
  await send(coordinator, "/enqueue", {jobs: [job(1), job(2)]});
  await coordinator.alarm(); await coordinator.alarm();
  const state = await coordinator.status();
  assert.equal(state.jobs.find(item => item.id === job(1).id).status, "retry_wait");
  assert.equal(state.jobs.find(item => item.id === job(2).id).status, "succeeded");
  assert.ok(state.jobs.find(item => item.id === job(1).id).nextRetryAt > Date.now());
});

test("crashed running job is reclaimed only after its lease and exhausted retries require manual action", async () => {
  const {coordinator, data} = fixture(async () => {throw new HttpError(502, "temporary");});
  await send(coordinator, "/enqueue", {jobs: [job(1)]});
  let item = data.get(`job:${job(1).id}`);
  item.status = "running"; item.leaseUntil = Date.now() + 100000;
  await coordinator.alarm();
  assert.equal(item.attempts, 0);
  for (let i = 0; i < 3; i++) {
    item = data.get(`job:${job(1).id}`); item.leaseUntil = 0; item.nextRetryAt = 0;
    await coordinator.alarm();
  }
  assert.equal((await coordinator.status()).jobs[0].status, "failed");
  const retry = await send(coordinator, "/retry", {id: job(1).id});
  assert.equal(retry.status, 200);
  assert.equal((await coordinator.status()).jobs[0].attempts, 0);
});

test("persistent authentication failure pauses the service and login attempts are limited", async () => {
  const {coordinator} = fixture(async () => {throw new HttpError(403, "upstream 403");});
  await send(coordinator, "/enqueue", {jobs: [job(1)]});
  await coordinator.alarm();
  assert.ok((await coordinator.status()).pauseUntil > Date.now());
  for (let i = 0; i < 5; i++) assert.equal((await send(coordinator, "/login", {ip: "hash", valid: false})).status, 200);
  assert.equal((await send(coordinator, "/login", {ip: "hash", valid: false})).status, 429);
});
