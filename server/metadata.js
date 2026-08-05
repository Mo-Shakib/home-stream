import fsp from 'node:fs/promises';
import path from 'node:path';
import { db } from './db.js';
import { config } from './config.js';

async function downloadImage(url, name) {
  if (!url) return null;
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) return null;
  const target = path.join(config.imageDir, name);
  await fsp.writeFile(target, Buffer.from(await response.arrayBuffer()));
  return target;
}

async function tmdb(item) {
  if (!config.tmdbApiKey) return null;
  const query = encodeURIComponent(item.show_title || item.title);
  const type = item.media_type === 'episode' ? 'tv' : 'movie';
  const params = new URLSearchParams({ api_key: config.tmdbApiKey, query, include_adult: 'false' });
  if (item.year) params.set(type === 'movie' ? 'year' : 'first_air_date_year', String(item.year));
  const response = await fetch(`https://api.themoviedb.org/3/search/${type}?${params}`, { signal: AbortSignal.timeout(12000) });
  if (!response.ok) return null;
  const result = (await response.json()).results?.[0];
  if (!result) return null;
  return { source: 'tmdb', externalId: String(result.id), title: item.media_type === 'episode' ? item.title : (result.title || result.name), showTitle: item.media_type === 'episode' ? result.name : null, year: Number((result.release_date || result.first_air_date || '').slice(0, 4)) || item.year, description: result.overview || '', genres: [], posterUrl: result.poster_path ? `https://image.tmdb.org/t/p/w500${result.poster_path}` : null, backdropUrl: result.backdrop_path ? `https://image.tmdb.org/t/p/w1280${result.backdrop_path}` : null };
}

async function tvmaze(item) {
  if (item.media_type !== 'episode') return null;
  const response = await fetch(`https://api.tvmaze.com/singlesearch/shows?q=${encodeURIComponent(item.show_title || item.title)}`, { signal: AbortSignal.timeout(12000) });
  if (!response.ok) return null;
  const show = await response.json();
  return { source: 'tvmaze', externalId: String(show.id), title: item.title, showTitle: show.name, year: Number(show.premiered?.slice(0, 4)) || item.year, description: (show.summary || '').replace(/<[^>]+>/g, ''), genres: show.genres || [], posterUrl: show.image?.original || show.image?.medium, backdropUrl: null };
}

export async function enrichMedia(mediaId, force = false) {
  const item = db.prepare('SELECT * FROM media WHERE id=?').get(mediaId);
  if (!item || (item.metadata_locked && !force)) return null;
  let match = await tmdb(item).catch(() => null);
  if (!match) match = await tvmaze(item).catch(() => null);
  if (!match) return null;
  const poster = await downloadImage(match.posterUrl, `${item.id}-poster.jpg`).catch(() => null);
  const backdrop = await downloadImage(match.backdropUrl, `${item.id}-backdrop.jpg`).catch(() => null);
  db.prepare(`UPDATE media SET title=?,sort_title=?,show_title=?,year=?,description=?,genres=?,poster_path=COALESCE(?,poster_path),backdrop_path=COALESCE(?,backdrop_path),external_source=?,external_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(match.title, match.title.toLocaleLowerCase(), match.showTitle, match.year, match.description, JSON.stringify(match.genres), poster, backdrop, match.source, match.externalId, item.id);
  return db.prepare('SELECT * FROM media WHERE id=?').get(item.id);
}
