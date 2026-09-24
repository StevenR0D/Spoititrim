import React, { useEffect, useRef, useState } from "react";
import SpotifyTrims, { parseTrimTime, formatTrimTime } from "./SpotifyTrims.jsx";
import { friendlyError } from "./feedback";
import SpotifyPlayer from "./SpotifyPlayer.jsx";

function Feedback({ error, message }) {
  return error ? <p className="error" role="alert">{error}</p> : message ? <p className="muted" role="status">{message}</p> : null;
}
function AccountAvatar({ account }) {
  const [failed, setFailed] = useState(false);
  const initials = account.name.trim().split(/\s+/).slice(0, 2).map(part => Array.from(part)[0]).join("").toUpperCase() || "S";
  return <div className="account-avatar" aria-hidden="true">
    {account.imageUrl && !failed ? <img src={account.imageUrl} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <span>{initials}</span>}
  </div>;
}

function trimValues(start, end, optional = false) {
  if (optional && !start.trim() && !end.trim()) return { startMs: null, endMs: null };
  const startMs = parseTrimTime(start), endMs = parseTrimTime(end);
  if (startMs === null || endMs === null || endMs <= startMs) throw new Error("Enter both times as mm:ss (for example 0:30), with the end after the start.");
  return { startMs, endMs };
}

export default function App() {
  const [loggingIn, setLoggingIn] = useState(false);
  const [cancellingLogin, setCancellingLogin] = useState(false);
  const [account, setAccount] = useState(null);
  const [localFilesFolder, setLocalFilesFolder] = useState(null);
  const [localTracks, setLocalTracks] = useState([]);
  const [pending, setPending] = useState({ account: true, folder: true, tracks: true });
  const [errors, setErrors] = useState({});
  const [messages, setMessages] = useState({});
  // Ref locks act immediately, including before React renders disabled buttons.
  const locks = useRef(new Set());
  const loginCancelled = useRef(false);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [title, setTitle] = useState("");
  const [startInput, setStartInput] = useState("");
  const [endInput, setEndInput] = useState("");
  const [editing, setEditing] = useState(null);
  const [reStart, setReStart] = useState("");
  const [reEnd, setReEnd] = useState("");
  const errorAt = (key, value) => setErrors(old => ({ ...old, [key]: value }));
  const messageAt = (key, value) => setMessages(old => ({ ...old, [key]: value }));

  async function run(key, action, fallback) {
    if (locks.current.has(key)) return;
    locks.current.add(key);
    setPending(old => ({ ...old, [key]: true }));
    errorAt(key, "");
    try { await action(); }
    catch (error) {
      if (key === "account" && error?.message?.includes("SPOTIFY_LOGIN_CANCELLED")) {
        messageAt("account", "Spotify connection cancelled. You can connect again whenever you’re ready.");
      } else errorAt(key, friendlyError(error, fallback));
    }
    finally {
      locks.current.delete(key);
      setPending(old => ({ ...old, [key]: false }));
    }
  }
  const loadAccount = () => run("account", async () => { setAccount(null); setAccount(await window.api.getSpotifyAccount()); }, "Could not check your Spotify account. Reconnect or try again.");
  const loadFolder = () => run("folder", async () => setLocalFilesFolder(await window.api.getLocalFilesFolder()), "Could not load your folder setting. Try again or choose a folder.");
  const loadTracks = () => run("tracks", async () => setLocalTracks(await window.api.getAllLocalTracks()), "Could not refresh downloaded tracks. Your completed operation is still saved. Try loading the list again.");
  useEffect(() => { loadAccount(); loadFolder(); loadTracks(); }, []);
  const fileBusy = pending.download || pending.retrim || pending.folder;

  async function login() {
    if (locks.current.has("account")) return;
    loginCancelled.current = false;
    setLoggingIn(true);
    try { await run("account", async () => {
      setAccount(null);
      messageAt("account", "Complete sign-in in your browser. Choose your browser profile if prompted, then finish signing in within five minutes.");
      await window.api.spotifyLogin();
      if (loginCancelled.current) return;
      const connectedAccount = await window.api.getSpotifyAccount();
      if (loginCancelled.current) return;
      if (!connectedAccount) throw new Error("No account");
      setAccount(connectedAccount);
      messageAt("account", "Spotify connected successfully.");
    }, "Could not connect to Spotify. Please try again and finish sign-in in your browser.");
    } finally { setLoggingIn(false); }
  }
  async function cancelLogin() {
    if (locks.current.has("cancelLogin")) return;
    locks.current.add("cancelLogin"); setCancellingLogin(true);
    loginCancelled.current = true;
    try {
      const cancelled = await window.api.cancelSpotifyLogin();
      if (cancelled) {
        errorAt("account", "");
        messageAt("account", "Spotify connection cancelled. You can connect again whenever you’re ready.");
      }
    } catch { errorAt("account", "Could not cancel sign-in. Please try Cancel again."); }
    finally { locks.current.delete("cancelLogin"); setCancellingLogin(false); }
  }
  function logout() {
    run("account", async () => {
      setAccount(null);
      await window.api.spotifyLogout();
      messageAt("account", "Signed out of Spotitrim.");
    }, "Could not sign out. Please try again.");
  }
  function chooseFolder() {
    if (fileBusy) return;
    run("folder", async () => {
      const folder = await window.api.chooseLocalFilesFolder();
      if (folder) { setLocalFilesFolder(folder); messageAt("folder", "Folder saved."); }
    }, "Could not select or save this folder. Please try again.");
  }
  function download(event) {
    event.preventDefault();
    if (fileBusy || locks.current.has("download") || locks.current.has("retrim")) return;
    let times;
    try {
      const parsed = new URL(youtubeUrl.trim());
      if (!["https:", "http:"].includes(parsed.protocol) || !["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"].includes(parsed.hostname) || parsed.username || parsed.password) throw new Error();
    } catch { errorAt("download", "Enter a valid YouTube link, such as https://www.youtube.com/watch?v=…"); return; }
    if (!title.trim() || /[\\/:*?"<>|\x00-\x1f]/.test(title) || title.trim().length > 180) { errorAt("download", "Enter a title under 181 characters without filename characters such as /, \\, : or ?."); return; }
    if (!localFilesFolder) { errorAt("download", "Choose your local files folder above first."); return; }
    try { times = trimValues(startInput, endInput, true); }
    catch (error) { errorAt("download", error.message); return; }
    const savedTitle = title.trim();
    run("download", async () => {
      await window.api.startDownload({ youtubeUrl: youtubeUrl.trim(), title: savedTitle, ...times });
      messageAt("download", `Done — "${savedTitle}" is in your local files folder.`);
      setYoutubeUrl(""); setTitle(""); setStartInput(""); setEndInput("");
      await loadTracks();
    }, "Could not download or process this video. Check the link, your connection, and that yt-dlp and ffmpeg are installed, then try again.");
  }
  function retrim(event) {
    event.preventDefault();
    if (fileBusy || !editing || locks.current.has("retrim") || locks.current.has("download")) return;
    let times;
    try { times = trimValues(reStart, reEnd); }
    catch (error) { errorAt("retrim", error.message); return; }
    run("retrim", async () => {
      await window.api.retrimTrack({ trackId: editing.id, ...times });
      messageAt("retrim", `Re-trimmed "${editing.title}" successfully.`);
      setEditing(null);
      await loadTracks();
    }, "Could not re-trim this track. Check that the original audio and destination folder are available and ffmpeg is installed.");
  }
  return <div className="app">
    <h1>spotitrim</h1>
    <section className="account-card">
      <div className="account-header">
        <div className="account-profile">
          {account && !pending.account && <AccountAvatar key={`${account.id}:${account.imageUrl}`} account={account} />}
        <div className="account-details">
          <h2>Spotify Account</h2>
          {account && !pending.account && <p className="muted account-identity"><span className="connection-dot" aria-hidden="true" />Connected as {account.name}.</p>}
        </div>
        </div>
        {account && <button className="account-secondary" onClick={logout} disabled={pending.account}>Sign Out</button>}
      </div>
      <div className="account-actions">
      <button onClick={login} disabled={pending.account || cancellingLogin}>{pending.account ? "Checking / connecting..." : account ? "Reconnect / Switch Account" : "Connect Spotify"}</button>
      {loggingIn && <button className="account-secondary" onClick={cancelLogin} disabled={cancellingLogin}>{cancellingLogin ? "Cancelling..." : "Cancel Connection"}</button>}
      </div>
      <Feedback error={errors.account} message={messages.account} />
      {errors.account && <button onClick={loadAccount} disabled={pending.account}>Retry Account Check</button>}
    </section>
    {account && !pending.account && (
  <SpotifyPlayer key={account.id} account={account} />
)}
    {account && !pending.account ? <SpotifyTrims key={account.id} account={account} /> :
      <section><h2>My Trimmed Songs</h2><p className="muted" role="status">{pending.account ? "Verifying your Spotify account..." : "Connect Spotify to see and edit your account’s trims."}</p></section>}
    <section><h2>Local Files Folder</h2>
      <p className="muted">{localFilesFolder || (pending.folder ? "Loading folder..." : "Not set yet.")}</p>
      <button onClick={chooseFolder} disabled={fileBusy}>{pending.folder ? "Loading / choosing..." : "Choose Folder"}</button>
      <Feedback error={errors.folder} message={messages.folder} />
      {errors.folder && <button onClick={loadFolder} disabled={fileBusy}>Retry Folder Load</button>}
    </section>
    <section><h2>Download from YouTube</h2>
      <form onSubmit={download} aria-busy={!!pending.download}>
        <fieldset disabled={!!fileBusy}>
          <input aria-label="YouTube URL" placeholder="YouTube URL" type="text" value={youtubeUrl} onChange={e => setYoutubeUrl(e.target.value)} required />
          <input aria-label="Track title" placeholder="Title (used as the filename)" type="text" value={title} onChange={e => setTitle(e.target.value)} required />
          <div className="row">
            <input aria-label="Download start time" placeholder="Start (mm:ss)" type="text" value={startInput} onChange={e => setStartInput(e.target.value)} />
            <input aria-label="Download end time" placeholder="End (mm:ss)" type="text" value={endInput} onChange={e => setEndInput(e.target.value)} />
          </div>
          <p className="muted">Leave both times blank for the full song, or enter both to trim.</p>
          <button disabled={!localFilesFolder} type="submit">{pending.download ? "Downloading and processing..." : "Download & Add to Local Files"}</button>
        </fieldset>
      </form>
      {!localFilesFolder && <p className="muted">Choose a local files folder above to download.</p>}
      {pending.download && <p className="muted" role="status">Downloading and processing audio. This may take a few minutes.</p>}
      <Feedback error={errors.download} message={messages.download} />
    </section>
    <section><h2>Downloaded Tracks</h2>
      {pending.tracks && <p className="muted" role="status">Loading downloaded tracks...</p>}
      <Feedback error={errors.tracks} />
      {errors.tracks && <button onClick={loadTracks} disabled={pending.tracks}>Retry Loading Tracks</button>}
      {!pending.tracks && !errors.tracks && !localTracks.length && <p className="muted">Nothing downloaded yet.</p>}
      {localTracks.map(track => <div className="row" key={track.id} style={{ marginBottom: 8 }}>
        <span style={{ flex: 1 }}>{track.title}</span>
        <button disabled={!!fileBusy || !localFilesFolder} onClick={() => { setEditing(track); setReStart(formatTrimTime(track.start_ms ?? 0)); setReEnd(track.end_ms == null ? "" : formatTrimTime(track.end_ms)); errorAt("retrim", ""); }}>Re-trim</button>
      </div>)}
      {editing && <form className="trim-editor" onSubmit={retrim}>
        <h3>Re-trim {editing.title}</h3>
        <fieldset disabled={!!fileBusy}>
          <div className="row">
            <label>Start (mm:ss)<input type="text" value={reStart} onChange={e => setReStart(e.target.value)} required /></label>
            <label>End (mm:ss)<input type="text" value={reEnd} onChange={e => setReEnd(e.target.value)} required /></label>
          </div>
          <div className="row"><button type="submit">{pending.retrim ? "Re-trimming..." : "Save Re-trim"}</button><button type="button" onClick={() => { setEditing(null); errorAt("retrim", ""); }}>Cancel</button></div>
        </fieldset>
      </form>}
      <Feedback error={errors.retrim} message={pending.retrim ? "Processing new trim..." : messages.retrim} />
    </section>
  </div>;
}
