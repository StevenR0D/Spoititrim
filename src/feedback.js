// Only expose actionable messages, never raw IPC errors or command output.
export function friendlyError(error, fallback) {
  const message = error?.message || "";
  const loginErrors = {
    SPOTIFY_LOGIN_CALLBACK_TIMEOUT: "Spotify did not return to the app. Finish sign-in in your browser. If Spotify shows Invalid redirect URI, register http://127.0.0.1:8888/callback in your Spotify app settings, then reconnect.",
    SPOTIFY_LOGIN_PORT_BUSY: "Another app or Spotitrim window is using the Spotify callback port (8888). Close the other instance and reconnect.",
    SPOTIFY_LOGIN_LISTENER_FAILED: "Could not start the local Spotify callback listener. Restart Spotitrim and try again.",
    SPOTIFY_LOGIN_BROWSER_FAILED: "Could not open your browser. Open your browser and choose a profile, then try connecting again.",
    SPOTIFY_LOGIN_DENIED: "Spotify sign-in was cancelled or denied. Reconnect and approve access to finish signing in.",
    SPOTIFY_LOGIN_NO_CODE: "Spotify returned without a sign-in code. Start a new connection attempt.",
    SPOTIFY_LOGIN_TOKEN_TIMEOUT: "Spotify returned to the app, but exchanging the sign-in code timed out. Check your connection and reconnect.",
    SPOTIFY_LOGIN_TOKEN_FAILED: "Spotify rejected the sign-in code. Reconnect using the newest browser tab and check that the Client ID and redirect URI match your Spotify app settings.",
    SPOTIFY_LOGIN_STORAGE_FAILED: "Spotify approved sign-in, but the app could not save your session. Check disk space and app-data folder permissions, then reconnect.",
    SPOTIFY_LOGIN_NETWORK_FAILED: "Could not reach Spotify to finish signing in. Check your internet connection and reconnect.",
  };
  const loginCode = Object.keys(loginErrors).find(code => message.includes(code));
  if (loginCode) return loginErrors[loginCode];
  if (/ENOENT|Failed to run/.test(message)) return "A required file or tool is missing. Check that yt-dlp and ffmpeg are installed and the original audio is available.";
  if (/EACCES|EPERM/.test(message)) return "Cannot access this folder. Choose a folder you have permission to write to.";
  if (/ENOSPC/.test(message)) return "There is not enough disk space. Free some space and try again.";
  if (/timed out|timeout/i.test(message)) return "The operation timed out. Check your connection and try again.";
  return fallback;
}
