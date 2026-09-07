# spotitrim

Personal desktop app: (A) trim Spotify catalog songs so playback auto-skips
at a set end point, and (B) download YouTube audio, trim it, tag it, and
drop it into Spotify's "local files" folder so it plays natively.

## Setup

1. Install dependencies:
   ```
   npm install
   ```
   (This also rebuilds `better-sqlite3` for Electron's Node version via the
   `postinstall` script - if that step fails, re-run `npm install` once more,
   it usually just needs network access the first time.)

2. Install the two CLI tools the app shells out to:
   - [ffmpeg](https://ffmpeg.org/download.html) - must be on your PATH
   - `yt-dlp`: `pip install yt-dlp`

3. Register a Spotify app:
   - Go to https://developer.spotify.com/dashboard, create an app
   - Add this exact Redirect URI: `http://127.0.0.1:8888/callback`
   - Copy the Client ID into `electron/config.js`

4. Run it in dev mode:
   ```
   npm run dev
   ```
   This starts the Vite dev server (React) and Electron together, with hot
   reload on the React side.

## Project status

**Done:**
- Electron shell (main + renderer, contextBridge-isolated)
- Spotify OAuth via Authorization Code + PKCE (no client secret needed)
- SQLite storage for trim points (Project A) and downloaded-track tracking
  with archive paths (Project B)
- Settings: manual local files folder picker
- Full Project B pipeline: yt-dlp download -> archive copy -> ffmpeg trim
  -> ID3 tagging -> save into local files folder
- Re-trim flow: re-cuts from the archived original, replaces the file in
  local files, without re-downloading

**Not built yet - next steps:**
- Project A: Web Playback SDK integration in the renderer (needs the
  `access_token` from `window.api.getAccessToken()`), playlist/track
  browser, trim-point UI, and the position-polling loop that triggers
  skip-to-next when playback crosses the saved end point
- Basic error/loading states in the UI (downloads currently just show a
  single status string)
- Album art fetching for downloaded tracks (currently only text tags -
  title/artist/album - get written; no APIC/cover art yet)

## How the pieces fit together

- `electron/main.js` - window creation, OAuth flow, IPC handlers (the only
  way the React UI can reach into Node/the filesystem)
- `electron/preload.js` - the whitelist of functions exposed to React as
  `window.api.*`
- `electron/db.js` - SQLite tables: `trim_points`, `local_tracks`, `settings`
- `electron/downloader.js` - the yt-dlp/ffmpeg/node-id3 pipeline
- `src/App.jsx` - the React UI
