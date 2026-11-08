import { executeNarrationJob } from "./narration.js";
import { syncCatalog } from "./catalog.js";
import { safeError } from "./http.js";

const publicJob = job => ({...job, events: job.events || []});
const active = job => ["queued", "running", "retry_wait"].includes(job.status);
const leaseMs = 600000;

/** 全インスタンス共通の永続キュー。生成処理はalarmで実行し、HTTP応答から分離する。 */
export class NarrationCoordinator {
  constructor(state, env, services = {}) { this.state = state; this.env = env; this.execute = services.execute || executeNarrationJob; this.sync = services.sync || syncCatalog; }
  async jobs() { return [...(await this.state.storage.list({prefix: "job:"})).values()]; }
  async status() {
    const jobs = (await this.jobs()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const meta = await this.state.storage.get("meta") || {};
    const nextScheduledAt = new Date((Math.floor(Date.now() / 3600000) + 1) * 3600000).toISOString();
    return {success: true, ...meta, status: jobs.some(job => job.status === "running") ? "running" : jobs.some(job => job.status === "failed") ? "error" : "idle", nextScheduledAt, blockedProjectIds: jobs.filter(job => active(job) || job.status === "failed").map(job => job.projectId), jobs: jobs.slice(0, 200).map(publicJob), counts: Object.fromEntries(["queued", "running", "retry_wait", "succeeded", "failed"].map(status => [status, jobs.filter(job => job.status === status).length]))};
  }
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/status") return Response.json(await this.status());
    if (request.method !== "POST") return Response.json({error: "POST required"}, {status: 405});
    const body = await request.json();
    if (path === "/login") {
      return this.state.blockConcurrencyWhile(async () => {
        const key = `login:${body.ip}`;
        let attempts = await this.state.storage.get(key) || {count: 0, until: Date.now() + 900000};
        if (Date.now() > attempts.until) attempts = {count: 0, until: Date.now() + 900000};
        if (attempts.count >= 5) return Response.json({error: "Too many attempts"}, {status: 429});
        attempts.count = body.valid ? 0 : attempts.count + 1;
        await this.state.storage.put(key, attempts);
        return Response.json({success: true});
      });
    }
    return this.state.blockConcurrencyWhile(async () => {
      if (path === "/discovery-error") {
        const meta = await this.state.storage.get("meta") || {};
        meta.discoveryError = {at: new Date().toISOString(), message: String(body.message).slice(0, 500)};
        await this.state.storage.put("meta", meta);
        return Response.json({success: true});
      }
      if (path === "/enqueue") {
        const accepted = [];
        const current = await this.jobs();
        for (const input of body.jobs || []) {
          if (!/^[a-f0-9]{64}$/.test(input.id)) return Response.json({error: "Invalid job ID"}, {status: 400});
          const duplicate = current.find(job => job.id === input.id || job.projectId === input.projectId && active(job));
          if (duplicate) { accepted.push({id: duplicate.id, status: duplicate.status, duplicate: true}); continue; }
          const now = new Date().toISOString();
          const job = {...input, status: "queued", attempts: 0, nextRetryAt: Date.now(), createdAt: now, events: [{at: now, status: "queued"}]};
          await this.state.storage.put(`job:${job.id}`, job);
          current.push(job);
          accepted.push({id: job.id, status: job.status});
        }
        const meta = await this.state.storage.get("meta") || {};
        meta.lastDiscoveryAt = new Date().toISOString(); meta.discoveryError = null;
        await this.state.storage.put("meta", meta);
        await this.schedule();
        return Response.json({success: true, accepted, queuedCount: accepted.filter(job => !job.duplicate).length});
      }
      if (path === "/retry") {
        const job = /^[a-f0-9]{64}$/.test(body.id || "") ? await this.state.storage.get(`job:${body.id}`) : null;
        if (!job) return Response.json({error: "ジョブが見つかりません"}, {status: 404});
        if (!["failed", "retry_wait"].includes(job.status)) return Response.json({error: "このジョブは再実行できません"}, {status: 409});
        if (body.replacement && body.replacement.id !== job.id) {
          const replacement = body.replacement;
          if (!/^[a-f0-9]{64}$/.test(replacement.id) || replacement.projectId !== job.projectId) return Response.json({error: "再登録内容が不正です"}, {status: 400});
          job.status = "superseded";
          job.events.push({at: new Date().toISOString(), status: "superseded", reason: "script_updated"});
          await this.state.storage.put(`job:${job.id}`, job);
          if (!await this.state.storage.get(`job:${replacement.id}`)) {
            const now = new Date().toISOString();
            await this.state.storage.put(`job:${replacement.id}`, {...replacement, status: "queued", attempts: 0, nextRetryAt: Date.now(), createdAt: now, events: [{at: now, status: "queued"}]});
          }
          await this.schedule();
          return Response.json({success: true, id: replacement.id});
        }
        job.status = "queued"; job.attempts = 0; job.nextRetryAt = Date.now(); job.error = null;
        job.events.push({at: new Date().toISOString(), status: "queued", reason: "manual_retry"});
        await this.state.storage.put(`job:${job.id}`, job);
        await this.schedule();
        return Response.json({success: true});
      }
      return Response.json({error: "Not found"}, {status: 404});
    });
  }
  async schedule() {
    const pending = (await this.jobs()).filter(active);
    if (!pending.length) return;
    const meta = await this.state.storage.get("meta") || {};
    const next = Math.min(...pending.map(job => job.status === "running" ? job.leaseUntil : job.nextRetryAt));
    await this.state.storage.setAlarm(Math.max(Date.now() + 1000, next, meta.pauseUntil || 0));
  }
  async alarm() {
    const now = Date.now();
    const meta = await this.state.storage.get("meta") || {};
    if (meta.pauseUntil > now) { await this.schedule(); return; }
    const jobs = await this.jobs();
    // 他リクエストからの登録中でも、実行権の確保は同期した短い区間で行う。
    const job = jobs.filter(job => active(job) && (job.status === "running" ? job.leaseUntil <= now : job.nextRetryAt <= now)).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    if (!job) { await this.schedule(); return; }
    job.status = "running"; job.attempts++; job.startedAt = new Date().toISOString(); job.leaseUntil = now + leaseMs;
    job.events.push({at: job.startedAt, status: "running", attempt: job.attempts});
    await this.state.storage.put(`job:${job.id}`, job);
    await this.state.storage.setAlarm(job.leaseUntil);
    meta.lastStartedAt = job.startedAt;
    await this.state.storage.put("meta", meta);
    try {
      const result = await this.execute(job, this.env);
      job.status = "succeeded"; job.result = result; job.error = null; job.finishedAt = new Date().toISOString();
    } catch (error) {
      job.error = safeError(error); job.errorCode = error.status || 502;
      const permanent = [400, 401, 403, 404, 409, 422].includes(job.errorCode);
      job.status = permanent || job.attempts >= 3 ? "failed" : "retry_wait";
      job.nextRetryAt = Date.now() + [60000, 300000, 1800000][Math.min(job.attempts - 1, 2)];
      if ([401, 403].includes(job.errorCode)) meta.pauseUntil = Date.now() + 900000;
    }
    job.events.push({at: new Date().toISOString(), status: job.status, error: job.error || undefined});
    await this.state.storage.put(`job:${job.id}`, job);
    meta.lastRun = new Date().toISOString(); meta.lastJobId = job.id;
    if (job.status === "succeeded") meta.lastSuccessAt = job.finishedAt;
    if (job.error) meta.lastError = {at: meta.lastRun, jobId: job.id, message: job.error};
    await this.state.storage.put("meta", meta);
    try {
      await this.sync(this.env, {status: job.status === "succeeded" ? "idle" : "error", lastRun: meta.lastRun, summary: {successCount: job.status === "succeeded" ? 1 : 0, errorCount: job.status === "succeeded" ? 0 : 1}, lastJobId: job.id});
      meta.lastCatalogSyncAt = new Date().toISOString(); meta.catalogError = null;
    } catch (error) { meta.catalogError = safeError(error); }
    await this.state.storage.put("meta", meta);
    await this.schedule();
  }
}
