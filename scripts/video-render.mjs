import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const run = (command, args, timeout) => {
  const result = spawnSync(command, args, {encoding: 'utf8', timeout, maxBuffer: 1024 * 1024});
  if (result.error || result.status !== 0) throw new Error(`${command}: ${result.error?.message || result.stderr?.slice(-700) || '実行失敗'}`);
  return result.stdout;
};
export function probeMedia(file) {
  return JSON.parse(run('ffprobe', ['-v','error','-show_entries','format=duration:stream=width,height,codec_name,codec_type','-of','json',file], 30000));
}
export function renderPublicVideo(image, audio, output, poster) {
  const duration = Number(probeMedia(audio).format?.duration);
  if (!Number.isFinite(duration) || duration < 0.1 || duration > 7200) throw new Error('音声の長さが不正です');
  if (!fs.existsSync(output)) {
    const temporary = output + '.partial.mp4';
    run('ffmpeg', ['-v','error','-y','-loop','1','-framerate','30','-i',image,'-i',audio,'-map','0:v:0','-map','1:a:0','-t',duration.toFixed(3),'-vf','scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=white,setsar=1,format=yuv420p','-r','30','-c:v','libx264','-preset','ultrafast','-tune','stillimage','-crf','28','-g','1800','-sc_threshold','0','-threads','2','-c:a','aac','-b:a','128k','-movflags','+faststart',temporary], 30 * 60000);
    fs.renameSync(temporary, output);
  }
  const result = probeMedia(output);
  const video = result.streams.find(stream => stream.codec_type === 'video');
  const sound = result.streams.find(stream => stream.codec_type === 'audio');
  if (video?.codec_name !== 'h264' || video.width !== 1080 || video.height !== 1920 || sound?.codec_name !== 'aac' || Math.abs(Number(result.format.duration) - duration) > 0.3) throw new Error('生成動画の映像・音声・時間が一致しません');
  if (fs.statSync(output).size > 25 * 1024 * 1024) throw new Error('動画が公開上限の25MBを超えています');
  if (!fs.existsSync(poster)) run('ffmpeg', ['-v','error','-y','-i',image,'-vf','scale=270:480:force_original_aspect_ratio=decrease,pad=270:480:(ow-iw)/2:(oh-ih)/2:color=white','-frames:v','1','-q:v','3',poster], 30000);
  return {duration: Number(result.format.duration), width: 1080, height: 1920, bytes: fs.statSync(output).size};
}
