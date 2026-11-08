import { HttpError } from "./http.js";

export function validateDriveId(id) {
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{10,200}$/.test(id)) throw new HttpError(400, "ファイルIDが不正です");
  return id;
}
export function validateMapping(body, projectId, files) {
  if (!body || typeof body !== "object" || !Array.isArray(body.scenes) || ![1, 9].includes(body.scenes.length) || typeof body.subtitlesEnabled !== "boolean") throw new HttpError(400, "1枚形式または従来の9シーンの設定が必要です");
  if (body.projectId !== projectId || !Number.isFinite(body.totalDuration) || body.totalDuration <= 0 || body.totalDuration > 7200) throw new HttpError(400, "全体尺または案件IDが不正です");
  const fileMap = new Map(files.map(file => [file.id, file]));
  let previousEnd = 0;
  const scenes = body.scenes.map((scene, index) => {
    if (![scene.startSec, scene.endSec, scene.durationSec].every(Number.isFinite) || scene.durationSec < 0.1 || Math.abs(scene.startSec - previousEnd) > 0.11 || Math.abs(scene.endSec - scene.startSec - scene.durationSec) > 0.11) throw new HttpError(400, "シーン時間が連続していません");
    if (!["zoom_in", "zoom_out", "pan_left", "pan_right", "fade", "none"].includes(scene.transition)) throw new HttpError(400, "演出設定が不正です");
    for (const [key, type] of [["imageFileId", "image/"], ["clipFileId", "video/"]]) {
      if (scene[key] && !fileMap.get(scene[key])?.mimeType?.startsWith(type)) throw new HttpError(400, "案件に属する素材を指定してください");
    }
    previousEnd = scene.endSec;
    return {index, type: index === 0 ? "title" : "manga", label: String(scene.label || "").slice(0, 100), imageFileId: scene.imageFileId || null, imageFileName: fileMap.get(scene.imageFileId)?.name || null, clipFileId: scene.clipFileId || null, clipFileName: fileMap.get(scene.clipFileId)?.name || null, startSec: scene.startSec, endSec: scene.endSec, durationSec: scene.durationSec, transition: scene.transition, subtitleText: String(scene.subtitleText || "").slice(0, 4000)};
  });
  if (Math.abs(previousEnd - body.totalDuration) > 0.11) throw new HttpError(400, "全体尺が一致しません");
  return {version: "1.0", projectId, totalDuration: body.totalDuration, subtitlesEnabled: body.subtitlesEnabled, scenes, updatedAt: new Date().toISOString()};
}
