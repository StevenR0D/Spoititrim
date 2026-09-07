const path = require("path");
const Database = require("better-sqlite3");
const { app } = require("electron");

// electron's `app.getPath("userData")` gives you a per-OS-correct place to
// store app data (AppData on Windows, ~/Library/Application Support on Mac,
// etc.) instead of hardcoding a path yourself.
const dbPath = path.join(app.getPath("userData"), "spotitrim.db");
const db = new Database(dbPath);

db.pragma("journal_mode = WAL");

// One table per feature, since they track pretty different things.
// trim_points: for Project A - Spotify catalog streaming songs.
// local_tracks: for Project B - YouTube downloads, their archive location,
// and whatever trim is currently applied to the copy sitting in the
// Spotify local files folder.
db.exec(`
  CREATE TABLE IF NOT EXISTS trim_points (
    spotify_track_id TEXT PRIMARY KEY,
    track_name TEXT,
    start_ms INTEGER NOT NULL,
    end_ms INTEGER NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS local_tracks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    youtube_url TEXT NOT NULL,
    archive_path TEXT NOT NULL,
    local_files_path TEXT NOT NULL,
    start_ms INTEGER,
    end_ms INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

// --- trim points (Project A) ---
function upsertTrimPoint(spotifyTrackId, trackName, startMs, endMs) {
  db.prepare(
    `INSERT INTO trim_points (spotify_track_id, track_name, start_ms, end_ms)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(spotify_track_id) DO UPDATE SET
       track_name = excluded.track_name,
       start_ms = excluded.start_ms,
       end_ms = excluded.end_ms,
       updated_at = CURRENT_TIMESTAMP`
  ).run(spotifyTrackId, trackName, startMs, endMs);
}

function getTrimPoint(spotifyTrackId) {
  return db
    .prepare(`SELECT * FROM trim_points WHERE spotify_track_id = ?`)
    .get(spotifyTrackId);
}

function getAllTrimPoints() {
  return db.prepare(`SELECT * FROM trim_points`).all();
}

function deleteTrimPoint(spotifyTrackId) {
  db.prepare(`DELETE FROM trim_points WHERE spotify_track_id = ?`).run(spotifyTrackId);
}

// --- local tracks (Project B) ---
function insertLocalTrack({ title, youtubeUrl, archivePath, localFilesPath, startMs, endMs }) {
  const result = db
    .prepare(
      `INSERT INTO local_tracks (title, youtube_url, archive_path, local_files_path, start_ms, end_ms)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(title, youtubeUrl, archivePath, localFilesPath, startMs ?? null, endMs ?? null);
  return result.lastInsertRowid;
}

function updateLocalTrackTrim(id, startMs, endMs) {
  db.prepare(
    `UPDATE local_tracks SET start_ms = ?, end_ms = ? WHERE id = ?`
  ).run(startMs, endMs, id);
}

function getAllLocalTracks() {
  return db.prepare(`SELECT * FROM local_tracks ORDER BY created_at DESC`).all();
}

// --- settings (e.g. local files folder path) ---
function setSetting(key, value) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, value);
}

function getSetting(key) {
  const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key);
  return row ? row.value : null;
}

module.exports = {
  upsertTrimPoint,
  getTrimPoint,
  getAllTrimPoints,
  deleteTrimPoint,
  insertLocalTrack,
  updateLocalTrackTrim,
  getAllLocalTracks,
  setSetting,
  getSetting
};
