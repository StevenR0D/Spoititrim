import React, { useEffect, useState } from "react";
import SpotifyTrims from "./SpotifyTrims.jsx";

// mm:ss -> milliseconds, since that's a more natural way to type times
// than raw milliseconds or decimal seconds.
function parseTimeToMs(value) {
  const [min, sec] = value.split(":").map(Number);
  if (Number.isNaN(min) || Number.isNaN(sec)) return null;
  return (min * 60 + sec) * 1000;
}

export default function App() {
  const [accessToken, setAccessToken] = useState(null);
  const [loginStatus, setLoginStatus] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [localFilesFolder, setLocalFilesFolder] = useState(null);
  const [localTracks, setLocalTracks] = useState([]);

  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [title, setTitle] = useState("");
  const [startInput, setStartInput] = useState("");
  const [endInput, setEndInput] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    window.api.getAccessToken().then(setAccessToken).catch(() => setLoginStatus("Please reconnect your Spotify account."));
    window.api.getLocalFilesFolder().then(setLocalFilesFolder);
    refreshLocalTracks();
  }, []);

  function refreshLocalTracks() {
    window.api.getAllLocalTracks().then(setLocalTracks);
  }

  async function handleLogin() {
    setConnecting(true);
    setLoginStatus("");
    try {
      await window.api.spotifyLogin();
      const token = await window.api.getAccessToken();
      setAccessToken(token);
    } catch {
      setLoginStatus("Could not connect to Spotify. Please try again.");
    } finally {
      setConnecting(false);
    }
  }

  async function handleChooseFolder() {
    const folder = await window.api.chooseLocalFilesFolder();
    if (folder) setLocalFilesFolder(folder);
  }

  async function handleDownload(e) {
    e.preventDefault();
    setStatus("Downloading and processing...");

    const startMs = startInput ? parseTimeToMs(startInput) : null;
    const endMs = endInput ? parseTimeToMs(endInput) : null;

    try {
      await window.api.startDownload({ youtubeUrl, title, startMs, endMs });
      setStatus(`Done - "${title}" is in your local files folder.`);
      setYoutubeUrl("");
      setTitle("");
      setStartInput("");
      setEndInput("");
      refreshLocalTracks();
    } catch (err) {
      setStatus(`Failed: ${err.message}`);
    }
  }

  async function handleRetrim(track) {
    const startStr = window.prompt("New start (mm:ss)", "");
    const endStr = window.prompt("New end (mm:ss)", "");
    if (!startStr || !endStr) return;

    const startMs = parseTimeToMs(startStr);
    const endMs = parseTimeToMs(endStr);

    try {
      await window.api.retrimTrack({ trackId: track.id, startMs, endMs });
      refreshLocalTracks();
    } catch (err) {
      alert(`Re-trim failed: ${err.message}`);
    }
  }

  return (
    <div className="app">
      <h1>spotitrim</h1>

      <section>
        <h2>Spotify Account</h2>
        {accessToken && <p className="muted">Connected.</p>}
        <button onClick={handleLogin} disabled={connecting}>
          {connecting ? "Connecting..." : accessToken ? "Reconnect Spotify" : "Connect Spotify"}
        </button>
        <p className="muted" role="status">{loginStatus}</p>
      </section>

      <SpotifyTrims />

      <section>
        <h2>Local Files Folder</h2>
        <p className="muted">{localFilesFolder || "Not set yet."}</p>
        <button onClick={handleChooseFolder}>Choose Folder</button>
      </section>

      <section>
        <h2>Download from YouTube</h2>
        <form onSubmit={handleDownload}>
          <input
            type="text"
            placeholder="YouTube URL"
            value={youtubeUrl}
            onChange={(e) => setYoutubeUrl(e.target.value)}
            required
          />
          <input
            type="text"
            placeholder="Title (used as the filename)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
          <div className="row">
            <input
              type="text"
              placeholder="Start (mm:ss) - optional"
              value={startInput}
              onChange={(e) => setStartInput(e.target.value)}
            />
            <input
              type="text"
              placeholder="End (mm:ss) - optional"
              value={endInput}
              onChange={(e) => setEndInput(e.target.value)}
            />
          </div>
          <button type="submit">Download & Add to Local Files</button>
        </form>
        {status && <p className="muted">{status}</p>}
      </section>

      <section>
        <h2>Downloaded Tracks</h2>
        {localTracks.length === 0 && <p className="muted">Nothing downloaded yet.</p>}
        {localTracks.map((track) => (
          <div className="row" key={track.id} style={{ marginBottom: 8 }}>
            <span style={{ flex: 1 }}>{track.title}</span>
            <button onClick={() => handleRetrim(track)}>Re-trim</button>
          </div>
        ))}
      </section>

    </div>
  );
}
