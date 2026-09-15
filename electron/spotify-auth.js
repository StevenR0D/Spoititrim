const http = require("node:http");
const { generateCodeVerifier, generateCodeChallenge } = require("./pkce");

// The browser and app must complete the same attempt. Ignore unrelated/stale
// requests instead of letting a favicon request close the callback listener.
function startSpotifyLogin({ clientId, redirectUri, scopes, openBrowser, exchangeCode, saveTokens, signal, timeoutMs = 300000 }) {
  return new Promise((resolve, reject) => {
    const redirect = new URL(redirectUri);
    const verifier = generateCodeVerifier();
    const state = generateCodeVerifier();
    let exchanging = false;
    let settled = false;
    let timer;
    const controller = new AbortController();
    const finish = (error, tokens) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      controller.abort();
      server.close();
      server.closeAllConnections();
      if (error) reject(error); else resolve(tokens);
    };
    const cancel = () => finish(new Error("SPOTIFY_LOGIN_CANCELLED"));
    const reply = (res, status, message) => {
      res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Connection": "close" });
      res.end(message);
    };
    const server = http.createServer(async (req, res) => {
      const callback = new URL(req.url, redirectUri);
      if (req.method !== "GET" || callback.pathname !== redirect.pathname) {
        reply(res, 404, "This address is only used to finish Spotify sign-in.");
        return;
      }
      if (callback.searchParams.get("state") !== state) {
        reply(res, 400, "This sign-in link belongs to an old or different attempt. Use the newest Spotify sign-in tab, or reconnect from Spotitrim.");
        return;
      }
      if (exchanging || settled) {
        reply(res, 409, "Sign-in is already being processed. Return to Spotitrim.");
        return;
      }
      if (callback.searchParams.has("error")) {
        reply(res, 400, "Spotify sign-in was not approved. Return to Spotitrim to try again.");
        finish(new Error("SPOTIFY_LOGIN_DENIED"));
        return;
      }
      const code = callback.searchParams.get("code");
      if (!code) {
        reply(res, 400, "Spotify did not return an authorization code. Return to Spotitrim to try again.");
        finish(new Error("SPOTIFY_LOGIN_NO_CODE"));
        return;
      }
      exchanging = true;
      try {
        const tokens = await exchangeCode(code, verifier, controller.signal);
        if (settled) return;
        if (!tokens?.access_token || !Number.isFinite(tokens.expires_in)) throw new Error("SPOTIFY_LOGIN_TOKEN_FAILED");
        try { saveTokens(tokens); }
        catch { throw new Error("SPOTIFY_LOGIN_STORAGE_FAILED"); }
        reply(res, 200, "Spotify connected successfully. You can close this tab and return to Spotitrim.");
        // Let the response flush before closing active sockets.
        res.on("finish", () => finish(null, tokens));
      } catch (error) {
        if (settled) return;
        reply(res, 502, "Could not finish Spotify sign-in. Return to Spotitrim for details and try again.");
        res.on("finish", () => finish(error));
      }
    });
    server.on("error", error => finish(new Error(error.code === "EADDRINUSE" ? "SPOTIFY_LOGIN_PORT_BUSY" : "SPOTIFY_LOGIN_LISTENER_FAILED")));
    if (signal?.aborted) { cancel(); return; }
    signal?.addEventListener("abort", cancel, { once: true });
    server.listen({ port: Number(redirect.port), host: redirect.hostname, signal: controller.signal }, () => {
      if (settled) return;
      const authorization = new URL("https://accounts.spotify.com/authorize");
      authorization.search = new URLSearchParams({
        client_id: clientId, response_type: "code", redirect_uri: redirectUri,
        code_challenge_method: "S256", code_challenge: generateCodeChallenge(verifier), scope: scopes, state,
      }).toString();
      timer = setTimeout(() => finish(new Error(exchanging ? "SPOTIFY_LOGIN_TOKEN_TIMEOUT" : "SPOTIFY_LOGIN_CALLBACK_TIMEOUT")), timeoutMs);
      Promise.resolve().then(() => { if (!settled) return openBrowser(authorization.toString()); }).catch(() => finish(new Error("SPOTIFY_LOGIN_BROWSER_FAILED")));
    });
  });
}

module.exports = { startSpotifyLogin };
