import path from 'node:path';

export const MIN_MEDIA_SIZE_BYTES = 5 * 1024 * 1024;

export function meetsMinimumMediaSize(sizeBytes) {
  return Number.isFinite(sizeBytes) && sizeBytes >= MIN_MEDIA_SIZE_BYTES;
}

export function parseMediaName(filename) {
  const base = path.basename(filename, path.extname(filename));
  const normalized = base.replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();
  const episode = normalized.match(/\bS(\d{1,2})E(\d{1,3})\b/i) || normalized.match(/\b(\d{1,2})x(\d{1,3})\b/i);
  const yearMatch = normalized.match(/(?:^|\s|\()(19\d{2}|20\d{2})(?:\)|\s|$)/);
  const cutoff = [episode?.index, yearMatch?.index].filter(Number.isInteger).sort((a, b) => a - b)[0];
  let title = (cutoff === undefined ? normalized : normalized.slice(0, cutoff)).trim();
  title = title.replace(/\s*[-–—]\s*$/, '').trim() || normalized;
  return {
    title,
    year: yearMatch ? Number(yearMatch[1]) : null,
    seasonNumber: episode ? Number(episode[1]) : null,
    episodeNumber: episode ? Number(episode[2]) : null,
    mediaType: episode ? 'episode' : 'movie',
  };
}

export function parseRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return { invalid: true };
  let start;
  let end;
  if (match[1] === '') {
    const suffix = Number(match[2]);
    if (!Number.isFinite(suffix) || suffix <= 0) return { invalid: true };
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) return { invalid: true };
  return { start, end: Math.min(end, size - 1) };
}

export function mimeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ({ '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo', '.mpeg': 'video/mpeg', '.mpg': 'video/mpeg', '.ts': 'video/mp2t', '.m2ts': 'video/mp2t' })[ext] || 'application/octet-stream';
}
