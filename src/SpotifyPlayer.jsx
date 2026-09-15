import React, { useEffect, useRef, useState } from "react";
import AlbumArtwork from "./AlbumArtwork.jsx";
import { formatTrimTime } from "./SpotifyTrims.jsx";

export default function SpotifyPlayer({ account }) {
  const [playback, setPlayback] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [changing, setChanging] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const toggleLock = useRef(false);
  const viewVersion = useRef(0);

  useEffect(() => {
    let stopped = false;
    let timer;
    const version = ++viewVersion.current;

    async function checkPlayback() {
      if (stopped || version !== viewVersion.current) return;
      try {
        const result = await window.api.getPlayback(account.id);

        if (stopped || version !== viewVersion.current) return;

        setPlayback(result.playback);
        setEnabled(result.enabled);
        setMessage(result.message);
        setError(result.error?.message || "");
        setLoading(false);

        // Schedule another check after this one finishes.
        if (!result.needsReconnect) {
          timer = setTimeout(checkPlayback, Math.max(750, result.nextPollMs || 5000));
        }
      } catch {
        if (stopped || version !== viewVersion.current) return;

        setError(
          "Could not check playback. Checks will retry; reconnect Spotify if this continues."
        );
        setLoading(false);
        timer = setTimeout(checkPlayback, 10000);
      }
    }

    checkPlayback();

    // React runs this when the component is removed or account changes.
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [account.id, refresh]);

  async function toggleAutomaticTrims() {
    if (toggleLock.current) return;
    toggleLock.current = true;
    setChanging(true);
    // Ignore an older poll that finishes while this setting is changing.
    ++viewVersion.current;
    try {
      const value = await window.api.setAutomaticTrims(account.id, !enabled);
      setEnabled(value);
      setError("");
    } catch {
      setError("Could not change automatic trims. Try again.");
    } finally {
      toggleLock.current = false;
      setChanging(false);
      setRefresh(value => value + 1);
    }
  }

  const progressMs = playback?.progress_ms ?? 0;
  const trim = playback?.trim;

  const trimStatus = trim
    ? progressMs < trim.start_ms
      ?  "Before trim start"
      : progressMs >= trim.end_ms
        ? "Past trim end"
        : "Inside saved trim"
    : null;

  return (
    <section>
      <div className="playback-heading">
        <h2>Playback</h2>
        <button className="account-secondary" type="button" role="switch"
          aria-checked={enabled} aria-label="Automatic trims"
          disabled={loading || changing} onClick={toggleAutomaticTrims}>
          {changing ? "Updating…" : `Automatic trims: ${enabled ? "On" : "Off"}`}
        </button>
      </div>
      <p className="muted playback-help">Start music in Spotify. Saved trims apply automatically while this window is open and your computer is awake.</p>

      {loading && <p className="muted">Checking Spotify...</p>}

      {error && <p className="error" role="alert">{error}</p>}
      {message && <p className="muted" role="status">{message}</p>}
      {error && playback && <p className="muted">Showing the last successful playback check.</p>}

      {!loading && (
        playback?.item ? (
          <div className="now-playing">
            <AlbumArtwork
              key={playback.item.id || playback.item.uri}
              images={playback.item.album?.images || playback.item.images}
              large
            />
            <div className="spotify-track-info">
              <strong>{playback.item.name}</strong>
              <p className="muted now-playing-artist">
                {playback.item.artists?.map(artist => artist.name).join(", ")}
              </p>
              <p className="muted">
                {playback.is_playing ? "Playing" : "Paused"}
              </p>
              {trimStatus && (
                <p className="muted playback-trim-status">
                  {trimStatus}
                </p>
              )}
              {playback.trim ? (
                <p className="playback-trim">
                  Saved trim: {formatTrimTime(playback.trim.start_ms)}
                  {" → "}
                  {formatTrimTime(playback.trim.end_ms)}
                </p>
              ) : (
                <p className="muted playback-trim-empty">
                  No saved trim for this song.
                </p>
              )}
            </div>
          </div>
        ) : (
          <p className="muted">
            Nothing playing. Start a song in Spotify.
          </p>
        )
      )}
    </section>
  );
}
