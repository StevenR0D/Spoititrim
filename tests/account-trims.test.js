const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { createAccountTrims } = require('../electron/account-trims');
const { createAccountSession } = require('../electron/account-session');
function setup(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(`CREATE TABLE trim_points (spotify_track_id TEXT PRIMARY KEY, track_name TEXT,
    start_ms INTEGER, end_ms INTEGER, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    INSERT INTO trim_points (spotify_track_id,track_name,start_ms,end_ms) VALUES ('old','Old song',0,10000);`);
  return {db, trims:createAccountTrims(db)};
}
test('same song can have independent trims for two accounts; edits/deletes are isolated', t => {
  const {trims} = setup(t);
  assert.deepEqual(trims.getAllTrimPoints('A'), []);
  trims.upsertTrimPoint('A','song','Song',0,1000);
  trims.upsertTrimPoint('B','song','Song',2000,4000);
  trims.upsertTrimPoint('A','song','Song',300,900);
  assert.equal(trims.getTrimPoint('B','song').start_ms,2000);
  assert.equal(trims.getTrimPoint('A','song').start_ms,300);
  trims.deleteTrimPoint('A','song');
  assert.equal(trims.getAllTrimPoints('A').length,0);
  assert.equal(trims.getAllTrimPoints('B').length,1);
  assert.throws(()=>trims.getAllTrimPoints(null),/verified/);
});
test('old trims remain hidden until explicit import, are assigned once, and never overwrite edits', t => {
  const {db,trims} = setup(t);
  assert.equal(trims.hasLegacyTrims(),true);
  assert.equal(trims.getAllTrimPoints('A').length,0);
  trims.upsertTrimPoint('A','old','Edited',100,500);
  trims.importLegacyTrims('A');
  assert.equal(trims.hasLegacyTrims(),false);
  assert.equal(trims.getTrimPoint('A','old').track_name,'Edited');
  trims.importLegacyTrims('B');
  assert.equal(trims.getAllTrimPoints('B').length,0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM trim_points').get().count,1);
  assert.equal(createAccountTrims(db).getAllTrimPoints('A').length,1);
});
test('no account is authorized before verification; stale callbacks and requests cannot cross accounts', () => {
  const session=createAccountSession();
  assert.throws(()=>session.require('A'));
  const first=session.clear();
  session.verify(first,{account_id:'A',display_name:'Alice'});
  assert.equal(session.require('A'),'A');
  const second=session.clear();
  assert.throws(()=>session.require('A'));
  assert.throws(()=>session.verify(first,{account_id:'A'}),/changed/);
  session.verify(second,{account_id:'B',display_name:'Bob'});
  assert.throws(()=>session.require('A'));
  assert.equal(session.require('B'),'B');
  session.clear();assert.throws(()=>session.require('B'));
});
test('missing stable Spotify account identity is rejected',()=>{
  const session=createAccountSession();
  assert.throws(()=>session.verify(session.clear(),{id:'display-only'}),/identity/);
});
