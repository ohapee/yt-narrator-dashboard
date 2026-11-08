import { HttpError, requestWithRetry } from "./http.js";

export async function jobRequest(env, path, body) {
  let result;
  if (env.JOB_COORDINATOR_URL) {
    result = await requestWithRetry(env.JOB_COORDINATOR_URL.replace(/\/$/, "") + path, {
      method: body ? "POST" : "GET",
      headers: {Authorization: `Bearer ${env.ADMIN_TOKEN}`, "Content-Type": "application/json"},
      ...(body ? {body: JSON.stringify(body)} : {})
    });
  } else {
    if (!env.JOBS) throw new HttpError(503, "ジョブ保存領域が未設定です");
    result = await env.JOBS.get(env.JOBS.idFromName("narration")).fetch(`https://jobs${path}`, body ? {method: "POST", body: JSON.stringify(body)} : {});
  }
  const data = await result.json();
  if (!result.ok) throw new HttpError(result.status, data.error || "ジョブ操作に失敗しました");
  return data;
}
