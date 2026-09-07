// 1. Go to https://developer.spotify.com/dashboard and create an app.
// 2. In the app settings, add this exact Redirect URI:
//      http://127.0.0.1:8888/callback
// 3. Paste your Client ID below. No client secret is needed - we use
//    Authorization Code with PKCE, which is the correct/secure flow for
//    a desktop app (a secret embedded in a desktop app isn't really secret).
module.exports = {
  CLIENT_ID: "33bc0089a187437f9602f2ffef3b79a1",
  REDIRECT_URI: "http://127.0.0.1:8888/callback",
  REDIRECT_PORT: 8888,
  SCOPES: [
    "streaming",
    "user-read-email",
    "user-read-private",
    "user-read-playback-state",
    "user-modify-playback-state",
    "playlist-read-private",
    "playlist-read-collaborative"
  ].join(" ")
};
