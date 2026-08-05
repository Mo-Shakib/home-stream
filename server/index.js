import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import express from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { z } from 'zod';
import { db, getSetting, setSetting } from './db.js';
import { config } from './config.js';
import { parseRange, mimeFor } from './media-utils.js';
import { scanLibraries, getScanState, scannerEvents, regenerateThumbnail } from './scanner.js';
import { enrichMedia } from './metadata.js';

const app = express();
app.disable('x-powered-by');
app.use(helmet({ hsts: false, contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], imgSrc: ["'self'", 'data:', 'blob:'], mediaSrc: ["'self'", 'blob:'], styleSrc: ["'self'", "'unsafe-inline'"], scriptSrc: ["'self'"], upgradeInsecureRequests: null } }, crossOriginResourcePolicy: { policy: 'same-origin' } }));
app.use(pinoHttp({ autoLogging: process.env.NODE_ENV === 'production' }));
app.use(express.json({ limit: '1mb' }));

function asyncRoute(fn) { return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next); }
function publicMedia(row) {
  if (!row) return null;
  return { ...row, path: undefined, file_key: undefined, genres: JSON.parse(row.genres || '[]'), metadata_locked: Boolean(row.metadata_locked), image: row.poster_path ? `/api/media/${row.id}/image/poster` : `/api/media/${row.id}/image/thumbnail`, backdrop: row.backdrop_path ? `/api/media/${row.id}/image/backdrop` : `/api/media/${row.id}/image/thumbnail`, stream: `/api/media/${row.id}/stream` };
}

app.get('/api/config', (req, res) => {
  const interfaces = Object.values(os.networkInterfaces()).flat().filter((x) => x?.family === 'IPv4' && !x.internal);
  res.json({ name: config.name, port: config.port, tmdbConfigured: Boolean(config.tmdbApiKey), addresses: interfaces.map((x) => `http://${x.address}:${config.port}`), ffmpegAvailable: spawnSync(config.ffmpeg, ['-version'], { stdio: 'ignore' }).status === 0 });
});

app.get('/api/library', (req, res) => {
  const search = String(req.query.search || '').trim();
  const type = String(req.query.type || 'all');
  const sortMap = { title: 'm.sort_title ASC', added: 'm.added_at DESC', year: 'm.year DESC NULLS LAST, m.sort_title', runtime: 'm.runtime_seconds DESC NULLS LAST' };
  const sort = sortMap[String(req.query.sort)] || sortMap.added;
  const where = ['1=1']; const args = [];
  if (search) { where.push('(m.title LIKE ? OR m.show_title LIKE ? OR m.filename LIKE ?)'); args.push(...Array(3).fill(`%${search}%`)); }
  if (type !== 'all') { where.push('m.media_type=?'); args.push(type); }
  const rows = db.prepare(`SELECT m.*,p.position_seconds,p.duration_seconds,p.completed FROM media m LEFT JOIN progress p ON p.media_id=m.id WHERE ${where.join(' AND ')} ORDER BY ${sort}`).all(...args).map(publicMedia);
  const recent = db.prepare('SELECT m.*,p.position_seconds,p.duration_seconds,p.completed FROM media m LEFT JOIN progress p ON p.media_id=m.id ORDER BY m.added_at DESC LIMIT 18').all().map(publicMedia);
  const continueWatching = db.prepare('SELECT m.*,p.position_seconds,p.duration_seconds,p.completed FROM progress p JOIN media m ON m.id=p.media_id WHERE p.position_seconds>15 AND p.completed=0 ORDER BY p.updated_at DESC LIMIT 18').all().map(publicMedia);
  const counts = Object.fromEntries(db.prepare('SELECT media_type,count(*) count FROM media GROUP BY media_type').all().map((r) => [r.media_type, r.count]));
  res.json({ items: rows, recent, continueWatching, counts, total: rows.length });
});

app.get('/api/media/:id', (req, res) => {
  const row = db.prepare('SELECT m.*,p.position_seconds,p.duration_seconds,p.completed FROM media m LEFT JOIN progress p ON p.media_id=m.id WHERE m.id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Media not found' });
  res.json(publicMedia(row));
});

app.get('/api/media/:id/stream', asyncRoute(async (req, res) => {
  const item = db.prepare('SELECT path FROM media WHERE id=?').get(req.params.id);
  if (!item) return res.status(404).end();
  const stat = await fsp.stat(item.path).catch(() => null);
  if (!stat) return res.status(410).json({ error: 'The source file is no longer available. Run a library scan.' });
  const range = parseRange(req.headers.range, stat.size);
  res.set({ 'Accept-Ranges': 'bytes', 'Content-Type': mimeFor(item.path), 'Cache-Control': 'private, max-age=0' });
  if (range?.invalid) return res.status(416).set('Content-Range', `bytes */${stat.size}`).end();
  if (range) {
    res.status(206).set({ 'Content-Range': `bytes ${range.start}-${range.end}/${stat.size}`, 'Content-Length': range.end - range.start + 1 });
    fs.createReadStream(item.path, range).pipe(res);
  } else {
    res.set('Content-Length', stat.size);
    fs.createReadStream(item.path).pipe(res);
  }
}));

app.get('/api/media/:id/image/:kind', (req, res) => {
  const column = { poster: 'poster_path', backdrop: 'backdrop_path', thumbnail: 'thumbnail_path' }[req.params.kind];
  if (!column) return res.status(404).end();
  const row = db.prepare(`SELECT ${column} image FROM media WHERE id=?`).get(req.params.id);
  if (!row?.image || !fs.existsSync(row.image)) return res.status(404).end();
  res.set({ 'Cache-Control': 'public, max-age=86400', 'Content-Type': 'image/jpeg' }).sendFile(path.resolve(row.image));
});

const mediaUpdate = z.object({ title: z.string().trim().min(1).max(200), media_type: z.enum(['movie', 'episode', 'personal', 'tutorial', 'course', 'other']), year: z.number().int().min(1800).max(2200).nullable(), description: z.string().max(10000), genres: z.array(z.string().max(40)).max(20), show_title: z.string().max(200).nullable(), season_number: z.number().int().positive().nullable(), episode_number: z.number().int().positive().nullable() });
app.put('/api/media/:id', (req, res) => {
  const parsed = mediaUpdate.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid metadata', details: z.flattenError(parsed.error) });
  const v = parsed.data;
  const result = db.prepare(`UPDATE media SET title=?,sort_title=?,media_type=?,year=?,description=?,genres=?,show_title=?,season_number=?,episode_number=?,metadata_locked=1,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(v.title, v.title.toLocaleLowerCase(), v.media_type, v.year, v.description, JSON.stringify(v.genres), v.show_title, v.season_number, v.episode_number, req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'Media not found' });
  res.json(publicMedia(db.prepare('SELECT * FROM media WHERE id=?').get(req.params.id)));
});

app.post('/api/media/:id/refresh-metadata', asyncRoute(async (req, res) => {
  db.prepare('UPDATE media SET metadata_locked=0,external_id=NULL WHERE id=?').run(req.params.id);
  const item = await enrichMedia(Number(req.params.id), true);
  res.json({ item: publicMedia(item), matched: Boolean(item) });
}));
app.post('/api/media/:id/thumbnail', asyncRoute(async (req, res) => { const image = await regenerateThumbnail(Number(req.params.id)); res.json({ ok: Boolean(image) }); }));

app.put('/api/media/:id/progress', (req, res) => {
  const parsed = z.object({ position: z.number().nonnegative(), duration: z.number().nonnegative().nullable() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid progress' });
  const { position, duration } = parsed.data; const completed = duration > 0 && position / duration > 0.92 ? 1 : 0;
  db.prepare(`INSERT INTO progress(media_id,position_seconds,duration_seconds,completed,updated_at) VALUES (?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(media_id) DO UPDATE SET position_seconds=excluded.position_seconds,duration_seconds=excluded.duration_seconds,completed=excluded.completed,updated_at=CURRENT_TIMESTAMP`).run(req.params.id, position, duration, completed);
  res.json({ ok: true, completed: Boolean(completed) });
});

app.get('/api/folders', (req, res) => res.json(db.prepare('SELECT *,enabled != 0 enabled FROM folders ORDER BY created_at').all()));
app.post('/api/folders', asyncRoute(async (req, res) => {
  const parsed = z.object({ path: z.string().trim().min(1), label: z.string().trim().max(100).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter a valid folder path.' });
  const folderPath = path.resolve(parsed.data.path.replace(/^~/, config.home));
  const stat = await fsp.stat(folderPath).catch(() => null);
  if (!stat?.isDirectory()) return res.status(400).json({ error: 'That folder does not exist or is not readable.' });
  try { const result = db.prepare('INSERT INTO folders(path,label) VALUES (?,?)').run(folderPath, parsed.data.label || path.basename(folderPath)); res.status(201).json(db.prepare('SELECT * FROM folders WHERE id=?').get(result.lastInsertRowid)); }
  catch (error) { if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'That folder is already in your library.' }); throw error; }
}));
app.delete('/api/folders/:id', (req, res) => { const result = db.prepare('DELETE FROM folders WHERE id=?').run(req.params.id); res.status(result.changes ? 204 : 404).end(); });

app.get('/api/directories', asyncRoute(async (req, res) => {
  const requested = String(req.query.path || config.home);
  const current = path.resolve(requested.replace(/^~/, config.home));
  const entries = await fsp.readdir(current, { withFileTypes: true });
  const directories = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => ({ name: e.name, path: path.join(current, e.name) })).sort((a, b) => a.name.localeCompare(b.name));
  res.json({ current, parent: path.dirname(current) === current ? null : path.dirname(current), directories });
}));

app.post('/api/scan', asyncRoute(async (req, res) => { if (getScanState().running) return res.status(202).json(getScanState()); scanLibraries().catch((error) => req.log.error(error)); res.status(202).json({ running: true }); }));
app.get('/api/scan', (req, res) => res.json(getScanState()));
app.get('/api/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' }); res.flushHeaders();
  const send = (data) => res.write(`event: scan\ndata: ${JSON.stringify(data)}\n\n`); send(getScanState()); scannerEvents.on('progress', send);
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 20000);
  req.on('close', () => { scannerEvents.off('progress', send); clearInterval(heartbeat); });
});

app.get('/api/settings', (req, res) => res.json({ autoScanMinutes: getSetting('autoScanMinutes', 30) }));
app.put('/api/settings', (req, res) => { const parsed = z.object({ autoScanMinutes: z.number().int().min(0).max(1440) }).safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: 'Invalid settings' }); setSetting('autoScanMinutes', parsed.data.autoScanMinutes); scheduleScan(); res.json(parsed.data); });

app.use('/vendor/lucide', express.static(path.join(config.root, 'node_modules', 'lucide', 'dist'), { maxAge: '30d', immutable: true }));
app.use(express.static(path.join(config.root, 'public'), { extensions: ['html'], maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));
app.get('*path', (req, res) => res.sendFile(path.join(config.root, 'public', 'index.html')));
app.use((error, req, res, next) => { req.log.error(error); res.status(error.status || 500).json({ error: error.status ? error.message : 'Something went wrong.' }); });

let scanTimer;
function scheduleScan() { clearInterval(scanTimer); const minutes = getSetting('autoScanMinutes', 30); if (minutes > 0) scanTimer = setInterval(() => scanLibraries().catch(() => {}), minutes * 60000); }
scheduleScan();

const server = app.listen(config.port, config.host, () => {
  console.log(`\n  ${config.name} is ready`);
  console.log(`  Local:   http://localhost:${config.port}`);
  for (const list of Object.values(os.networkInterfaces())) for (const address of list || []) if (address.family === 'IPv4' && !address.internal) console.log(`  Network: http://${address.address}:${config.port}`);
  if (db.prepare('SELECT count(*) count FROM folders').get().count) scanLibraries().catch(() => {});
});

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { db.close(); process.exit(0); }));
