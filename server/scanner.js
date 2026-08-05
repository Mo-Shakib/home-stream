import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { EventEmitter } from 'node:events';
import { db } from './db.js';
import { config } from './config.js';
import { meetsMinimumMediaSize, parseMediaName } from './media-utils.js';
import { enrichMedia } from './metadata.js';

const execFileAsync = promisify(execFile);
export const scannerEvents = new EventEmitter();
let activeScan = null;

async function* walk(directory) {
  let dir;
  try { dir = await fsp.opendir(directory); } catch { return; }
  for await (const entry of dir) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(fullPath);
    else if (entry.isFile() && config.scanExtensions.has(path.extname(entry.name).toLowerCase())) yield fullPath;
  }
}

async function probe(filePath) {
  try {
    const { stdout } = await execFileAsync(config.ffprobe, ['-v', 'error', '-show_entries', 'format=duration,format_name:stream=codec_type,codec_name,width,height', '-of', 'json', filePath], { timeout: 30000, maxBuffer: 2_000_000 });
    const parsed = JSON.parse(stdout);
    const video = parsed.streams?.find((s) => s.codec_type === 'video') || {};
    const audio = parsed.streams?.find((s) => s.codec_type === 'audio') || {};
    return { runtime: Number(parsed.format?.duration) || null, width: video.width || null, height: video.height || null, videoCodec: video.codec_name || null, audioCodec: audio.codec_name || null, container: parsed.format?.format_name?.split(',')[0] || null };
  } catch { return {}; }
}

async function thumbnail(mediaId, filePath, duration) {
  const output = path.join(config.imageDir, `${mediaId}-thumb.jpg`);
  const seek = Math.max(1, Math.min(300, (duration || 30) * 0.15));
  try {
    await execFileAsync(config.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-ss', String(seek), '-i', filePath, '-frames:v', '1', '-vf', "scale='min(960,iw)':-2", '-q:v', '3', '-y', output], { timeout: 120000, maxBuffer: 1_000_000 });
    db.prepare('UPDATE media SET thumbnail_path = ?, updated_at=CURRENT_TIMESTAMP WHERE id = ?').run(output, mediaId);
    return output;
  } catch { return null; }
}

const upsert = db.prepare(`
  INSERT INTO media(folder_id,path,relative_path,filename,size,modified_ms,file_key,title,sort_title,media_type,year,season_number,episode_number,show_title,runtime_seconds,width,height,video_codec,audio_codec,container,last_seen_scan)
  VALUES (@folderId,@path,@relativePath,@filename,@size,@modifiedMs,@fileKey,@title,@sortTitle,@mediaType,@year,@seasonNumber,@episodeNumber,@showTitle,@runtime,@width,@height,@videoCodec,@audioCodec,@container,@scanId)
  ON CONFLICT(path) DO UPDATE SET folder_id=excluded.folder_id,relative_path=excluded.relative_path,filename=excluded.filename,size=excluded.size,modified_ms=excluded.modified_ms,file_key=excluded.file_key,runtime_seconds=COALESCE(excluded.runtime_seconds,media.runtime_seconds),width=COALESCE(excluded.width,media.width),height=COALESCE(excluded.height,media.height),video_codec=COALESCE(excluded.video_codec,media.video_codec),audio_codec=COALESCE(excluded.audio_codec,media.audio_codec),container=COALESCE(excluded.container,media.container),last_seen_scan=excluded.last_seen_scan,updated_at=CURRENT_TIMESTAMP
  RETURNING *
`);

export function getScanState() {
  return activeScan ? { running: true, ...activeScan.state } : { running: false };
}

export async function scanLibraries(options = {}) {
  if (activeScan) return activeScan.promise;
  const state = { phase: 'discovering', processed: 0, added: 0, changed: 0, removed: 0, ignored: 0, errors: 0, current: '' };
  const promise = runScan(state, options).finally(() => { activeScan = null; });
  activeScan = { state, promise };
  return promise;
}

async function runScan(state, { enrich = true } = {}) {
  const scanId = crypto.randomUUID();
  const folders = db.prepare('SELECT * FROM folders WHERE enabled=1 ORDER BY id').all();
  const publish = () => scannerEvents.emit('progress', { running: true, ...state });
  publish();
  for (const folder of folders) {
    for await (const filePath of walk(folder.path)) {
      state.current = filePath;
      try {
        const stat = await fsp.stat(filePath);
        if (!meetsMinimumMediaSize(stat.size)) {
          state.ignored++;
          state.processed++;
          if (state.processed % 3 === 0) publish();
          continue;
        }
        const fileKey = `${stat.dev}:${stat.ino}`;
        let existing = db.prepare('SELECT * FROM media WHERE path=?').get(filePath);
        if (!existing) {
          const renamed = db.prepare('SELECT * FROM media WHERE file_key=? AND folder_id=?').get(fileKey, folder.id);
          if (renamed) {
            db.prepare('UPDATE media SET path=?,relative_path=?,filename=?,size=?,modified_ms=?,last_seen_scan=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(filePath, path.relative(folder.path, filePath), path.basename(filePath), stat.size, stat.mtimeMs, scanId, renamed.id);
            existing = { ...renamed, path: filePath };
            state.changed++;
          }
        }
        const needsProbe = !existing || existing.size !== stat.size || existing.modified_ms !== stat.mtimeMs;
        const parsed = parseMediaName(filePath);
        const info = needsProbe ? await probe(filePath) : {};
        const row = upsert.get({ folderId: folder.id, path: filePath, relativePath: path.relative(folder.path, filePath), filename: path.basename(filePath), size: stat.size, modifiedMs: stat.mtimeMs, fileKey, title: existing?.title || parsed.title, sortTitle: existing?.sort_title || parsed.title.toLocaleLowerCase(), mediaType: existing?.media_type || parsed.mediaType, year: existing?.year || parsed.year, seasonNumber: existing?.season_number || parsed.seasonNumber, episodeNumber: existing?.episode_number || parsed.episodeNumber, showTitle: existing?.show_title || (parsed.mediaType === 'episode' ? parsed.title : null), runtime: info.runtime ?? existing?.runtime_seconds ?? null, width: info.width ?? existing?.width ?? null, height: info.height ?? existing?.height ?? null, videoCodec: info.videoCodec ?? existing?.video_codec ?? null, audioCodec: info.audioCodec ?? existing?.audio_codec ?? null, container: info.container ?? existing?.container ?? null, scanId });
        if (!existing) state.added++;
        else if (needsProbe) state.changed++;
        if ((!row.thumbnail_path || needsProbe) && info.runtime) await thumbnail(row.id, filePath, info.runtime);
        if (enrich && !row.metadata_locked && !row.external_id) await enrichMedia(row.id).catch(() => {});
      } catch { state.errors++; }
      state.processed++;
      if (state.processed % 3 === 0) publish();
    }
    db.prepare('UPDATE folders SET last_scan_at=CURRENT_TIMESTAMP WHERE id=?').run(folder.id);
  }
  const stale = db.prepare(`SELECT id,thumbnail_path,poster_path,backdrop_path FROM media WHERE last_seen_scan != ? AND folder_id IN (${folders.map(() => '?').join(',') || 'NULL'})`).all(scanId, ...folders.map((f) => f.id));
  for (const item of stale) {
    for (const image of [item.thumbnail_path, item.poster_path, item.backdrop_path]) if (image?.startsWith(config.imageDir)) fsp.unlink(image).catch(() => {});
    db.prepare('DELETE FROM media WHERE id=?').run(item.id);
  }
  state.removed = stale.length;
  state.phase = 'complete'; state.current = '';
  scannerEvents.emit('progress', { running: false, ...state });
  return state;
}

export async function regenerateThumbnail(mediaId) {
  const item = db.prepare('SELECT * FROM media WHERE id=?').get(mediaId);
  if (!item || !fs.existsSync(item.path)) throw new Error('Media file not found');
  return thumbnail(item.id, item.path, item.runtime_seconds);
}
