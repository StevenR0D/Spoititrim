const crypto = require("crypto");

// PKCE requires a random "verifier" string, and a "challenge" that's a
// hashed version of it. We send the challenge to Spotify up front, then
// prove we hold the original verifier when exchanging the code for tokens.
// This is what lets a desktop app do OAuth safely without a client secret.

function base64url(buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function generateCodeVerifier() {
  return base64url(crypto.randomBytes(32));
}

function generateCodeChallenge(verifier) {
  const hash = crypto.createHash("sha256").update(verifier).digest();
  return base64url(hash);
}

module.exports = { generateCodeVerifier, generateCodeChallenge };
