import { apiFetch } from "./session.js";

const names = {queued: "待機", running: "生成中", retry_wait: "再試行待ち", succeeded: "完了", failed: "失敗", superseded: "原稿更新で置換"};
export async function refreshJobs() {
  const response = await apiFetch("/api/jobs");
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "履歴取得に失敗しました");
  const summary = document.getElementById("jobs-summary");
  const date = value => value ? new Date(value).toLocaleString("ja-JP") : "未実行";
  summary.textContent = `次回定期実行: ${date(data.nextScheduledAt)} ／ 案件検出: ${date(data.lastDiscoveryAt)} ／ 最終開始: ${date(data.lastStartedAt)} ／ 最終成功: ${date(data.lastSuccessAt)} ／ 集計同期: ${date(data.lastCatalogSyncAt)} ／ 待機 ${data.counts.queued}・生成中 ${data.counts.running}・再試行待ち ${data.counts.retry_wait}・失敗 ${data.counts.failed}`;
  const warning = document.getElementById("jobs-warning");
  warning.textContent = data.pauseUntil > Date.now() ? `音声サービスの接続エラーにより ${date(data.pauseUntil)} まで自動実行を休止しています。` : data.catalogError ? `集計更新に失敗: ${data.catalogError}` : "";
  if (data.discoveryError) warning.textContent += ` ${data.discoveryError.message}`;
  if ((data.counts.failed || data.counts.retry_wait) && data.lastError) warning.textContent += ` 最終エラー: ${data.lastError.message}`;
  const container = document.getElementById("job-history");
  container.replaceChildren();
  if (!data.jobs.length) container.textContent = "新しい実行履歴はまだありません。";
  for (const job of data.jobs) {
    const details = document.createElement("details");
    const title = document.createElement("summary");
    title.textContent = `${names[job.status]} ｜ ${job.projectName} ｜ ${job.attempts}回 ｜ ${date(job.finishedAt || job.startedAt || job.createdAt)}`;
    const info = document.createElement("p");
    info.textContent = `Edge TTS / ${job.settings.voice} / ${job.settings.speed}倍速${job.error ? ` ／ ${job.error}` : ""}${job.status === "retry_wait" ? ` ／ 再試行予定: ${date(job.nextRetryAt)}` : ""}`;
    details.append(title, info);
    const events = document.createElement("ol");
    for (const entry of job.events) {
      const item = document.createElement("li");
      item.textContent = `${date(entry.at)} ${names[entry.status]} ${entry.error || ""}`;
      events.append(item);
    }
    details.append(events);
    if (["failed", "retry_wait"].includes(job.status)) {
      const retry = document.createElement("button");
      retry.className = "btn btn-secondary btn-sm";
      retry.textContent = "この案件を再試行";
      retry.addEventListener("click", async () => {
        retry.disabled = true;
        try {
          const response = await apiFetch("/api/jobs/retry", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({id: job.id})});
          const result = await response.json();
          if (!response.ok) throw new Error(result.error);
          await refreshJobs();
        } catch (error) { info.textContent = error.message; retry.disabled = false; }
      });
      details.append(retry);
    }
    container.append(details);
  }
  return data;
}
