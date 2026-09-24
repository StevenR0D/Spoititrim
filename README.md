# Spotitrim

Spotitrim is an Electron desktop app for saving playable sections of Spotify songs and preparing trimmed MP3 files for Spotify Local Files.

It supports two workflows:

- Save a start and end time for a Spotify song. While Spotitrim is open, it monitors the active Spotify device, jumps to the saved start, and advances at the saved end.
- Download audio from YouTube, optionally trim it, and place the resulting MP3 in a chosen Spotify Local Files folder.

## Features

### Spotify trims

- Connect and switch Spotify accounts using OAuth with PKCE.
- Cancel an unfinished Spotify connection attempt.
- Display the connected account's name and profile image.
- Search Spotify by song or artist.
- Display track artwork and artist information.
- Save, edit, and delete start/end times.
- Keep saved trims separate for each Spotify account.
- Display the currently playing song, artwork, artist, position, and trim status.
- Automatically seek to the saved start and advance at the saved end.
- Enable or disable automatic trims from the Playback section.
- Control the active Spotify Connect device, including a phone.
- Handle token refresh, rate limits, pauses, repeats, track changes, account changes, and device changes.

### Local audio

- Choose and remember a Spotify Local Files folder.
- Download YouTube audio as MP3 with `yt-dlp` and FFmpeg.
- Save either the full audio or a selected time range.
- Keep an archived original for later edits.
- Re-trim a downloaded track without downloading it again.
- Store downloaded-track information locally.

### User experience

- Loading and success messages for asynchronous actions.
- Clear errors beside the action that failed.
- Disabled controls and duplicate-submission protection while work is running.
- Validation for URLs, filenames, time formats, and start/end ordering.
- Persistent local data using SQLite and `electron-store`.

## Requirements

- macOS, Windows, or Linux capable of running Electron
- [Node.js](https://nodejs.org/) and npm; Node.js 24 is currently tested
- [FFmpeg](https://ffmpeg.org/)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp)
- A Spotify Developer application
- A Spotify Premium account for playback-control endpoints

On macOS with Homebrew, install the external tools with:

```bash
brew install ffmpeg yt-dlp
```

Verify that they are available:

```bash
ffmpeg -version
yt-dlp --version
```

All JavaScript packages are declared in `package.json` and installed by npm. The main runtime packages are React, Electron Store, Better SQLite3, and Node ID3. Development uses Electron, Vite, the React Vite plugin, Electron Rebuild, Concurrently, Cross Env, and Wait On.

## Installation

1. Clone the repository and enter its directory.
2. Install the locked JavaScript dependencies:

   ```bash
   npm ci
   ```

   The post-install script rebuilds Better SQLite3 for Electron. Run `npm run postinstall` if the native module needs to be rebuilt later.

3. Install FFmpeg and yt-dlp and ensure both commands are on the app's `PATH`.
4. Create or select an application in the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
5. Add this redirect URI to the Spotify application:

   ```text
   http://127.0.0.1:8888/callback
   ```

6. Set the Spotify Client ID and redirect URI in `electron/config.js`. Spotitrim uses PKCE, so a client secret is not required.
7. Build and launch the app:

   ```bash
   npm run build:renderer
   npm start
   ```

## Development

Start Vite and Electron together with hot reload:

```bash
npm run dev
```

Restart development mode after changing Electron main-process or preload code.

Available commands:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run the Vite renderer and Electron app for development |
| `npm run build:renderer` | Create the production renderer in `dist/` |
| `npm start` | Launch Electron using the production renderer |
| `npm test` | Run the Node test suite |
| `npm run postinstall` | Rebuild Better SQLite3 for the installed Electron version |

## Usage

1. Select **Connect Spotify** and finish signing in through the browser.
2. Search for a song and save its start and end times.
3. Start listening on Spotify. Keep Spotitrim open with **Automatic trims** enabled.
4. For local audio, choose a folder that Spotify has configured as a Local Files source, then enter a YouTube URL and optional trim times.

Times use `mm:ss` with optional milliseconds, such as `0:30` or `1:02.500`.

## Project status

### Completed

- Spotify authentication, connection cancellation, session restoration, and account switching
- Account-specific Spotify trim storage
- Spotify search and trim creation, editing, and deletion
- Current-playback display and automatic start/end enforcement
- One-second playback checks while music is active, with slower idle and error backoff
- Local-folder selection, YouTube audio download, MP3 conversion, and re-trimming
- Loading states, validation, duplicate-action guards, and readable errors
- Automated coverage for authentication, account isolation, stored trims, playback decisions, retries, and rate limiting

### Planned or still needing work

- Complete live testing of end skipping across queues, repeat modes, and device changes
- Reduce perceived boundary delay where Spotify API and network latency permit
- Write title, artist, album, and artwork metadata into downloaded MP3 files
- Add download progress and cancellation
- Prevent or confirm duplicate output filenames before overwriting
- Validate local-audio trim times against the source duration
- Package the app as an installable release
- Review dependency audit results and test on additional operating systems
- Consider embedded playback, playlist/library browsing, and queue controls
- Add an optional hosted service if trims must continue while Spotitrim is closed or the computer is asleep

## Current limitations

- Spotitrim must remain open, online, and on an awake computer for automatic Spotify trims to work.
- Playback boundaries are approximate because the app monitors Spotify over its Web API. Network and Spotify response latency can produce a short delay.
- Automatic playback control requires Spotify Premium and an available, unrestricted Spotify device.
- The app currently runs from the project directory; no installer is provided yet.
- Application data is stored locally on the computer and is not synchronized through a hosted database.

## Data storage

Tokens, SQLite data, settings, and archived source audio are stored in Electron's application-data directory. Finished local MP3 files are written to the folder selected in Spotitrim. Spotify trim records contain timing metadata and do not modify Spotify's audio files.

## Technology

- Electron
- React
- Vite
- SQLite through Better SQLite3
- Spotify Web API and OAuth with PKCE
- yt-dlp
- FFmpeg
