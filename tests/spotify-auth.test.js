const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startSpotifyLogin } = require('../electron/spotify-auth');

async function port() {
  const server = http.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const value = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return value;
}
async function begin(overrides = {}) {
  const redirectUri = `http://127.0.0.1:${await port()}/callback`;
  let opened;
  const ready = new Promise(resolve => { opened = resolve; });
  const promise = startSpotifyLogin({clientId:'test',redirectUri,scopes:'test',
    openBrowser: address => opened(new URL(address)),
    exchangeCode: async () => ({access_token:'test-only',expires_in:3600}),
    saveTokens: () => {}, timeoutMs:2000, ...overrides});
  promise.catch(() => {});
  const auth = await ready;
  const callback = new URL(redirectUri);
  callback.search = new URLSearchParams({state:auth.searchParams.get('state'),code:'test-code'}).toString();
  return {promise, callback, auth};
}

test('ignores favicon and stale callbacks; completes only after exchange and persistence', async () => {
  let saved = false, release;
  const waiting = new Promise(resolve => {release=resolve});
  let called;
  const exchanging = new Promise(resolve => {called=resolve});
  const login = await begin({exchangeCode:async()=>{called();await waiting;return {access_token:'test-only',expires_in:3600}},saveTokens:()=>{saved=true}});
  assert.equal(login.auth.searchParams.get('code_challenge_method'),'S256');
  assert(login.auth.searchParams.get('state'));
  assert.equal((await fetch(new URL('/favicon.ico',login.callback))).status,404);
  const stale = new URL(login.callback);stale.searchParams.set('state','old');
  assert.equal((await fetch(stale)).status,400);
  const callback = fetch(login.callback);await exchanging;
  assert.equal(saved,false);
  assert.equal((await fetch(login.callback)).status,409);
  release();
  assert.match(await (await callback).text(),/connected successfully/);
  await login.promise; assert.equal(saved,true);
});

test('rejected exchange never claims success',async()=>{
  const login=await begin({exchangeCode:async()=>{throw Error('SPOTIFY_LOGIN_TOKEN_FAILED')},saveTokens:()=>assert.fail('must not save')});
  const response=await fetch(login.callback);assert.equal(response.status,502);
  assert.match(await response.text(),/Could not finish/);
  await assert.rejects(login.promise,/TOKEN_FAILED/);
});

test('denial returns a useful error',async()=>{
  const login=await begin();login.callback.searchParams.delete('code');login.callback.searchParams.set('error','access_denied');
  assert.equal((await fetch(login.callback)).status,400);
  await assert.rejects(login.promise,/LOGIN_DENIED/);
});

test('timeout releases the port for another attempt',async()=>{
  const login=await begin({timeoutMs:50});await assert.rejects(login.promise,/CALLBACK_TIMEOUT/);
  const server=http.createServer();await new Promise((resolve,reject)=>server.once('error',reject).listen(Number(login.callback.port),'127.0.0.1',resolve));
  await new Promise(resolve=>server.close(resolve));
});

test('port conflict fails immediately without opening browser',async()=>{
  const server=http.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try { await assert.rejects(startSpotifyLogin({clientId:'test',redirectUri:`http://127.0.0.1:${server.address().port}/callback`,scopes:'',openBrowser:()=>assert.fail('must not open')}),/PORT_BUSY/); }
  finally { await new Promise(resolve=>server.close(resolve)); }
});

test('browser launch failure releases callback listener',async()=>{
  await assert.rejects(startSpotifyLogin({clientId:'test',redirectUri:`http://127.0.0.1:${await port()}/callback`,scopes:'',openBrowser:()=>{throw Error('browser')}}),/BROWSER_FAILED/);
});

test('cancel while waiting frees the same port for an immediate new login', async()=>{
  const controller=new AbortController();
  const login=await begin({signal:controller.signal});
  controller.abort();
  await assert.rejects(login.promise,/LOGIN_CANCELLED/);
  let opened;
  const ready=new Promise(r=>opened=r);
  const next=startSpotifyLogin({clientId:'test',redirectUri:login.callback.origin+'/callback',scopes:'',
    openBrowser:u=>opened(new URL(u)),exchangeCode:async()=>({access_token:'new',expires_in:3600}),saveTokens:()=>{},timeoutMs:2000});
  const auth=await ready;
  assert.equal((await fetch(login.callback)).status,400,'old callback cannot complete new attempt');
  const callback=new URL(login.callback);callback.searchParams.set('state',auth.searchParams.get('state'));
  assert.equal((await fetch(callback)).status,200);await next;
});

test('cancelling an in-flight exchange aborts it and ignores late tokens',async()=>{
  const controller=new AbortController();let exchangeSignal,release,started;
  const ready=new Promise(r=>started=r),tokens=new Promise(r=>release=r);
  let saved=false;
  const login=await begin({signal:controller.signal,exchangeCode:async(code,verifier,signal)=>{exchangeSignal=signal;started();return tokens},saveTokens:()=>{saved=true}});
  const request=fetch(login.callback).catch(()=>null);
  await ready;controller.abort();await assert.rejects(login.promise,/LOGIN_CANCELLED/);
  assert.equal(exchangeSignal.aborted,true);
  release({access_token:'late',expires_in:3600});await request;
  assert.equal(saved,false);
});

test('already cancelled login does not open a browser',async()=>{
  const controller=new AbortController();controller.abort();
  await assert.rejects(startSpotifyLogin({clientId:'test',redirectUri:`http://127.0.0.1:${await port()}/callback`,scopes:'',signal:controller.signal,openBrowser:()=>assert.fail('must not open')}),/LOGIN_CANCELLED/);
});
