import {assertProjectAccess, listFolderFiles, driveFetch, uploadPngToDrive, saveJsonToFolder} from "./drive.js";
import {HttpError} from "./http.js";

export const VISUAL_PROMPT_VERSION = "single-page-cli-v2-shorts";

export async function textHash(text) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map(n => n.toString(16).padStart(2, "0")).join("");
}

export function inspectPng(bytes, {requireShorts = true} = {}) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!(bytes instanceof Uint8Array) || bytes.length < 57 || bytes.length > 12 * 1024 * 1024 || !signature.every((n, i) => bytes[i] === n)) throw new HttpError(400, "12MB以下のPNG画像が必要です");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16), height = view.getUint32(20);
  if (width < 768 || height < 768 || width * height > 9000000) throw new HttpError(400, "画像の解像度が不正です（各辺768px以上・900万画素以下）");
  if (requireShorts && (width !== 1080 || height !== 1920)) throw new HttpError(400, "YouTube Shorts用の1080×1920px（9:16）の画像が必要です");
  let offset = 8, hasData = false, ended = false;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8));
    if (offset + length + 12 > bytes.length || offset === 8 && (type !== "IHDR" || length !== 13)) throw new HttpError(400, "PNG画像が破損しています");
    if (type === "IDAT" && length > 0) hasData = true;
    offset += length + 12;
    if (type === "IEND") { ended = length === 0 && offset === bytes.length; break; }
  }
  if (!hasData || !ended) throw new HttpError(400, "PNG画像が完了していません");
  return {width, height, bytes: bytes.length};
}

export async function saveVisual(projectId, body, env) {
  await assertProjectAccess(projectId, env);
  if (!["codex", "antigravity"].includes(body.provider) || !["comic", "infographic"].includes(body.style) || body.promptVersion !== VISUAL_PROMPT_VERSION || !/^[a-f0-9]{64}$/.test(body.inputHash || "") || typeof body.imageBase64 !== "string") throw new HttpError(400, "画像生成情報が不正です");
  let bytes;
  try {
    const binary = atob(body.imageBase64);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  }
  catch (_) { throw new HttpError(400, "画像のエンコードが不正です"); }
  const dimensions = inspectPng(bytes);
  const files = await listFolderFiles(projectId, env);
  const script = files.find(file => file.name === "narration_tts.txt");
  if (!script) throw new HttpError(409, "ナレーション原稿がありません");
  const response = await driveFetch(`files/${script.id}?alt=media`, env);
  if (!response.ok) throw new Error("原稿取得失敗");
  const text = await response.text();
  if (await textHash(text) !== body.inputHash) throw new HttpError(409, "生成中に原稿が更新されました。新しい原稿で再生成してください");
  const image = await uploadPngToDrive(projectId, bytes, files.find(f => f.name === "visual_summary.png")?.id, env);
  const metadata = {
    version: 1, mode: "single_page", panels_count: 8, style: body.style, imageFileId: image.id,
    imageFileName: "visual_summary.png", titleImageFileId: image.id, titleReuse: true,
    provider: body.provider, cliVersion: String(body.cliVersion || "unknown").slice(0, 100),
    // CLI内蔵ツールは画像モデル名を返さない場合がある。推論モデルと混同しない。
    reasoningModel: String(body.reasoningModel || "CLI設定に従う").slice(0, 100),
    imageModel: null, imageModelNote: "CLI内蔵画像生成・モデル名は実行結果に非公開",
    inputHash: body.inputHash, promptVersion: VISUAL_PROMPT_VERSION,
    synopsis: String(body.synopsis || "").slice(0, 2000), ...dimensions, aspectRatio: "9:16", processed_at: new Date().toISOString()
  };
  await saveJsonToFolder(projectId, "visual_done.json", metadata, env);
  return {success: true, imageFileId: image.id, metadata};
}
