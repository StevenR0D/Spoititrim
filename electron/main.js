const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const url = require("url");
const Store = require("electron-store");

const { CLIENT_ID, REDIRECT_URI, SCOPES } = require("./config");
const { startSpotifyLogin } = require("./spotify-auth");
const db = require("./db");
const downloader = require("./downloader");

// electron-store is just a small JSON-file wrapper (separate from SQLite) -
// good fit for a handful of secrets/tokens, not for anything you'd want to
// query. SQLite (db.js) handles the actual song/trim data.
const tokenStore = new Store({ name: "auth-tokens" });

const accountSession = require("./account-session").createAccountSession(() => playbackController.reset());
const playbackController = require("./playback-controller").createPlaybackController({
  session: accountSession,
  getToken: getValidAccessToken,
  getTrim: db.getTrimPoint,
});
let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true, // renderer can't touch Node directly - only
      nodeIntegration: false, // whatever we explicitly expose in preload.js
      backgroundThrottling: false, // Keep checking while minimized (computer must be awake).
    },
  });
  mainWindow.on("closed", () => playbackController.reset());

  if (process.env.NODE_ENV === "development") {
  const loadDevServer = () => {
    mainWindow.loadURL("http://127.0.0.1:5173").catch(() => {
      console.log("Dev server not ready yet, retrying in 1s...");
      setTimeout(loadDevServer, 1000);
    });
  };
  loadDevServer();
  mainWindow.webContents.openDevTools();
} else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

// A second process could receive the callback while the visible window waits.
// Keep one app instance and bring its window forward on subsequent launches.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow || mainWindow.isDestroyed()) createWindow();
    else { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); }
  });
  app.whenReady().then(() => {
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// ---------------------------------------------------------------------------
// Spotify OAuth - Authorization Code with PKCE
//
// Flow:
// 1. Generate a random `verifier` + its hashed `challenge`.
// 2. Start the local callback listener on 127.0.0.1:8888.
// 3. Open Spotify in the browser with the challenge and an attempt-specific
//    state value; only the matching callback can finish this attempt.
// 4. Exchange that code + the original verifier for real tokens. Spotify
//    checks that hashing our verifier matches the challenge we sent in step
//    2 - proving this token exchange is coming from the same app that
//    started the flow, without ever needing a client secret.
// ---------------------------------------------------------------------------
function startOAuthFlow(signal) {
  return startSpotifyLogin({
    signal,
    clientId: CLIENT_ID,
    redirectUri: REDIRECT_URI,
    scopes: SCOPES,
    openBrowser: address => shell.openExternal(address),
    exchangeCode: exchangeCodeForTokens,
    saveTokens: tokens => tokenStore.set("tokens", { ...tokens, obtained_at: Date.now() }),
  });
}

async function exchangeCodeForTokens(code, verifier, signal) {
  const body = new url.URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    code_verifier: verifier,
  });

  let response;
  try {
    response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!response.ok) throw new Error("SPOTIFY_LOGIN_TOKEN_FAILED");
    return await response.json();
  } catch (error) {
    if (error.name === "TimeoutError") throw new Error("SPOTIFY_LOGIN_TOKEN_TIMEOUT");
    if (error.message === "SPOTIFY_LOGIN_TOKEN_FAILED") throw error;
    throw new Error("SPOTIFY_LOGIN_NETWORK_FAILED");
  }
}

async function refreshAccessToken(refreshToken) {
  const body = new url.URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: CLIENT_ID,
  });

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    signal: AbortSignal.timeout(30000),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    throw new Error(`Token refresh failed: ${await response.text()}`);
  }

  return response.json();
}

// Returns a valid access token, refreshing first if the stored one has
// expired. `expires_in` is in seconds; we subtract a small buffer so we
// refresh a little before it actually expires rather than right at the edge.
async function getValidAccessToken(forceRefresh = false) {
  const revision = accountSession.revision();
  const stored = tokenStore.get("tokens");
  if (!stored) return null;

  const ageMs = Date.now() - stored.obtained_at;
  const expiresMs = stored.expires_in * 1000;
  const stillValid = ageMs < expiresMs - 60_000;

  if (stillValid && !forceRefresh) return stored.access_token;
  if (!stored.refresh_token) return null;

  const refreshed = await refreshAccessToken(stored.refresh_token);
  if (revision !== accountSession.revision()) throw new Error("Spotify account changed. Try again.");
  const merged = {
    ...stored,
    ...refreshed,
    // Spotify doesn't always return a new refresh_token on refresh - keep
    // the old one if a new one wasn't sent back.
    refresh_token: refreshed.refresh_token || stored.refresh_token,
    obtained_at: Date.now(),
  };
  tokenStore.set("tokens", merged);
  return merged.access_token;
}

// --- IPC handlers: these are the only ways the renderer (React) can reach
// into the main process. Nothing here is exposed directly - see preload.js
// for the whitelist of functions the UI is actually allowed to call.
let loginPromise;
let loginAttempt;
ipcMain.handle("spotify:login", async () => {
  if (!loginPromise) {
    if (loginAttempt) throw new Error("Finish the current connection attempt first.");
    accountSession.clear();
    const attempt = { controller: new AbortController(), previousTokens: tokenStore.get("tokens") };
    loginAttempt = attempt;
    loginPromise = startOAuthFlow(attempt.controller.signal)
      .catch(error => { if (loginAttempt === attempt) loginAttempt = null; throw error; })
      .finally(() => { loginPromise = null; });
  }
  await loginPromise;
  return true;
});

ipcMain.handle("spotify:cancel-login", async () => {
  const attempt = loginAttempt;
  if (!attempt) return false;
  loginAttempt = null;
  attempt.controller.abort();
  accountSession.clear();
  // Cancelling account switching must not replace the previous saved login.
  if (attempt.previousTokens) tokenStore.set("tokens", attempt.previousTokens);
  else tokenStore.delete("tokens");
  await loginPromise?.catch(() => {});
  return true;
});

ipcMain.handle("spotify:get-access-token", async (event, expectedAccountId) => {
  accountSession.require(expectedAccountId);
  const token = await getValidAccessToken();
  accountSession.require(expectedAccountId);
  return token;
});

ipcMain.handle("spotify:get-playback", (event, accountId) => playbackController.poll(accountId));
ipcMain.handle("spotify:set-automatic-trims", (event, accountId, enabled) =>
  playbackController.setEnabled(accountId, enabled));

ipcMain.handle("spotify:get-account", async () => {
  if (loginPromise) throw new Error("Finish connecting to Spotify first.");
  const attempt = loginAttempt;
  const revision = accountSession.clear();
  try {
    const token = await getValidAccessToken();
    if (attempt?.controller.signal.aborted) throw new Error("SPOTIFY_LOGIN_CANCELLED");
    if (!token) return null;
    const response = await fetch("https://api.spotify.com/v1/me", {
      headers: { Authorization: `Bearer ${token}` },
      signal: attempt ? AbortSignal.any([attempt.controller.signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error("Could not verify your Spotify account. Reconnect or try again.");
    return accountSession.verify(revision, await response.json());
  } catch (error) {
    if (attempt?.controller.signal.aborted) throw new Error("SPOTIFY_LOGIN_CANCELLED");
    throw error;
  } finally {
    if (loginAttempt === attempt) loginAttempt = null;
  }
});

ipcMain.handle("spotify:logout", () => {
  if (loginPromise) throw new Error("Wait for the connection attempt to finish first.");
  accountSession.clear();
  tokenStore.delete("tokens");
});

ipcMain.handle("settings:choose-local-files-folder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const folder = result.filePaths[0];
  db.setSetting("local_files_folder", folder);
  return folder;
});

ipcMain.handle("settings:get-local-files-folder", async () => {
  return db.getSetting("local_files_folder");
});

ipcMain.handle("trim:save", async (event, { accountId, spotifyTrackId, trackName, startMs, endMs, imageUrl, artistName }) => {
  validateTrim(startMs, endMs);
  if (typeof spotifyTrackId !== "string" || !spotifyTrackId.trim()) throw new Error("Select a Spotify track first.");
  db.upsertTrimPoint(accountSession.require(accountId), spotifyTrackId, trackName, startMs, endMs, validArtwork(imageUrl), typeof artistName === "string" ? artistName : null);
  return true;
});

function validArtwork(value) {
  try { return new URL(value).protocol === "https:" ? value : null; } catch { return null; }
}

ipcMain.handle("trim:get-metadata", async (event, { accountId, trackId }) => {
  const owner = accountSession.require(accountId);
  const trim = db.getTrimPoint(owner, trackId);
  if (!trim) return null;
  if (trim.image_url && trim.artist_name != null) return { imageUrl: trim.image_url, artistName: trim.artist_name };
  const token = await getValidAccessToken();
  if (!token) return null;
  const response = await fetch(`https://api.spotify.com/v1/tracks/${encodeURIComponent(trackId)}`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) return null;
  const track = await response.json();
  const imageUrl = validArtwork(track.album?.images?.[0]?.url);
  accountSession.require(accountId);
  const artistName = track.artists?.map(artist => artist.name).join(", ") || "";
  db.setTrimMetadata(owner, trackId, imageUrl, artistName);
  return { imageUrl, artistName };
});

ipcMain.handle("trim:get-all", async (event, accountId) => {
  return db.getAllTrimPoints(accountSession.require(accountId));
});

ipcMain.handle("trim:delete", async (event, { accountId, spotifyTrackId }) => {
  if (typeof spotifyTrackId !== "string" || !spotifyTrackId.trim()) {
    throw new Error("A Spotify track ID is required.");
  }
  db.deleteTrimPoint(accountSession.require(accountId), spotifyTrackId);
  return true;
});

ipcMain.handle("trim:has-legacy", (event, accountId) => {
  accountSession.require(accountId);
  return db.hasLegacyTrims();
});
ipcMain.handle("trim:import-legacy", (event, accountId) => {
  db.importLegacyTrims(accountSession.require(accountId));
});

ipcMain.handle("local-tracks:get-all", async () => {
  return db.getAllLocalTracks();
});

function validateTrim(startMs, endMs, optional = false) {
  if (optional && startMs == null && endMs == null) return;
  if (!Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs) || startMs < 0 || endMs <= startMs) {
    throw new Error("Enter valid start and end times, with the end after the start.");
  }
}

ipcMain.handle("download:start", async (event, { youtubeUrl, title, startMs, endMs }) => {
  validateTrim(startMs, endMs, true);
  const parsed = new URL(youtubeUrl);
  if (!["http:", "https:"].includes(parsed.protocol) || !["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"].includes(parsed.hostname)) throw new Error("Enter a valid YouTube URL.");
  if (typeof title !== "string" || !title.trim() || title.length > 180 || /[\\/:*?"<>|\x00-\x1f]/.test(title)) throw new Error("Enter a valid filename title.");
  const localFilesFolder = db.getSetting("local_files_folder");
  if (!localFilesFolder) {
    throw new Error("Set your Spotify local files folder in settings first.");
  }
  return downloader.downloadAndProcess({ youtubeUrl, title, startMs, endMs, localFilesFolder });
});

ipcMain.handle("download:retrim", async (event, { trackId, startMs, endMs }) => {
  validateTrim(startMs, endMs);
  const localFilesFolder = db.getSetting("local_files_folder");
  if (!localFilesFolder) {
    throw new Error("Set your Spotify local files folder in settings first.");
  }
  return downloader.retrimExistingTrack({ trackId, startMs, endMs, localFilesFolder });
});
