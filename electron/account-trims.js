// Old trim_points remain untouched: their account owner was never recorded.
function createAccountTrims(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS account_trim_points (
    account_id TEXT NOT NULL,
    spotify_track_id TEXT NOT NULL,
    track_name TEXT,
    start_ms INTEGER NOT NULL,
    end_ms INTEGER NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (account_id, spotify_track_id)
  );
  CREATE TABLE IF NOT EXISTS legacy_trim_import (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    account_id TEXT NOT NULL
  );`);
  if (!db.prepare("PRAGMA table_info(account_trim_points)").all().some(column => column.name === "image_url")) {
    db.exec("ALTER TABLE account_trim_points ADD COLUMN image_url TEXT");
  }
  if (!db.prepare("PRAGMA table_info(account_trim_points)").all().some(column => column.name === "artist_name")) {
    db.exec("ALTER TABLE account_trim_points ADD COLUMN artist_name TEXT");
  }
  function owner(id) {
    if (typeof id !== 'string' || !id.trim()) throw new Error('A verified Spotify account is required.');
    return id;
  }
  return {
    upsertTrimPoint(accountId, trackId, name, start, end, imageUrl = null, artistName = null) {
      db.prepare(`INSERT INTO account_trim_points (account_id, spotify_track_id, track_name, start_ms, end_ms, image_url, artist_name)
        VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(account_id, spotify_track_id) DO UPDATE SET
        track_name=excluded.track_name, start_ms=excluded.start_ms, end_ms=excluded.end_ms, image_url=COALESCE(excluded.image_url, account_trim_points.image_url), artist_name=COALESCE(excluded.artist_name, account_trim_points.artist_name), updated_at=CURRENT_TIMESTAMP`)
        .run(owner(accountId), trackId, name, start, end, imageUrl, artistName);
    },
    setTrimMetadata(accountId, trackId, imageUrl, artistName) {
      db.prepare("UPDATE account_trim_points SET image_url=?, artist_name=? WHERE account_id=? AND spotify_track_id=?").run(imageUrl, artistName, owner(accountId), trackId);
    },
    getTrimPoint(accountId, trackId) {
      return db.prepare('SELECT * FROM account_trim_points WHERE account_id=? AND spotify_track_id=?').get(owner(accountId), trackId);
    },
    getAllTrimPoints(accountId) {
      return db.prepare('SELECT * FROM account_trim_points WHERE account_id=? ORDER BY updated_at DESC, spotify_track_id').all(owner(accountId));
    },
    deleteTrimPoint(accountId, trackId) {
      db.prepare('DELETE FROM account_trim_points WHERE account_id=? AND spotify_track_id=?').run(owner(accountId), trackId);
    },
    hasLegacyTrims() {
      return !db.prepare('SELECT 1 FROM legacy_trim_import WHERE singleton=1').get()
        && !!db.prepare('SELECT 1 FROM trim_points LIMIT 1').get();
    },
    importLegacyTrims(accountId) {
      owner(accountId);
      db.exec('BEGIN IMMEDIATE');
      try {
        if (!db.prepare('SELECT 1 FROM legacy_trim_import WHERE singleton=1').get()) {
          // Preserve newer account-specific edits on collision.
          db.prepare(`INSERT OR IGNORE INTO account_trim_points
            (account_id, spotify_track_id, track_name, start_ms, end_ms, updated_at)
            SELECT ?, spotify_track_id, track_name, start_ms, end_ms, updated_at FROM trim_points`).run(accountId);
          db.prepare('INSERT INTO legacy_trim_import (singleton, account_id) VALUES (1, ?)').run(accountId);
        }
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
  };
}
module.exports = { createAccountTrims };
