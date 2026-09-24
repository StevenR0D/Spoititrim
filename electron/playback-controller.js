// Poll Spotify, then enforce the saved range against that fresh observation.
// Never send commands using a locally estimated position alone.
function createPlaybackController({ session, getToken, getTrim, fetchImpl = fetch, now = Date.now }) {
  let enabled = true;
  let generation = 0;
  let pending = null;
  let aborter = null;
  let cycle = null;
  let lastPlayback = null;
  let blockedUntil = 0;
  let failures = 0;
  let lastError = null;

  function reset() {
    generation++;
    aborter?.abort();
    cycle = null;
    lastPlayback = null;
    if (lastError?.status !== 429) { blockedUntil = 0; lastError = null; }
    failures = 0;
  }

  function setEnabled(accountId, value) {
    session.require(accountId);
    if (typeof value !== "boolean") throw new Error("Automatic trims must be on or off.");
    if (enabled !== value) { enabled = value; reset(); }
    return enabled;
  }

  function failure(message, status = 0, retryMs = 0) {
    return Object.assign(new Error(message), { status, retryMs });
  }

  function reply(playback, message, nextPollMs = enabled && playback?.is_playing ? 1000 : 5000, error = null) {
    return { playback, enabled, message, nextPollMs, error,
      retryAt: blockedUntil > now() ? blockedUntil : null,
      needsReconnect: error?.status === 401 };
  }

  function poll(accountId) {
    session.require(accountId);
    const revision = session.revision();
    const version = generation;
    const key = `${accountId}:${revision}:${version}`;
    if (pending?.key === key) return pending.promise;
    const controller = new AbortController();
    aborter = controller;
    const assertCurrent = () => {
      session.require(accountId);
      if (revision !== session.revision() || version !== generation || controller.signal.aborted) {
        throw failure("Playback check cancelled.", -1);
      }
    };

    async function request(path, method = "GET", refreshed = false, beforeSend = () => {}) {
      assertCurrent();
      if (blockedUntil > now()) throw failure("Waiting before checking Spotify again.", 429, blockedUntil - now());
      let token;
      try { token = await getToken(refreshed); }
      catch { assertCurrent(); throw failure("Your Spotify session could not be refreshed. Reconnect Spotify.", 401); }
      assertCurrent();
      if (!token) throw failure("Connect Spotify to monitor playback.", 401);
      beforeSend();
      const response = await fetchImpl(`https://api.spotify.com/v1/me/player${path}`, {
        method, headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
      });
      assertCurrent();
      if (response.status === 401 && !refreshed) return request(path, method, true, beforeSend);
      if (response.status === 429) {
        const seconds = Number(response.headers.get("Retry-After"));
        const retryMs = Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds * 1000) : 30000;
        blockedUntil = now() + retryMs;
        throw failure("Spotify has limited requests. Automatic checks will resume after its waiting period.", 429, retryMs);
      }
      if (response.status === 401) throw failure("Spotify authorization expired. Reconnect Spotify.", 401);
      if (response.status === 403) throw failure("Spotify denied playback control. Check Premium, app access, and reconnect to grant playback permissions.", 403);
      if (response.status === 404) throw failure("No controllable Spotify device is available. Open Spotify and play a song on your phone or computer.", 404);
      if (!response.ok) throw failure(`Spotify is temporarily unavailable (${response.status}).`, response.status);
      // Control endpoints may succeed with an empty 200 or 204 response.
      if (method !== "GET" || response.status === 204) return null;
      const data = await response.json();
      assertCurrent();
      return data;
    }

    async function run() {
      try {
        assertCurrent();
        if (blockedUntil > now()) return reply(lastPlayback, "Waiting to retry Spotify.", blockedUntil - now(), lastError);
        const playback = await request("");
        assertCurrent();
        lastPlayback = playback;
        if (!playback) {
          cycle = null;
          failures = 0; lastError = null;
          return reply(null, "Open Spotify and start music on the same account.");
        }
        playback.observedAt = now();
        const track = playback.item;
        const trackId = track?.linked_from?.id || track?.id;
        const isTrack = track?.type === "track" && !track.is_local;
        playback.trim = isTrack && trackId ? getTrim(accountId, trackId) || null : null;
        const position = playback.progress_ms;
        const trim = playback.trim;
        const key = `${track?.id}:${playback.device?.id}:${playback.context?.uri || ""}`;
        if (!cycle || cycle.key !== key) cycle = { key, seekSent: false, skipSent: false, lastPosition: position, seekConfirmed: false };
        // A confirmed rewind/repeat is a new pass through the same song.
        // Do not confuse stale pre-seek observations with a replay.
        if (Number.isFinite(position) && Number.isFinite(cycle.lastPosition) && position + 1500 < cycle.lastPosition &&
            (!cycle.seekSent || cycle.seekConfirmed) && (!cycle.skipSent || now() - cycle.skipAt > 3000)) {
          cycle = { key, seekSent: false, skipSent: false, lastPosition: position, seekConfirmed: false };
        }
        if (cycle.seekSent && position >= cycle.seekTarget - 250) {
          cycle.seekConfirmed = true;
          if (!cycle.skipSent) cycle.commandError = null;
        }
        cycle.lastPosition = position;
        const trimKey = trim ? `${trim.start_ms}:${trim.end_ms}` : "";
        if (cycle.trimKey !== trimKey) { cycle.trimKey = trimKey; cycle.seekSent = false; cycle.seekConfirmed = false; }
        failures = 0; lastError = null;
        if (!enabled) return reply(playback, "Automatic trims are off.");
        if (!isTrack) return reply(playback, "Automatic trims apply to Spotify catalog songs only.");
        if (!trim) return reply(playback, "No saved trim — playing normally.");
        if (!Number.isSafeInteger(trim.start_ms) || !Number.isSafeInteger(trim.end_ms) || trim.start_ms < 0 || trim.end_ms <= trim.start_ms ||
            (Number.isFinite(track.duration_ms) && trim.end_ms > track.duration_ms)) {
          return reply(playback, "Edit this trim: its saved range is outside the song’s duration.");
        }
        if (!playback.is_playing) return reply(playback, "Paused — trim control will resume with playback.");
        if (!Number.isFinite(position) || position < 0) return reply(playback, "Waiting for Spotify’s playback position.");
        if (!playback.device?.id || playback.device.is_restricted) return reply(playback, "This device cannot be controlled. Play on another Spotify device.");

        let action = null;
        if (position >= trim.end_ms && !cycle.skipSent) action = "skip";
        else if (position < trim.start_ms - 250 && !cycle.seekSent && !cycle.skipSent) action = "seek";
        const disallows = playback.actions?.disallows || {};
        if (action && disallows[action === "seek" ? "seeking" : "skipping_next"]) return reply(playback, `Spotify currently prevents ${action === "seek" ? "seeking" : "skipping"} on this playback.`);
        if (action) {
          const actedCycle = cycle;
          if (action === "seek") { cycle.seekSent = true; cycle.seekTarget = trim.start_ms; }
          else { cycle.skipSent = true; cycle.skipAt = now(); }
          const params = new URLSearchParams({ device_id: playback.device.id });
          if (action === "seek") params.set("position_ms", String(trim.start_ms));
          try {
            await request(`/${action === "seek" ? "seek" : "next"}?${params}`, action === "seek" ? "PUT" : "POST", false, () => {
              // Recheck after token refresh too, immediately before dispatch.
              assertCurrent();
              const latest = getTrim(accountId, trackId);
              if (!latest || latest.start_ms !== trim.start_ms || latest.end_ms !== trim.end_ms || now() - playback.observedAt > 2000) {
                throw failure("Playback or trim changed — checking again.", -2);
              }
            });
            assertCurrent();
            return reply(playback, action === "seek" ? "Requested saved start — waiting for Spotify to confirm." : "Reached saved end — requested next song.", 1000);
          } catch (error) {
            if (error.status === -2) {
              if (action === "seek") actedCycle.seekSent = false; else actedCycle.skipSent = false;
              return reply(playback, error.message, 750);
            }
            // 429 explicitly rejected the command, so retry after Retry-After.
            // Timeouts/5xx may have applied it: never blindly send next twice.
            if (error.status === 429 || error.status === 404) {
              if (action === "seek") actedCycle.seekSent = false; else actedCycle.skipSent = false;
            } else {
              actedCycle.commandError = "Could not confirm the playback command. It will not be repeated for this pass through the song. Toggle automatic trims off/on to retry.";
            }
            throw error;
          }
        }
        const delay = Math.max(750, Math.min(1000, trim.end_ms - position));
        return reply(playback, cycle.commandError || (cycle.skipSent ? "Waiting for the next song." : cycle.seekSent && !cycle.seekConfirmed ? "Waiting for Spotify to confirm the start position." : "Automatic trim active."), cycle.skipSent ? 1000 : delay);
      } catch (error) {
        if (version !== generation || revision !== session.revision() || controller.signal.aborted) return reply(null, "Playback check cancelled.");
        failures++;
        const status = error.status || 0;
        const message = status ? error.message : "Could not reach Spotify. Check your connection; playback checks will retry automatically.";
        const delay = error.retryMs || (status === 401 || status === 403 ? 60000 : Math.min(30000, 2000 * 2 ** Math.min(failures - 1, 4)));
        blockedUntil = Math.max(blockedUntil, now() + delay);
        lastError = { message, status };
        return reply(lastPlayback, "Playback control is waiting for Spotify.", delay, lastError);
      }
    }
    const entry = { key, promise: null };
    entry.promise = run().finally(() => { if (pending === entry) pending = null; });
    pending = entry;
    return entry.promise;
  }
  return { poll, reset, setEnabled };
}

module.exports = { createPlaybackController };
