const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const http = require("http");
const url = require("url");
const Store = require("electron-store");

const { CLIENT_ID, REDIRECT_URI, REDIRECT_PORT, SCOPES } = require("./config");
const { generateCodeVerifier, generateCodeChallenge } = require("./pkce");
const db = require("./db");
const downloader = require("./downloader");

// electron-store is just a small JSON-file wrapper (separate from SQLite) -
// good fit for a handful of secrets/tokens, not for anything you'd want to
// query. SQLite (db.js) handles the actual song/trim data.
const tokenStore = new Store({ name: "auth-tokens" });

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true, // renderer can't touch Node directly - only
      nodeIntegration: false, // whatever we explicitly expose in preload.js
    },
  });

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

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// ---------------------------------------------------------------------------
// Spotify OAuth - Authorization Code with PKCE
//
// Flow:
// 1. Generate a random `verifier` + its hashed `challenge`.
// 2. Open the system browser to Spotify's /authorize page, sending the
//    challenge (not the verifier - the verifier never leaves this app yet).
// 3. Spin up a tiny local HTTP server on 127.0.0.1:8888 just long enough to
//    catch the redirect Spotify sends back with a `code`.
// 4. Exchange that code + the original verifier for real tokens. Spotify
//    checks that hashing our verifier matches the challenge we sent in step
//    2 - proving this token exchange is coming from the same app that
//    started the flow, without ever needing a client secret.
// ---------------------------------------------------------------------------
function startOAuthFlow() {
  return new Promise((resolve, reject) => {
    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier);

    const authUrl = new url.URL("https://accounts.spotify.com/authorize");
    authUrl.searchParams.set("client_id", CLIENT_ID);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
    authUrl.searchParams.set("code_challenge_method", "S256");
    authUrl.searchParams.set("code_challenge", challenge);
    authUrl.searchParams.set("scope", SCOPES);

    const server = http.createServer(async (req, res) => {
      const parsed = new url.URL(req.url, REDIRECT_URI);
      const code = parsed.searchParams.get("code");
      const error = parsed.searchParams.get("error");

      res.end(
        error
          ? "Login failed - you can close this window."
          : "Login successful - you can close this window and go back to the app."
      );
      server.close();

      if (error) {
        reject(new Error(error));
        return;
      }

      try {
        const tokens = await exchangeCodeForTokens(code, verifier);
        tokenStore.set("tokens", {
          ...tokens,
          obtained_at: Date.now(),
        });
        resolve(tokens);
      } catch (err) {
        reject(err);
      }
    });

    server.listen(REDIRECT_PORT, "127.0.0.1", () => {
      shell.openExternal(authUrl.toString());
    });
  });
}

async function exchangeCodeForTokens(code, verifier) {
  const body = new url.URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    code_verifier: verifier,
  });

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    throw new Error(`Token exchange failed: ${await response.text()}`);
  }

  return response.json(); // { access_token, refresh_token, expires_in, ... }
}

async function refreshAccessToken(refreshToken) {
  const body = new url.URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: CLIENT_ID,
  });

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
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
async function getValidAccessToken() {
  const stored = tokenStore.get("tokens");
  if (!stored) return null;

  const ageMs = Date.now() - stored.obtained_at;
  const expiresMs = stored.expires_in * 1000;
  const stillValid = ageMs < expiresMs - 60_000;

  if (stillValid) return stored.access_token;
  if (!stored.refresh_token) return null;

  const refreshed = await refreshAccessToken(stored.refresh_token);
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
ipcMain.handle("spotify:login", async () => {
  await startOAuthFlow();
  return true;
});

ipcMain.handle("spotify:get-access-token", async () => {
  return getValidAccessToken();
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

ipcMain.handle("trim:save", async (event, { spotifyTrackId, trackName, startMs, endMs }) => {
  db.upsertTrimPoint(spotifyTrackId, trackName, startMs, endMs);
  return true;
});

ipcMain.handle("trim:get-all", async () => {
  return db.getAllTrimPoints();
});

ipcMain.handle("trim:delete", async (event, spotifyTrackId) => {
  if (typeof spotifyTrackId !== "string" || !spotifyTrackId.trim()) {
    throw new Error("A Spotify track ID is required.");
  }
  db.deleteTrimPoint(spotifyTrackId);
  return true;
});

ipcMain.handle("local-tracks:get-all", async () => {
  return db.getAllLocalTracks();
});

ipcMain.handle("download:start", async (event, { youtubeUrl, title, startMs, endMs }) => {
  const localFilesFolder = db.getSetting("local_files_folder");
  if (!localFilesFolder) {
    throw new Error("Set your Spotify local files folder in settings first.");
  }
  return downloader.downloadAndProcess({ youtubeUrl, title, startMs, endMs, localFilesFolder });
});

ipcMain.handle("download:retrim", async (event, { trackId, startMs, endMs }) => {
  const localFilesFolder = db.getSetting("local_files_folder");
  if (!localFilesFolder) {
    throw new Error("Set your Spotify local files folder in settings first.");
  }
  return downloader.retrimExistingTrack({ trackId, startMs, endMs, localFilesFolder });
});
