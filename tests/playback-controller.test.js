const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlaybackController } = require('../electron/playback-controller');
const { createAccountSession } = require('../electron/account-session');

function setup() {
  const state = {
    time: 100000, calls: [], tokens: [], trim: { start_ms: 10000, end_ms: 30000 },
    playback: { item: { id: 'song', type: 'track', duration_ms: 60000 },
      device: { id: 'phone' }, is_playing: true, progress_ms: 0 },
  };
  const session = createAccountSession(() => controller.reset());
  const controller = createPlaybackController({
    session, now: () => state.time,
    getToken: async force => { state.tokens.push(force); await state.tokenHook?.(); return 'token'; },
    getTrim: (account, track) => { assert.equal(account, 'A'); state.lookup = track; return state.trim; },
    fetchImpl: async (url, options) => {
      state.calls.push({ url, ...options });
      if (state.fetchHook) return state.fetchHook(url, options);
      return options.method === 'GET'
        ? new Response(JSON.stringify(state.playback)) : new Response(null, { status: 204 });
    },
  });
  session.verify(session.revision(), { account_id: 'A' });
  return { state, session, controller, poll: () => controller.poll('A'),
    commands: () => state.calls.filter(call => call.method !== 'GET') };
}

test('seeks to the saved start on the observed device, suppresses stale duplicate observations', async () => {
  const h = setup();
  await h.poll(); await h.poll();
  assert.equal(h.commands().length, 1);
  const call = h.commands()[0];
  assert.equal(call.method, 'PUT');
  assert.equal(new URL(call.url).searchParams.get('position_ms'), '10000');
  assert.equal(new URL(call.url).searchParams.get('device_id'), 'phone');
});

test('skips exactly once at the end; replays and new songs can be controlled again', async () => {
  const h = setup(); h.state.playback.progress_ms = 30000;
  await h.poll(); await h.poll();
  assert.equal(h.commands().length, 1);
  assert.equal(h.commands()[0].method, 'POST');
  h.state.time += 4000; h.state.playback.progress_ms = 0;
  await h.poll(); assert.equal(h.commands().length, 2);
  h.state.playback.item.id = 'another';
  await h.poll(); assert.equal(h.commands().length, 3);
});

test('confirmed seek followed by manual rewind starts a new pass', async () => {
  const h = setup(); await h.poll();
  h.state.playback.progress_ms = 11000; await h.poll();
  h.state.playback.progress_ms = 0; await h.poll();
  assert.equal(h.commands().length, 2);
});

for (const [name, change] of [
  ['paused', s => { s.playback.is_playing = false; }],
  ['no trim', s => { s.trim = null; }],
  ['inside range', s => { s.playback.progress_ms = 15000; }],
  ['invalid range', s => { s.trim.end_ms = 5000; }],
  ['range beyond duration', s => { s.trim.end_ms = 90000; }],
  ['local track', s => { s.playback.item.is_local = true; }],
  ['episode', s => { s.playback.item.type = 'episode'; }],
  ['restricted device', s => { s.playback.device.is_restricted = true; }],
  ['missing device', s => { s.playback.device = null; }],
  ['disallowed seek', s => { s.playback.actions = { disallows: { seeking: true } }; }],
]) test(`does not send commands: ${name}`, async () => {
  const h = setup(); change(h.state); await h.poll(); assert.equal(h.commands().length, 0);
});

test('on/off switch stops enforcement and switching devices uses the new device', async () => {
  const h = setup(); h.controller.setEnabled('A', false); await h.poll();
  assert.equal(h.commands().length, 0);
  h.controller.setEnabled('A', true); await h.poll();
  h.state.playback.device.id = 'laptop'; await h.poll();
  assert.equal(new URL(h.commands()[1].url).searchParams.get('device_id'), 'laptop');
});

test('concurrent polls share one request and one command', async () => {
  const h = setup(); await Promise.all([h.poll(), h.poll(), h.poll()]);
  assert.equal(h.state.calls.length, 2);
});

test('account changes abort stale work before a command is sent', async () => {
  const h = setup();
  h.state.fetchHook = async () => {
    h.session.clear(); h.session.verify(h.session.revision(), { account_id: 'B' });
    return new Response(JSON.stringify(h.state.playback));
  };
  await h.poll(); assert.equal(h.commands().length, 0);
  assert.throws(() => h.poll(), /correct Spotify account/);
});

test('trim edits during token acquisition prevent stale commands', async () => {
  const h = setup();
  h.state.tokenHook = () => { if (h.state.tokens.length === 2) h.state.trim = { start_ms: 12000, end_ms: 30000 }; };
  await h.poll(); assert.equal(h.commands().length, 0);
  await h.poll(); assert.equal(h.commands().length, 1);
  assert.equal(new URL(h.commands()[0].url).searchParams.get('position_ms'), '12000');
});

test('slow token retrieval requires a fresh playback observation before control', async () => {
  const h = setup();
  h.state.tokenHook = () => { h.state.time += 3000; };
  await h.poll(); assert.equal(h.commands().length, 0);
});

test('429 respects Retry-After, including toggling off/on, then retries rejected command', async () => {
  const h = setup(); let rejected = false;
  h.state.fetchHook = async (url, options) => {
    if (options.method === 'GET') return new Response(JSON.stringify(h.state.playback));
    if (!rejected) { rejected = true; return new Response(null, { status: 429, headers: { 'Retry-After': '10' } }); }
    return new Response(null, { status: 204 });
  };
  const result = await h.poll(); assert.equal(result.nextPollMs, 10000);
  h.controller.setEnabled('A', false); h.controller.setEnabled('A', true);
  await h.poll(); assert.equal(h.state.calls.length, 2);
  h.state.time += 10000; await h.poll(); assert.equal(h.commands().length, 2);
});

test('ambiguous skip failure is not blindly retried', async () => {
  const h = setup(); h.state.playback.progress_ms = 30000;
  h.state.fetchHook = async (url, options) => {
    if (options.method !== 'GET') throw new Error('Connection lost after sending');
    return new Response(JSON.stringify(h.state.playback));
  };
  const result = await h.poll(); assert.match(result.error.message, /connection/);
  h.state.time += 30000; const next = await h.poll();
  assert.equal(h.commands().length, 1); assert.match(next.message, /not be repeated/);
});

test('401 refreshes once, persistent 401 asks for reconnect', async () => {
  const h = setup(); h.state.fetchHook = async () => new Response(null, { status: 401 });
  const result = await h.poll();
  assert.deepEqual(h.state.tokens, [false, true]);
  assert.equal(result.needsReconnect, true);
});

test('no active playback returns a friendly status', async () => {
  const h = setup(); h.state.fetchHook = async () => new Response(null, { status: 204 });
  const result = await h.poll(); assert.equal(result.playback, null); assert.equal(result.error, null);
});

test('successful empty 200 control responses are accepted', async () => {
  const h = setup();
  h.state.fetchHook = async (url, options) => options.method === 'GET'
    ? new Response(JSON.stringify(h.state.playback)) : new Response(null, { status: 200 });
  const result = await h.poll(); assert.equal(result.error, null);
  assert.match(result.message, /Requested saved start/);
});

test('later seek confirmation clears an ambiguous command warning', async () => {
  const h = setup();
  h.state.fetchHook = async (url, options) => {
    if (options.method !== 'GET') throw new Error('Lost response');
    return new Response(JSON.stringify(h.state.playback));
  };
  await h.poll(); h.state.time += 30000; h.state.playback.progress_ms = 11000;
  const result = await h.poll(); assert.equal(result.message, 'Automatic trim active.');
});

test('poll interval shortens near the end and relinked track uses original ID', async () => {
  const h = setup(); h.state.playback.progress_ms = 29000;
  h.state.playback.item.linked_from = { id: 'original' };
  const result = await h.poll(); assert.equal(result.nextPollMs, 1000); assert.equal(h.state.lookup, 'original');
});
