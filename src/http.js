export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; this.publicMessage = message; }
}

export function safeError(error) {
  return String(error?.message || error).replace(/https?:\/\/\S+/g, "[接続先]").slice(0, 500);
}

export async function readJson(request, limit = 262144) {
  if (!request.headers.get("Content-Type")?.includes("application/json")) throw new HttpError(415, "JSONを送信してください");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "JSON本文がありません");
  const chunks = []; let length = 0;
  for (;;) {
    const {value, done} = await reader.read();
    if (done) break;
    length += value.length;
    if (length > limit) { await reader.cancel(); throw new HttpError(413, "リクエストが大きすぎます"); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch (_) { throw new HttpError(400, "JSONの形式が不正です"); }
}

export async function requestWithRetry(url, options = {}, policy = {}) {
  const { timeoutMs = 20000, retries = ["GET", "HEAD"].includes(options.method || "GET") ? 2 : 0, fetcher = fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = policy;
  for (let attempt = 0; ; attempt++) {
    let result;
    try {
      const deadline = AbortSignal.timeout(timeoutMs);
      result = await fetcher(url, { ...options, signal: options.signal ? AbortSignal.any([options.signal, deadline]) : deadline });
      if (![429, 500, 502, 503, 504].includes(result.status) || attempt >= retries) return result;
    } catch (error) {
      if (attempt >= retries || options.signal?.aborted) throw new HttpError(502, "外部サービスへの接続が失敗・タイムアウトしました");
    }
    const retryAfter = Number(result?.headers.get("Retry-After"));
    await result?.body?.cancel();
    await sleep(Math.min(30000, retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt + Math.floor(Math.random() * 250)));
  }
}
