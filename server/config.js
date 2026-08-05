import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const root = path.resolve(import.meta.dirname, '..');
const dataDir = path.resolve(root, process.env.LUMA_DATA_DIR || 'data');

export const config = {
  root,
  dataDir,
  databasePath: path.join(dataDir, 'library.db'),
  imageDir: path.join(dataDir, 'images'),
  name: process.env.LUMA_NAME || 'Home Library',
  port: Number(process.env.LUMA_PORT || 7331),
  host: process.env.LUMA_HOST || '0.0.0.0',
  tmdbApiKey: process.env.TMDB_API_KEY || '',
  ffmpeg: process.env.FFMPEG_PATH || 'ffmpeg',
  ffprobe: process.env.FFPROBE_PATH || 'ffprobe',
  scanExtensions: new Set(['.mp4', '.m4v', '.mkv', '.webm', '.mov', '.avi', '.wmv', '.flv', '.mpeg', '.mpg', '.ts', '.m2ts']),
  home: os.homedir(),
};

export function ensureDataDirs() {
  fs.mkdirSync(config.imageDir, { recursive: true });
}
