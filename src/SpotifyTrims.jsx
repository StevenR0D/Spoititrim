import React, { useEffect, useRef, useState } from "react";
import AlbumArtwork from "./AlbumArtwork.jsx";

function SavedTrimDetails({ accountId, trim }) {
  const [metadata, setMetadata] = useState({ imageUrl: trim.image_url, artistName: trim.artist_name });
  useEffect(() => {
    let active = true;
    setMetadata({ imageUrl: trim.image_url, artistName: trim.artist_name });
    if (trim.image_url && trim.artist_name != null) return;
    window.api.getTrimMetadata(accountId, trim.spotify_track_id)
      .then(value => { if (active && value) setMetadata(value); }).catch(() => {});
    return () => { active = false; };
  }, [accountId, trim.spotify_track_id, trim.image_url, trim.artist_name]);
  return <>
    <AlbumArtwork images={metadata.imageUrl ? [{ url: metadata.imageUrl }] : []} />
    <div className="spotify-track-info">
      <strong>{trim.track_name || trim.spotify_track_id}</strong>
      {metadata.artistName && <div className="muted">{metadata.artistName}</div>}
      <div className="muted">{formatTrimTime(trim.start_ms)} – {formatTrimTime(trim.end_ms)}</div>
    </div>
  </>;
}

export function parseTrimTime(value) {
  if (!/^\d+:[0-5]\d(?:\.\d{1,3})?$/.test(value.trim())) return null;
  const [minutes, seconds] = value.trim().split(":").map(Number);
  const ms = Math.round((minutes * 60 + seconds) * 1000);
  return Number.isSafeInteger(ms) ? ms : null;
}

export function formatTrimTime(ms) {
  const seconds = Math.floor(ms / 1000);
  const fraction = ms % 1000 ? `.${String(ms % 1000).padStart(3, "0").replace(/0+$/, "")}` : "";
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}${fraction}`;
}

export default function SpotifyTrims({ account }) {
  const [hasLegacy, setHasLegacy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchMessage, setSearchMessage] = useState("");
  const [selected, setSelected] = useState(null);
  const [start, setStart] = useState("0:00");
  const [end, setEnd] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [deleteMessage, setDeleteMessage] = useState("");
  const busy = saving || importing || deleting !== null;
  const [saveMessage, setSaveMessage] = useState("");
  const [trims, setTrims] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const editor = useRef(null);
  const locks = useRef(new Set());
  const searchAttempt = useRef(0);
  const searchController = useRef(null);

  async function loadTrims() {
    if (locks.current.has("load")) return;
    locks.current.add("load");
    setLoading(true);
    setLoadError("");
    try {
      setTrims(await window.api.getAllTrimPoints(account.id));
    } catch {
      setLoadError("Could not load saved trims. Try again.");
    } finally {
      locks.current.delete("load");
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTrims();
    window.api.hasLegacyTrims(account.id).then(setHasLegacy).catch(() => setImportMessage("Could not check for older trims. Reconnect to try again."));
  }, []);

  async function importLegacy() {
    if (busy || loading || locks.current.has("mutation")) return;
    locks.current.add("mutation"); setImporting(true); setImportMessage("");
    try {
      await window.api.importLegacyTrims(account.id);
      setHasLegacy(false);
      setImportMessage(`Older trims imported into ${account.name}.`);
      await loadTrims();
    } catch { setImportMessage("Could not import older trims. Please try again."); }
    finally { locks.current.delete("mutation"); setImporting(false); }
  }

  function changeQuery(value) {
    setQuery(value);
    // Cancel the old query so a late response cannot refill an empty list.
    searchAttempt.current += 1;
    searchController.current?.abort();
    locks.current.delete("search");
    setSearching(false);
    if (!value.trim()) { setResults([]); setSearchMessage(""); }
  }

  useEffect(() => () => { searchAttempt.current += 1; searchController.current?.abort(); }, []);

  async function search(event) {
    event.preventDefault();
    if (locks.current.has("search")) return;
    if (!query.trim()) { setSearchMessage("Enter a song title or artist to search."); return; }
    const attempt = ++searchAttempt.current;
    const controller = new AbortController();
    searchController.current = controller;
    locks.current.add("search");
    setSearching(true);
    setSearchMessage("");
    try {
      const token = await window.api.getAccessToken(account.id);
      if (attempt !== searchAttempt.current) return;
      if (!token) throw new Error("Connect your Spotify account above to search for songs.");
      const params = new URLSearchParams({ q: query.trim(), type: "track", limit: "10" });
      const response = await fetch(`https://api.spotify.com/v1/search?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]),
      });
      if (response.status === 401) throw new Error("Your Spotify session expired. Connect Spotify again above.");
      if (response.status === 429) throw new Error("Spotify is receiving too many requests. Please try again shortly.");
      if (!response.ok) throw new Error(`Spotify search failed (${response.status}). Please try again.`);
      const data = await response.json();
      const tracks = (data.tracks?.items || []).filter((track) => track?.id && !track.is_local);
      if (attempt !== searchAttempt.current) return;
      setResults(tracks);
      if (!tracks.length) setSearchMessage("No songs found. Try another song title or artist.");
    } catch (error) {
      if (attempt !== searchAttempt.current) return;
      setSearchMessage(/^(Connect your|Your Spotify|Spotify )/.test(error.message || "") ? error.message : "Search failed or timed out. Check your connection and try again.");
    } finally {
      if (attempt === searchAttempt.current) {
        locks.current.delete("search");
        setSearching(false);
      }
    }
  }

  function selectTrack(track) {
    if (busy || loading || locks.current.has("mutation")) return;
    const saved = trims.find((trim) => trim.spotify_track_id === track.id);
    setSelected(track);
    setStart(formatTrimTime(saved?.start_ms ?? 0));
    setEnd(saved ? formatTrimTime(saved.end_ms) : track.duration_ms ? formatTrimTime(track.duration_ms) : "");
    setSaveMessage("");
    requestAnimationFrame(() => {
      editor.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      editor.current?.querySelector("input")?.focus({ preventScroll: true });
    });
  }

  async function save(event) {
    event.preventDefault();
    if (!selected || busy || loading || locks.current.has("mutation")) return;
    const startMs = parseTrimTime(start);
    const endMs = parseTrimTime(end);
    if (startMs === null || endMs === null || endMs <= startMs) {
      setSaveMessage("Enter valid times as mm:ss, with the end after the start.");
      return;
    }
    if (selected.duration_ms && endMs > selected.duration_ms) {
      setSaveMessage("The end time cannot exceed the song's duration.");
      return;
    }
    locks.current.add("mutation");
    setSaving(true);
    setSaveMessage("");
    try {
      await window.api.saveTrimPoint({ accountId: account.id, spotifyTrackId: selected.id, trackName: selected.name, startMs, endMs, imageUrl: selected.album?.images?.[0]?.url || selected.image_url, artistName: selected.artists?.map(artist => artist.name).join(", ") || selected.artist_name });
      setTrims(current => [...current.filter(trim => trim.spotify_track_id !== selected.id), {
        spotify_track_id: selected.id, track_name: selected.name, artist_name: selected.artists?.map(artist => artist.name).join(", ") || selected.artist_name, image_url: selected.album?.images?.[0]?.url || selected.image_url, start_ms: startMs, end_ms: endMs,
      }]);
      setSaveMessage(`Saved trim for "${selected.name}".`);
      await loadTrims();
    } catch {
      setSaveMessage("Could not save this trim. Please try again.");
    } finally {
      locks.current.delete("mutation");
      setSaving(false);
    }
  }

  async function deleteTrim(trim) {
    if (busy || loading || locks.current.has("mutation")) return;
    locks.current.add("mutation");
    setDeleting(trim.spotify_track_id);
    setDeleteMessage("");
    try {
      await window.api.deleteTrimPoint(account.id, trim.spotify_track_id);
      setTrims((current) => current.filter((item) => item.spotify_track_id !== trim.spotify_track_id));
      if (selected?.id === trim.spotify_track_id) {
        setSelected(null);
        setSaveMessage("");
      }
      setDeleteMessage(`Deleted trim for "${trim.track_name || trim.spotify_track_id}".`);
    } catch {
      setDeleteMessage("Could not delete this trim. Please try again.");
    } finally {
      locks.current.delete("mutation");
      setDeleting(null);
    }
  }

  return (
    <>
      <section aria-labelledby="spotify-search-heading">
        <h2 id="spotify-search-heading">Search Spotify</h2>
        <p className="muted">Find a song, select the version you want, and save its start and end times.</p>
        <form onSubmit={search} className="row spotify-search">
          <input aria-label="Song title or artist" type="text" placeholder="Search for a song or artist..." value={query} onChange={(event) => changeQuery(event.target.value)} required />
          <button disabled={searching || !query.trim()} type="submit">{searching ? "Searching..." : "Search"}</button>
        </form>
        <p className="muted" role="status">{searchMessage}</p>
        {results.length > 0 && <ul className="spotify-tracks">
          {results.map((track) => <li className="row spotify-track" key={track.id}>
            <AlbumArtwork images={track.album?.images} />
            <div className="spotify-track-info">
              <strong>{track.name}</strong>
              <div className="muted">{track.artists?.map((artist) => artist.name).join(", ")} · {track.album?.name} · {formatTrimTime(track.duration_ms)}</div>
            </div>
            <button type="button" disabled={busy || loading} aria-pressed={selected?.id === track.id} onClick={() => selectTrack(track)}>{selected?.id === track.id ? "Selected" : "Select"}</button>
          </li>)}
        </ul>}
        {selected && <form ref={editor} className="trim-editor" onSubmit={save}>
          <h3>{selected.name}</h3>
          <div className="row">
            <label>Start (mm:ss)<input type="text" value={start} disabled={busy || loading} onChange={(event) => setStart(event.target.value)} placeholder="0:00" required /></label>
            <label>End (mm:ss)<input type="text" value={end} disabled={busy || loading} onChange={(event) => setEnd(event.target.value)} placeholder="2:48" required /></label>
          </div>
          <button type="submit" disabled={busy || loading}>{saving ? "Saving..." : "Save Trim"}</button>
          <p className="muted" role="status">{saveMessage}</p>
        </form>}
      </section>

      <section aria-labelledby="saved-trims-heading">
        <h2 id="saved-trims-heading">My Trimmed Songs</h2>
        <p className="muted">Saved Spotify songs and trim times for {account.name}.</p>
        {hasLegacy && <div className="trim-editor">
          <p className="muted">Older trims on this Mac were saved without an account. Import them only if they belong to {account.name}. This assigns them to this account once.</p>
          <button disabled={busy || loading} onClick={importLegacy}>{importing ? "Importing..." : "Import Older Trims into This Account"}</button>
        </div>}
        <p className="muted" role="status">{importMessage}</p>
        <p className="muted" role="status">{deleteMessage}</p>
        {loading && <p className="muted" role="status">Loading saved trims...</p>}
        {loadError && <div role="alert"><p>{loadError}</p><button disabled={loading || busy} onClick={loadTrims}>Try Again</button></div>}
        {!loading && !loadError && trims.length === 0 && <p className="muted">No saved trims yet. Search for a song above to add your first one.</p>}
        {<ul className="spotify-tracks">
          {trims.map((trim) => <li className="row spotify-track" key={trim.spotify_track_id}>
            <SavedTrimDetails accountId={account.id} trim={trim} />
            <button disabled={busy || loading} onClick={() => selectTrack({ id: trim.spotify_track_id, name: trim.track_name || trim.spotify_track_id, image_url: trim.image_url, artist_name: trim.artist_name })}>Edit Trim</button>
            <button className="delete-trim" disabled={busy || loading} onClick={() => deleteTrim(trim)}>
              {deleting === trim.spotify_track_id ? "Deleting..." : "Delete Trim"}
            </button>
          </li>)}
        </ul>}
      </section>
    </>
  );
}
