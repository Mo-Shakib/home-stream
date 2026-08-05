# Home Library

Home Library is a lightweight, local-first video catalog and streaming server for a trusted home network. It recursively indexes folders on the host machine, extracts technical details with FFmpeg, creates thumbnails, optionally matches online metadata, and serves a responsive, account-free web interface to any device on the same LAN.

## Quick start

Requirements: Node.js 20+ and FFmpeg (`ffmpeg` and `ffprobe` on your `PATH`).

```bash
npm install
cp .env.example .env
npm start
```

Open `http://localhost:7331`, choose **Settings**, and add one or more media folders. The terminal also prints network addresses you can open on phones, tablets, TVs, and other computers connected to the same network.

If a firewall prompt appears, allow incoming connections for Node.js on your private network. Home Library binds to `0.0.0.0` by default; set `LUMA_HOST=127.0.0.1` to keep it available only on the host computer.

## Configuration

Copy `.env.example` to `.env`. The project name is deliberately configuration-driven:

| Variable | Default | Purpose |
| --- | --- | --- |
| `LUMA_NAME` | `Home Library` | Product name shown in the UI |
| `LUMA_PORT` | `7331` | HTTP port |
| `LUMA_HOST` | `0.0.0.0` | Network interface binding |
| `LUMA_DATA_DIR` | `./data` | SQLite database and generated artwork |
| `TMDB_API_KEY` | empty | Optional TMDB v3 key for movie and TV artwork/metadata |
| `FFMPEG_PATH` | `ffmpeg` | Custom FFmpeg binary path |
| `FFPROBE_PATH` | `ffprobe` | Custom ffprobe binary path |

TV episode matching can fall back to TVmaze without a key. All online lookup is best-effort; scanning and playback remain functional offline. Manual edits lock metadata so later scans do not overwrite them. **Match online** explicitly unlocks and retries a title.

## How library synchronization works

- A scan recursively visits supported files and compares file size, modification time, and filesystem identity.
- Renames on the same filesystem preserve catalog metadata and watch progress.
- Modified files are probed again and receive a new thumbnail.
- Missing files are removed from the catalog; source files themselves are never altered or deleted.
- Automatic scan frequency is configurable in Settings. A scan also runs at startup when folders exist.

Supported discovery extensions are MP4, M4V, MKV, WebM, MOV, AVI, WMV, FLV, MPEG/MPG, TS, and M2TS. Browser codec support still applies: H.264/AAC in MP4 and WebM are the most interoperable. Home Library reports other files in the catalog and serves them byte-for-byte, but some browsers cannot decode formats such as WMV or particular MKV codecs without prior conversion.

## Data and privacy

- The SQLite catalog and generated JPEGs live under `data/` and are excluded from Git.
- Video files stay in their original folders.
- Only search terms inferred from filenames are sent to configured metadata providers.
- There are intentionally no accounts or authentication. Do not expose this server to the public internet.

## Operations

```bash
npm run dev       # restart automatically while developing
npm run scan      # run a scan from the terminal
npm test          # unit tests
npm run check     # JavaScript syntax checks
```

Back up `data/library.db` if you want to preserve edits and playback progress. SQLite uses WAL mode, so stop Home Library before copying the database for the simplest consistent backup.

## Architecture

- `server/index.js` — Express API, range streaming, settings, and LAN server
- `server/scanner.js` — recursive reconciliation, ffprobe, and thumbnails
- `server/metadata.js` — optional TMDB/TVmaze matching and local artwork cache
- `server/db.js` — embedded SQLite schema and settings
- `public/` — dependency-free responsive client

This is designed for a trusted single household. If you later put it behind a reverse proxy or VPN, keep that boundary private and add access control there.
