import { assertFileAccess, driveFetch } from "./drive.js";
import { HttpError } from "./http.js";

export async function proxyMedia(request, env, type, fileId) {
  const metadata = await assertFileAccess(fileId, env);
  if (!metadata.mimeType?.startsWith(type + "/")) throw new HttpError(400, "ファイル形式が一致しません");
  const range = request.headers.get("Range");
  if (range && !/^bytes=(?:\d+-\d*|-\d+)$/.test(range)) throw new HttpError(400, "単一のバイト範囲を指定してください");
  const response = await driveFetch(`files/${fileId}?alt=media`, env, {headers: range ? {Range: range} : {}});
  const headers = {"Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff"};
  for (const key of ["content-range", "content-length", "etag", "content-type"]) if (response.headers.has(key)) headers[key] = response.headers.get(key);
  if (type !== "image") headers["Accept-Ranges"] = "bytes";
  if (response.status === 416) { await response.body?.cancel(); delete headers["content-length"]; return new Response(null, {status: 416, headers}); }
  if (!response.ok) { await response.body?.cancel(); throw new HttpError(response.status === 404 ? 404 : 502, "素材の取得に失敗しました"); }
  return new Response(response.body, {status: response.status, headers});
}
