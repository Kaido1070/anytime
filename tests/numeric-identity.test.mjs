import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { randomNumericUserId, isNumericUserId, allocateNumericUserId } from '../functions/_identity.js';
import { onRequest } from '../functions/api/[[path]].js';
import { onRequestPost as changePassword } from '../functions/api/change-password.js';
import { onRequestPost as recoverPassword } from '../functions/api/recover-password.js';
import { onRequestPost as adminLogin } from '../functions/api/admin-login.js';
import { onRequestPost as cleanupDemo } from '../functions/api/cleanup-demo.js';
import { onRequest as adminApi } from '../functions/api/admin/[[path]].js';
import { reserveAuthAttempt } from '../functions/_auth-security.js';
import { PASSWORD_ITERATIONS, derivePasswordHash } from '../functions/_password.js';

test('random numeric IDs have exact string precision and no fixed account mapping', () => {
  const ids = new Set(Array.from({ length: 1000 }, () => randomNumericUserId()));
  assert.equal(ids.size, 1000);
  for (const id of ids) {
    assert.equal(typeof id, 'string');
    assert.ok(isNumericUserId(id));
    assert.equal(JSON.parse(JSON.stringify({ id })).id, id);
  }
  assert.equal(isNumericUserId(123), false);
  assert.equal(isNumericUserId('m'), false);
});

test('ID allocation refuses a repeatedly occupied candidate rather than overwrite an account', async () => {
  let calls = 0;
  const db = { prepare() { return { bind() { return this; }, async first() { calls++; return { id: 'occupied' }; } }; } };
  await assert.rejects(allocateNumericUserId(db), /unique user ID/);
  assert.equal(calls, 8);
});

function d1Adapter(sqlite) {
  return {
    prepare(query) {
      let args = [];
      return {
        query,
        bind(...values) { args = values; return this; },
        async first() { return sqlite.prepare(query).get(...args) ?? null; },
        async all() { return { results: sqlite.prepare(query).all(...args) }; },
        execute() { const result = sqlite.prepare(query).run(...args); return { meta: { changes: Number(result.changes) } }; },
        async run() { return this.execute(); },
      };
    },
    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE');
      try { const result = statements.map(s => s.execute()); sqlite.exec('COMMIT'); return result; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
}

async function fixture(t) {
  const folder = await mkdtemp(join(tmpdir(), 'wany-numeric-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const script = fileURLToPath(new URL('./numeric-identity-migration.test.py', import.meta.url));
  const python = `import runpy,sys,pathlib; d=runpy.run_path(sys.argv[1]); root=pathlib.Path(sys.argv[2]); p=root/'backup.sql'; d['fixture'](p); d['m'].build_plan(p,d['CONFIG'],root/'plan')`;
  const result = spawnSync('python', ['-c', python, script, folder], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const sqlite = new DatabaseSync(join(folder, 'plan', 'migrated.sqlite'));
  sqlite.exec('PRAGMA foreign_keys=ON');
  t.after(() => sqlite.close());
  const credentials = JSON.parse(await readFile(join(folder, 'plan', 'credentials.local.json'), 'utf8')).accounts;
  return { sqlite, db: d1Adapter(sqlite), credentials: Object.fromEntries(credentials.map(row => [row.username, row])) };
}

function context(path, db, body, cookie, extra = {}) {
  return { env: { DB: db, ...extra }, request: new Request(`https://wany.test/api/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Origin: 'https://wany.test', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }) };
}

async function login(db, username, password) {
  const response = await onRequest(context('login', db, { username, password }));
  const payload = await response.json();
  return { response, payload, cookie: response.headers.get('Set-Cookie')?.split(';')[0] };
}

test('migration rejects old H credentials and new password changes actually replace the private credential', async t => {
  const { sqlite, db, credentials } = await fixture(t);
  assert.equal((await login(db, 'h', 'has-before')).response.status, 401);
  assert.equal((await login(db, 'h', 'h-before')).response.status, 401);
  for (const [username, oldPassword] of [['y','yas-before'],['y','y-before'],['m','m-before'],['admin','admin-before']]) {
    assert.equal((await login(db, username, oldPassword)).response.status, 401);
    assert.equal((await login(db, username, credentials[username].password)).response.status, 200);
  }
  const primary = await login(db, 'h', credentials.h.password);
  const alternate = await login(db, 'H', credentials.h.password);
  assert.equal(primary.response.status, 200);
  assert.equal(alternate.response.status, 200);
  assert.ok(isNumericUserId(primary.payload.user.id));
  assert.equal(primary.payload.user.id, alternate.payload.user.id);
  const id = primary.payload.user.id;
  const tooShort = await changePassword(context('change-password', db, { currentPassword: credentials.h.password, newPassword: '12345' }, alternate.cookie));
  assert.equal(tooShort.status, 400);
  const response = await changePassword(context('change-password', db, { currentPassword: credentials.h.password, newPassword: 'new123' }, alternate.cookie));
  assert.equal(response.status, 200);
  assert.equal(sqlite.prepare('SELECT id FROM users WHERE username=?').get('h').id, id);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM user_password_verifiers WHERE user_id=?').get(id).n, 0);
  assert.equal((await login(db, 'h', 'has-before')).response.status, 401);
  assert.equal((await login(db, 'h', 'h-before')).response.status, 401);
  assert.equal((await login(db, 'h', credentials.h.password)).response.status, 401);
  sqlite.prepare('UPDATE auth_attempt_windows SET window_start=?').run(Date.now() - 900001);
  assert.equal((await login(db, 'h', 'new123')).payload.user.id, id);
  assert.equal((await (await onRequest(context('session', db, null, primary.cookie))).json()).user, null);
  assert.equal((await (await onRequest(context('session', db, null, alternate.cookie))).json()).user, null);
  const rotatedCookie = response.headers.get('Set-Cookie').split(';')[0];
  assert.notEqual(rotatedCookie, alternate.cookie);
  assert.equal((await (await onRequest(context('session', db, null, rotatedCookie))).json()).user.id, id);
});

test('numeric admin identity authenticates by its D1 username and role', async t => {
  const { sqlite, db, credentials } = await fixture(t);
  const result = await login(db, 'admin', credentials.admin.password);
  assert.equal(result.response.status, 200);
  assert.ok(isNumericUserId(result.payload.user.id));
  assert.equal(result.payload.user.role, 'admin');
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM admin_audit_log WHERE action='admin_login' AND admin_user_id=?").get(result.payload.user.id).n, 2);
});

test('admin can replace their own password while keeping their role and rotating sessions', async t => {
  const { db, credentials } = await fixture(t);
  const first = await login(db, 'admin', credentials.admin.password);
  const second = await login(db, 'admin', credentials.admin.password);
  const changed = await changePassword(context('change-password', db, { currentPassword: credentials.admin.password, newPassword: 'admin6' }, first.cookie));
  assert.equal(changed.status, 200);
  const cookie = changed.headers.get('Set-Cookie').split(';')[0];
  assert.notEqual(cookie, first.cookie);
  const session = await (await onRequest(context('session', db, null, cookie))).json();
  assert.equal(session.user.id, credentials.admin.user_id);
  assert.equal(session.user.role, 'admin');
  assert.equal((await (await onRequest(context('session', db, null, second.cookie))).json()).user, null);
  assert.equal((await login(db, 'admin', credentials.admin.password)).response.status, 401);
  assert.equal((await login(db, 'admin', 'admin6')).response.status, 200);
});

test('R2 cover fallback uses only aliases belonging to the numeric session owner', async t => {
  const { db, credentials } = await fixture(t);
  const h = await login(db, 'h', credentials.h.password);
  const requested = [];
  const covers = { async get(key) {
    requested.push(key);
    return key === 'covers/has/story' ? { body: 'old-cover', httpEtag: 'old', writeHttpMetadata(headers) { headers.set('Content-Type','image/png'); } } : null;
  } };
  let response = await onRequest(context('work-snapshots/cover?key=story', db, null, h.cookie, { WANY_COVERS: covers }));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Content-Security-Policy'), /sandbox/);
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(await response.text(), 'old-cover');
  assert.equal(requested[1], 'covers/has/story');
  requested.length = 0;
  const m = await login(db, 'm', credentials.m.password);
  response = await onRequest(context('work-snapshots/cover?key=story', db, null, m.cookie, { WANY_COVERS: covers }));
  assert.equal(response.status, 404);
  assert.ok(requested.every(key => !key.startsWith('covers/has/') && !key.startsWith('covers/h/')));
  const activeCovers = { async get() { return { body: '<svg/>', httpEtag: 'active', writeHttpMetadata(headers) { headers.set('Content-Type', 'image/svg+xml'); } }; } };
  response = await onRequest(context('work-snapshots/cover?key=story', db, null, h.cookie, { WANY_COVERS: activeCovers }));
  assert.equal(response.status, 415);
  const upload = new Request('https://anytime.test/api/work-snapshots/cover?key=story', { method: 'PUT', headers: { Origin: 'https://anytime.test', Cookie: h.cookie, 'Content-Type': 'image/svg+xml' }, body: '<svg/>' });
  let writes = 0;
  response = await onRequest({ request: upload, env: { DB: db, WANY_COVERS: { async put() { writes++; } } } });
  assert.equal(response.status, 400);
  assert.equal(writes, 0);
});

test('recovery follows the numeric D1 account, is one-use, and invalidates sessions without changing ID', async t => {
  const { sqlite, db, credentials } = await fixture(t);
  const h = await login(db, 'h', credentials.h.password);
  const id = h.payload.user.id;
  const code = credentials.h.recoveryCode;
  const body = { username: 'h', recoveryCode: code, newPassword: 'reset6' };
  assert.equal((await recoverPassword(context('recover-password', db, { ...body, newPassword: '12345' }))).status, 400);
  const responses = await Promise.all([recoverPassword(context('recover-password', db, body)), recoverPassword(context('recover-password', db, body))]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 401]);
  assert.equal((await login(db, 'h', 'reset6')).payload.user.id, id);
  assert.equal((await (await onRequest(context('session', db, null, h.cookie))).json()).user, null);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM reading_history WHERE user_id=?').get(id).n, 2);
  assert.equal((await recoverPassword(context('recover-password', db, body))).status, 401);
});

test('private migration suite verifies merge, blobs, stale-plan guards and rollback', () => {
  const script = fileURLToPath(new URL('./numeric-identity-migration.test.py', import.meta.url));
  const result = spawnSync('python', [script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /Ran 11 tests/);
});

test('all account mutation entry points reject missing and foreign Origin before database access', async () => {
  for (const [handler,path] of [[onRequest,'login'],[adminLogin,'admin-login'],[changePassword,'change-password'],[recoverPassword,'recover-password'],[cleanupDemo,'cleanup-demo']]) {
    for (const origin of [null,'https://attacker.test']) {
      const headers={'Content-Type':'application/json'}; if(origin)headers.Origin=origin;
      const db={prepare(){throw new Error('Must reject before SQL');}};
      const response=await handler({env:{DB:db},request:new Request(`https://wany.test/api/${path}`,{method:'POST',headers,body:'{}'})});
      assert.equal(response.status,403);
    }
  }
});

test('bounded JSON rejects oversized bodies without relying on Content-Length', async t => {
  const {db,credentials}=await fixture(t);
  const h=await login(db,'h',credentials.h.password);
  for(const [handler,path] of [[onRequest,'login'],[adminLogin,'admin-login'],[changePassword,'change-password'],[recoverPassword,'recover-password']]) {
    const request=new Request(`https://wany.test/api/${path}`,{method:'POST',headers:{Origin:'https://wany.test','Content-Type':'application/json',Cookie:h.cookie},body:JSON.stringify({padding:'x'.repeat(32768)})});
    assert.equal((await handler({env:{DB:db},request})).status,413);
  }
});

test('D1 attempt budgets survive independent handlers, concurrency and expiry', async t => {
  const {sqlite,db}=await fixture(t);
  const request=new Request('https://wany.test/api/login',{headers:{'CF-Connecting-IP':'192.0.2.1'}});
  const budgets=await Promise.all(Array.from({length:16},(_,i)=>reserveAuthAttempt(i%2?db:d1Adapter(sqlite),request,'login','h')));
  assert.equal(budgets.filter(Boolean).length,8);
  const rows=sqlite.prepare('SELECT bucket_key, attempts FROM auth_attempt_windows').all();
  assert.ok(rows.every(r=>/^[0-9a-f]{64}$/.test(r.bucket_key)));
  assert.equal(await reserveAuthAttempt(d1Adapter(sqlite),request,'login','h',Date.now()+900001),true);
});

test('general login and admin login share a persistent guessing budget', async t => {
  const {db}=await fixture(t);
  for(let i=0;i<8;i++)assert.equal((await (i%2?adminLogin:onRequest)(context(i%2?'admin-login':'login',db,{username:'admin',password:'wrong'}))).status,401);
  assert.equal((await onRequest(context('login',db,{username:'admin',password:'wrong'}))).status,429);
});

test('an in-flight login cannot issue a session after its verified credential changes', async t => {
  for(const [handler,path,username] of [[onRequest,'login','h'],[adminLogin,'admin-login','admin']]) {
    const {sqlite,db,credentials}=await fixture(t); const batch=db.batch;
    db.batch=async statements=>{
      if(statements.some(s=>s.query.includes('INSERT INTO sessions')))sqlite.prepare('UPDATE users SET password_hash=? WHERE username=?').run('different-current-hash',username);
      return batch(statements);
    };
    const response=await handler(context(path,db,{username,password:credentials[username].password}));
    assert.equal(response.status,401);assert.equal(response.headers.get('Set-Cookie'),null);
    assert.equal(sqlite.prepare('SELECT count(*) AS n FROM sessions').get().n,0);
  }
});

test('password change cannot succeed after the authorizing session is revoked', async t => {
  const {sqlite,db,credentials}=await fixture(t);const h=await login(db,'h',credentials.h.password);
  const before=sqlite.prepare("SELECT password_hash FROM users WHERE username='h'").get().password_hash;const batch=db.batch;
  db.batch=async statements=>{
    if(statements.some(s=>s.query.startsWith('UPDATE users SET password_salt')))sqlite.prepare('DELETE FROM sessions').run();
    return batch(statements);
  };
  assert.equal((await changePassword(context('change-password',db,{currentPassword:credentials.h.password,newPassword:'new123'},h.cookie))).status,409);
  assert.equal(sqlite.prepare("SELECT password_hash FROM users WHERE username='h'").get().password_hash,before);
});

test('retired alternative credentials cannot authenticate an account', async t => {
  const {sqlite,db,credentials}=await fixture(t);const c=credentials.h;const salt=crypto.getRandomValues(new Uint8Array(16));
  const hash=await derivePasswordHash('retired123',salt,PASSWORD_ITERATIONS);
  sqlite.prepare('INSERT INTO user_password_verifiers VALUES(?,?,?,?)').run(c.user_id,Buffer.from(salt).toString('base64url'),hash,PASSWORD_ITERATIONS);
  assert.equal((await login(db,'h','retired123')).response.status,401);
  assert.equal((await login(db,'h',c.password)).response.status,200);
});

test('logout-all clears every session and ordinary accounts cannot access admin data', async t => {
  const {sqlite,db,credentials}=await fixture(t);const h=await login(db,'h',credentials.h.password);const other=await login(db,'h',credentials.h.password);
  assert.equal((await adminApi(context('admin/users',db,null,h.cookie))).status,403);
  const response=await onRequest(context('logout-all',db,{},h.cookie));assert.equal(response.status,200);
  assert.match(response.headers.get('Set-Cookie'),/Max-Age=0/);
  assert.equal((await(await onRequest(context('session',db,null,other.cookie))).json()).user,null);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM sessions WHERE user_id=?').get(credentials.h.user_id).n,0);
});

test('replacement recovery code requires the current password and invalidates the previous code', async t => {
  const {sqlite,db,credentials}=await fixture(t);const h=await login(db,'h',credentials.h.password);
  assert.equal((await onRequest(context('recovery-code',db,{currentPassword:'wrong'},h.cookie))).status,400);
  const response=await onRequest(context('recovery-code',db,{currentPassword:credentials.h.password},h.cookie));assert.equal(response.status,200);
  const code=(await response.json()).recoveryCode;assert.ok(code.length>=40);
  const row=sqlite.prepare('SELECT * FROM user_recovery_verifiers WHERE user_id=?').get(credentials.h.user_id);assert.notEqual(row.recovery_hash,code);
  assert.equal((await recoverPassword(context('recover-password',db,{username:'h',recoveryCode:credentials.h.recoveryCode,newPassword:'reset6'}))).status,401);
  assert.equal((await recoverPassword(context('recover-password',db,{username:'h',recoveryCode:code,newPassword:'reset6'}))).status,200);
  assert.equal((await recoverPassword(context('recover-password',db,{username:'h',recoveryCode:code,newPassword:'reset6'}))).status,401);
  assert.equal(sqlite.prepare('SELECT password_iterations FROM users WHERE username=?').get('h').password_iterations,100000);
});

test('distributed IPs cannot exceed the shared per-account attempt budget', async t => {
  const {sqlite,db}=await fixture(t);
  const results=await Promise.all(Array.from({length:30},(_,i)=>reserveAuthAttempt(db,new Request('https://wany.test/api/login',{headers:{'CF-Connecting-IP':`192.0.2.${i+1}`}}),'login','h')));
  assert.equal(results.filter(Boolean).length,24);
  assert.ok(sqlite.prepare('SELECT max(attempts) AS n FROM auth_attempt_windows').get().n<=24);
});

test('exhausted IPs cannot grow the throttle table with random account names', async t => {
  const {sqlite,db}=await fixture(t);const request=new Request('https://wany.test/api/login',{headers:{'CF-Connecting-IP':'192.0.2.100'}});
  for(let i=0;i<60;i++)assert.equal(await reserveAuthAttempt(db,request,'login',`unknown-${i}`),true);
  const before=sqlite.prepare('SELECT count(*) AS n FROM auth_attempt_windows').get().n;
  assert.equal(await reserveAuthAttempt(db,request,'login','another-random-name'),false);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM auth_attempt_windows').get().n,before);
});

test('missing security support schema fails closed without request-time repairs', async t => {
  const {sqlite,db,credentials}=await fixture(t);sqlite.exec('DROP TABLE auth_attempt_windows');
  for(const [handler,path,body] of [[onRequest,'login',{username:'h',password:credentials.h.password}],[adminLogin,'admin-login',{username:'admin',password:credentials.admin.password}],[recoverPassword,'recover-password',{username:'h',recoveryCode:credentials.h.recoveryCode,newPassword:'reset6'}]]) {
    const response=await handler(context(path,db,body));assert.equal(response.status,503);assert.equal((await response.json()).error,'SCHEMA_MIGRATION_REQUIRED');
  }
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM sessions').get().n,0);
  assert.equal(sqlite.prepare("SELECT name FROM sqlite_master WHERE name='auth_attempt_windows'").get(),undefined);
});

test('security question is stored per D1 account with a salted hash and requires current password', async t => {
  const {sqlite,db,credentials}=await fixture(t);const h=await login(db,'h',credentials.h.password);
  const body={currentPassword:credentials.h.password,question:'What is my private phrase?',answer:' Secret  Answer '};
  assert.equal((await onRequest(context('security-question',db,{...body,currentPassword:'wrong'},h.cookie))).status,400);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM user_security_questions').get().n,0);
  const response=await onRequest(context('security-question',db,body,h.cookie));assert.equal(response.status,200);
  const row=sqlite.prepare('SELECT * FROM user_security_questions WHERE user_id=?').get(credentials.h.user_id);
  assert.equal(row.question,body.question);assert.notEqual(row.answer_hash,body.answer);assert.notEqual(row.answer_hash,'secret answer');assert.ok(row.answer_salt.length>=20);assert.equal(row.answer_iterations,100000);
  const profile=await(await onRequest(context('security-question',db,null,h.cookie))).json();assert.deepEqual(Object.keys(profile),['question']);
  const challenge=await(await recoverPassword(context('recover-password',db,{action:'question',username:'h'}))).json();assert.equal(challenge.question,body.question);assert.deepEqual(Object.keys(challenge),['question']);
});

test('security answer recovery replaces the password and revokes every session without changing user data', async t => {
  const {sqlite,db,credentials}=await fixture(t);const h=await login(db,'h',credentials.h.password);const id=credentials.h.user_id;
  await onRequest(context('security-question',db,{currentPassword:credentials.h.password,question:'What is my private phrase?',answer:'Secret Answer'},h.cookie));
  const before=sqlite.prepare('SELECT password_hash FROM users WHERE id=?').get(id).password_hash;
  const body={method:'security-question',username:'h',answer:'wrong answer',newPassword:'reset6'};
  assert.equal((await recoverPassword(context('recover-password',db,body))).status,401);
  assert.equal(sqlite.prepare('SELECT password_hash FROM users WHERE id=?').get(id).password_hash,before);
  assert.equal((await recoverPassword(context('recover-password',db,{...body,answer:'  SECRET   answer  '}))).status,200);
  assert.equal((await login(db,'h',credentials.h.password)).response.status,401);
  assert.equal((await login(db,'h','reset6')).payload.user.id,id);
  assert.equal((await(await onRequest(context('session',db,null,h.cookie))).json()).user,null);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM reading_history WHERE user_id=?').get(id).n,2);
});

test('changing a security answer retires the previous answer and prevents cross-account recovery', async t => {
  const {sqlite,db,credentials}=await fixture(t);const h=await login(db,'h',credentials.h.password);
  for(const answer of ['first secret','second secret'])assert.equal((await onRequest(context('security-question',db,{currentPassword:credentials.h.password,question:'What is my private phrase?',answer},h.cookie))).status,200);
  const body={method:'security-question',username:'h',answer:'first secret',newPassword:'reset6'};
  assert.equal((await recoverPassword(context('recover-password',db,body))).status,401);
  assert.equal((await recoverPassword(context('recover-password',db,{...body,username:'y',answer:'second secret'}))).status,401);
  assert.equal((await recoverPassword(context('recover-password',db,{...body,answer:'second secret'}))).status,200);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM user_security_questions WHERE user_id=?').get(credentials.y.user_id).n,0);
});

test('concurrent security-answer resets recheck the credential generation atomically', async t => {
  const {db,credentials}=await fixture(t);const h=await login(db,'h',credentials.h.password);
  await onRequest(context('security-question',db,{currentPassword:credentials.h.password,question:'What is my private phrase?',answer:'secret answer'},h.cookie));
  const body={method:'security-question',username:'h',answer:'secret answer',newPassword:'reset6'};
  const results=await Promise.all([recoverPassword(context('recover-password',db,body)),recoverPassword(context('recover-password',db,{...body,newPassword:'other6'}))]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,401]);
});

test('security-question setup cannot commit after its session is revoked', async t => {
  const {sqlite,db,credentials}=await fixture(t);const h=await login(db,'h',credentials.h.password);const prepare=db.prepare;
  db.prepare=query=>{
    const statement=prepare(query);
    if(query.startsWith('INSERT INTO user_security_questions')){const run=statement.run;statement.run=async()=>{sqlite.prepare('DELETE FROM sessions').run();return run.call(statement);};}
    return statement;
  };
  const response=await onRequest(context('security-question',db,{currentPassword:credentials.h.password,question:'What is my private phrase?',answer:'secret answer'},h.cookie));
  assert.equal(response.status,401);assert.equal(sqlite.prepare('SELECT count(*) AS n FROM user_security_questions').get().n,0);
});


test('admin reads only the saved question and persistently resets the target password with audit and session revocation', async t => {
  const { sqlite, db, credentials } = await fixture(t);
  const owner = await login(db, 'h', credentials.h.password);
  const admin = await login(db, 'admin', credentials.admin.password);
  const targetId = credentials.h.user_id;
  assert.equal((await onRequest(context('security-question', db, { currentPassword: credentials.h.password, question: 'My private question?', answer: 'Secret answer' }, owner.cookie))).status, 200);
  const question = await adminApi(context(`admin/users/${targetId}/security-question`, db, null, admin.cookie));
  assert.equal(question.status, 200);
  assert.deepEqual(await question.json(), { question: 'My private question?', recoveryLocked: false, failedAnswers: 0 });
  const path = `admin/users/${targetId}/reset-password`;
  assert.equal((await adminApi(context(path, db, { currentPassword: 'wrong', newPassword: 'newpass' }, admin.cookie))).status, 400);
  assert.equal((await adminApi(context(path, db, { currentPassword: credentials.admin.password, newPassword: 'newpass' }, admin.cookie))).status, 200);
  assert.equal((await login(db, 'h', credentials.h.password)).response.status, 401);
  assert.equal((await login(db, 'h', 'newpass')).response.status, 200);
  assert.equal((await onRequest(context('security-question', db, null, owner.cookie))).status, 401);
  const audit = sqlite.prepare('SELECT admin_user_id, target_user_id FROM admin_credential_events').all();
  assert.equal(audit.length, 1);
  assert.equal(audit[0].target_user_id, targetId);
  assert.equal((await login(db, 'admin', credentials.admin.password)).response.status, 200);
});

test('admin reset rejects ordinary users, cross-origin requests and short passwords', async t => {
  const { db, credentials } = await fixture(t);
  const owner = await login(db, 'h', credentials.h.password);
  const admin = await login(db, 'admin', credentials.admin.password);
  const path = `admin/users/${credentials.y.user_id}/reset-password`;
  const body = { currentPassword: credentials.admin.password, newPassword: 'abcdef' };
  assert.equal((await adminApi(context(path, db, body, owner.cookie))).status, 403);
  const cross = context(path, db, body, admin.cookie);
  cross.request.headers.set('Origin', 'https://evil.test');
  assert.equal((await adminApi(cross)).status, 403);
  assert.equal((await adminApi(context(path, db, { ...body, newPassword: '12345' }, admin.cookie))).status, 400);
});

test('admin reset rechecks the authorizing session inside the mutation', async t => {
  const { sqlite, db, credentials } = await fixture(t);
  const admin = await login(db, 'admin', credentials.admin.password);
  const target = credentials.y.user_id;
  const original = sqlite.prepare('SELECT password_hash FROM users WHERE id = ?').get(target).password_hash;
  const raced = { ...db, async batch(statements) {
    if (statements[0].query.startsWith('UPDATE users SET password_salt')) sqlite.prepare('DELETE FROM sessions WHERE user_id = ?').run(credentials.admin.user_id);
    return db.batch(statements);
  } };
  const response = await adminApi(context(`admin/users/${target}/reset-password`, raced, { currentPassword: credentials.admin.password, newPassword: 'abcdef' }, admin.cookie));
  assert.equal(response.status, 401);
  assert.equal(sqlite.prepare('SELECT password_hash FROM users WHERE id = ?').get(target).password_hash, original);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM admin_credential_events').get().n, 0);
});

test('admin reset fails closed when role, administrator password or target credential changes during the request', async t => {
  for (const change of ['role', 'admin-password', 'target-password']) {
    const { sqlite, db, credentials } = await fixture(t);
    const admin = await login(db, 'admin', credentials.admin.password);
    const target = credentials.h.user_id;
    const original = sqlite.prepare('SELECT password_hash FROM users WHERE id = ?').get(target).password_hash;
    const raced = { ...db, async batch(statements) {
      if (statements[0].query.startsWith('UPDATE users SET password_salt')) {
        if (change === 'role') sqlite.prepare("UPDATE users SET role = 'user' WHERE id = ?").run(credentials.admin.user_id);
        if (change === 'admin-password') sqlite.prepare("UPDATE users SET password_hash = 'changed' WHERE id = ?").run(credentials.admin.user_id);
        if (change === 'target-password') sqlite.prepare("UPDATE users SET password_hash = 'changed' WHERE id = ?").run(target);
      }
      return db.batch(statements);
    } };
    const response = await adminApi(context(`admin/users/${target}/reset-password`, raced, { currentPassword: credentials.admin.password, newPassword: 'newsecret' }, admin.cookie));
    assert.equal(response.status, 401, change);
    assert.equal(sqlite.prepare('SELECT password_hash FROM users WHERE id = ?').get(target).password_hash, change === 'target-password' ? 'changed' : original);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM admin_credential_events').get().n, 0);
  }
});

test('admin credential operations expose no secrets and reject anonymous, missing-origin and admin targets', async t => {
  const { db, credentials } = await fixture(t);
  const admin = await login(db, 'admin', credentials.admin.password);
  const path = `admin/users/${credentials.h.user_id}/reset-password`;
  const body = { currentPassword: credentials.admin.password, newPassword: 'newsecret' };
  assert.equal((await adminApi(context(path, db, body))).status, 401);
  const missingOrigin = context(path, db, body, admin.cookie);
  missingOrigin.request.headers.delete('Origin');
  assert.equal((await adminApi(missingOrigin)).status, 403);
  assert.equal((await adminApi(context(`admin/users/${credentials.admin.user_id}/reset-password`, db, body, admin.cookie))).status, 404);
  const response = await adminApi(context(path, db, body, admin.cookie));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.match(response.headers.get('Cache-Control'), /no-store/);
});

test('missing admin audit support rolls back the entire password reset and preserves sessions', async t => {
  const { sqlite, db, credentials } = await fixture(t);
  const admin = await login(db, 'admin', credentials.admin.password);
  const owner = await login(db, 'h', credentials.h.password);
  const target = credentials.h.user_id;
  await onRequest(context('security-question', db, { currentPassword: credentials.h.password, question: 'Private question?', answer: 'retained-answer' }, owner.cookie));
  const before = sqlite.prepare('SELECT password_hash FROM users WHERE id = ?').get(target).password_hash;
  sqlite.exec('DROP TABLE admin_credential_events');
  const response = await adminApi(context(`admin/users/${target}/reset-password`, db, { currentPassword: credentials.admin.password, newPassword: 'newsecret' }, admin.cookie));
  assert.equal(response.status, 500);
  assert.equal(sqlite.prepare('SELECT password_hash FROM users WHERE id = ?').get(target).password_hash, before);
  assert.equal((await onRequest(context('security-question', db, null, owner.cookie))).status, 200);
  assert.equal(sqlite.prepare('SELECT question FROM user_security_questions WHERE user_id = ?').get(target).question, 'Private question?');
});

test('admin reset current-password guessing is rate limited across different target accounts', async t => {
  const { db, credentials } = await fixture(t);
  const admin = await login(db, 'admin', credentials.admin.password);
  for (let i = 0; i < 8; i++) {
    const target = i % 2 ? credentials.h.user_id : credentials.y.user_id;
    assert.equal((await adminApi(context(`admin/users/${target}/reset-password`, db, { currentPassword: 'incorrect', newPassword: 'newsecret' }, admin.cookie))).status, 400);
  }
  assert.equal((await adminApi(context(`admin/users/${credentials.m.user_id}/reset-password`, db, { currentPassword: credentials.admin.password, newPassword: 'newsecret' }, admin.cookie))).status, 429);
});


test('security answers accept a single character without complexity checks while rejecting empty answers and short passwords', async t => {
  const { db, credentials } = await fixture(t);
  const owner = await login(db, 'h', credentials.h.password);
  const setup = { currentPassword: credentials.h.password, question: 'What answer did I save?', answer: '  ' };
  assert.equal((await onRequest(context('security-question', db, setup, owner.cookie))).status, 400);
  assert.equal((await onRequest(context('security-question', db, { ...setup, answer: '1' }, owner.cookie))).status, 200);
  const recover = { method: 'security-question', username: 'h', answer: '1', newPassword: '12345' };
  assert.equal((await recoverPassword(context('recover-password', db, recover))).status, 400);
  assert.equal((await recoverPassword(context('recover-password', db, { ...recover, answer: ' ' , newPassword: '123456' }))).status, 401);
  assert.equal((await recoverPassword(context('recover-password', db, { ...recover, newPassword: '123456' }))).status, 200);
  assert.equal((await login(db, 'h', '123456')).response.status, 200);
});

test('five wrong security answers persistently lock recovery until the admin resets the password', async t => {
  const { sqlite, db, credentials } = await fixture(t);
  const owner = await login(db, 'h', credentials.h.password);
  await onRequest(context('security-question', db, { currentPassword: credentials.h.password, question: 'My question here?', answer: '1' }, owner.cookie));
  const body = { method: 'security-question', username: 'h', answer: 'wrong', newPassword: 'newsecret' };
  for (let i = 0; i < 5; i++) {
    const request = context('recover-password', db, body);
    request.request.headers.set('CF-Connecting-IP', `198.51.100.${i}`);
    assert.equal((await recoverPassword(request)).status, i === 4 ? 423 : 401);
  }
  const freshDb = d1Adapter(sqlite);
  assert.equal((await recoverPassword(context('recover-password', freshDb, { ...body, answer: '1' }))).status, 423);
  assert.equal((await recoverPassword(context('recover-password', freshDb, { username: 'h', recoveryCode: credentials.h.recoveryCode, newPassword: 'newsecret' }))).status, 423);
  assert.equal((await recoverPassword(context('recover-password', freshDb, { action: 'question', username: 'h' }))).status, 423);
  assert.equal((await login(db, 'h', credentials.h.password)).response.status, 200);
  const admin = await login(db, 'admin', credentials.admin.password);
  const info = await adminApi(context(`admin/users/${credentials.h.user_id}/security-question`, db, null, admin.cookie));
  assert.deepEqual(await info.json(), { question: 'My question here?', recoveryLocked: true, failedAnswers: 5 });
  assert.equal((await adminApi(context(`admin/users/${credentials.h.user_id}/reset-password`, db, { currentPassword: credentials.admin.password, newPassword: 'adminnew' }, admin.cookie))).status, 200);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM user_security_question_locks WHERE user_id = ?').get(credentials.h.user_id).n, 0);
  assert.equal((await login(db, 'h', 'adminnew')).response.status, 200);
  assert.equal((await recoverPassword(context('recover-password', db, { ...body, answer: '1' }))).status, 401);
});

test('admin rescue retires the old answer and code; user can configure a new question without losing data', async t => {
  const { sqlite, db, credentials } = await fixture(t);
  const target = credentials.h.user_id;
  const owner = await login(db, 'h', credentials.h.password);
  const other = await login(db, 'y', credentials.y.password);
  const admin = await login(db, 'admin', credentials.admin.password);
  for (const [account, session] of [['h', owner], ['y', other]]) {
    assert.equal((await onRequest(context('security-question', db, { currentPassword: credentials[account].password, question: 'Private question?', answer: 'old-answer' }, session.cookie))).status, 200);
  }
  const before = sqlite.prepare('SELECT * FROM user_library WHERE user_id = ?').all(target);
  assert.equal((await adminApi(context(`admin/users/${target}/reset-password`, db, { currentPassword: credentials.admin.password, newPassword: 'rescue6' }, admin.cookie))).status, 200);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM user_security_questions WHERE user_id = ?').get(target).n, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM user_security_questions WHERE user_id = ?').get(credentials.y.user_id).n, 1);
  assert.equal((await recoverPassword(context('recover-password', db, { method: 'security-question', username: 'h', answer: 'old-answer', newPassword: 'attack6' }))).status, 401);
  assert.equal((await recoverPassword(context('recover-password', db, { username: 'h', recoveryCode: credentials.h.recoveryCode, newPassword: 'attack6' }))).status, 401);
  const fresh = await login(db, 'h', 'rescue6');
  assert.equal(fresh.response.status, 200);
  assert.equal((await onRequest(context('security-question', db, { currentPassword: 'rescue6', question: 'New private question?', answer: 'new-answer' }, fresh.cookie))).status, 200);
  assert.equal((await recoverPassword(context('recover-password', db, { method: 'security-question', username: 'h', answer: 'new-answer', newPassword: 'chosen6' }))).status, 200);
  assert.equal((await login(db, 'h', 'chosen6')).response.status, 200);
  assert.deepEqual(sqlite.prepare('SELECT * FROM user_library WHERE user_id = ?').all(target), before);
});

test('an old answer verified before admin rescue cannot overwrite the rescued credential afterward', async t => {
  const { db, credentials } = await fixture(t);
  const owner = await login(db, 'h', credentials.h.password);
  const admin = await login(db, 'admin', credentials.admin.password);
  await onRequest(context('security-question', db, { currentPassword: credentials.h.password, question: 'Private question?', answer: 'old-answer' }, owner.cookie));
  const raced = { ...db, async batch(statements) {
    if (!statements[0].query.startsWith('UPDATE users SET password_salt')) return db.batch(statements);
    assert.equal((await adminApi(context(`admin/users/${credentials.h.user_id}/reset-password`, db, { currentPassword: credentials.admin.password, newPassword: 'rescue6' }, admin.cookie))).status, 200);
    return db.batch(statements);
  } };
  assert.equal((await recoverPassword(context('recover-password', raced, { method: 'security-question', username: 'h', answer: 'old-answer', newPassword: 'attack6' }))).status, 401);
  assert.equal((await login(db, 'h', 'rescue6')).response.status, 200);
  assert.equal((await login(db, 'h', 'attack6')).response.status, 401);
});

test('explicit admin unlock only clears the lock and preserves questions, credentials, sessions and codes', async t => {
  const { sqlite, db, credentials } = await fixture(t);
  const target = credentials.h.user_id;
  const owner = await login(db, 'h', credentials.h.password);
  const admin = await login(db, 'admin', credentials.admin.password);
  await onRequest(context('security-question', db, { currentPassword: credentials.h.password, question: 'Private question?', answer: 'old-answer' }, owner.cookie));
  sqlite.prepare('INSERT INTO user_security_question_locks VALUES (?,5)').run(target);
  const question = sqlite.prepare('SELECT * FROM user_security_questions WHERE user_id = ?').get(target);
  const codes = sqlite.prepare('SELECT * FROM user_recovery_verifiers WHERE user_id = ?').all(target);
  const password = sqlite.prepare('SELECT password_hash FROM users WHERE id = ?').get(target).password_hash;
  const response = await adminApi(context(`admin/users/${target}/unlock-recovery`, db, { currentPassword: credentials.admin.password }, admin.cookie));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM user_security_question_locks WHERE user_id = ?').get(target).n, 0);
  assert.deepEqual(sqlite.prepare('SELECT * FROM user_security_questions WHERE user_id = ?').get(target), question);
  assert.deepEqual(sqlite.prepare('SELECT * FROM user_recovery_verifiers WHERE user_id = ?').all(target), codes);
  assert.equal(sqlite.prepare('SELECT password_hash FROM users WHERE id = ?').get(target).password_hash, password);
  assert.equal((await onRequest(context('security-question', db, null, owner.cookie))).status, 200);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM admin_credential_events WHERE target_user_id = ?').get(target).n, 1);
  assert.equal((await recoverPassword(context('recover-password', db, { method: 'security-question', username: 'h', answer: 'old-answer', newPassword: 'chosen6' }))).status, 200);
});

test('unlock requires administrator password and same origin, and cannot target an admin', async t => {
  const { sqlite, db, credentials } = await fixture(t);
  const owner = await login(db, 'h', credentials.h.password);
  const admin = await login(db, 'admin', credentials.admin.password);
  const target = credentials.h.user_id;
  sqlite.prepare('INSERT INTO user_security_question_locks VALUES (?,5)').run(target);
  const path = `admin/users/${target}/unlock-recovery`;
  const body = { currentPassword: credentials.admin.password };
  assert.equal((await adminApi(context(path, db, body))).status, 401);
  assert.equal((await adminApi(context(path, db, body, owner.cookie))).status, 403);
  assert.equal((await adminApi(context(path, db, { currentPassword: 'wrong' }, admin.cookie))).status, 400);
  for (const origin of [null, 'https://evil.test']) {
    const request = context(path, db, body, admin.cookie);
    if (origin) request.request.headers.set('Origin', origin); else request.request.headers.delete('Origin');
    assert.equal((await adminApi(request)).status, 403);
  }
  assert.equal((await adminApi(context(`admin/users/${credentials.admin.user_id}/unlock-recovery`, db, body, admin.cookie))).status, 404);
  assert.equal(sqlite.prepare('SELECT failures FROM user_security_question_locks WHERE user_id = ?').get(target).failures, 5);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM admin_credential_events').get().n, 0);
});

test('unlock rechecks live authorization and target credential and rolls back if audit is unavailable', async t => {
  for (const change of ['session', 'role', 'admin-password', 'target-password', 'missing-audit', 'delete-failure']) {
    const { sqlite, db, credentials } = await fixture(t);
    const admin = await login(db, 'admin', credentials.admin.password);
    const target = credentials.h.user_id;
    sqlite.prepare('INSERT INTO user_security_question_locks VALUES (?,5)').run(target);
    const raced = { ...db, async batch(statements) {
      if (!statements[0].query.startsWith('INSERT INTO admin_credential_events')) return db.batch(statements);
      if (change === 'delete-failure') sqlite.exec("CREATE TRIGGER reject_unlock BEFORE DELETE ON user_security_question_locks BEGIN SELECT RAISE(ABORT, 'audit fixture'); END");
      if (change === 'session') sqlite.prepare('DELETE FROM sessions WHERE user_id = ?').run(credentials.admin.user_id);
      if (change === 'role') sqlite.prepare("UPDATE users SET role = 'user' WHERE id = ?").run(credentials.admin.user_id);
      if (change === 'admin-password') sqlite.prepare("UPDATE users SET password_hash = 'changed' WHERE id = ?").run(credentials.admin.user_id);
      if (change === 'target-password') sqlite.prepare("UPDATE users SET password_hash = 'changed' WHERE id = ?").run(target);
      if (change === 'missing-audit') sqlite.exec('DROP TABLE admin_credential_events');
      return db.batch(statements);
    } };
    const response = await adminApi(context(`admin/users/${target}/unlock-recovery`, raced, { currentPassword: credentials.admin.password }, admin.cookie));
    assert.equal(response.status, ['missing-audit', 'delete-failure'].includes(change) ? 500 : 409, change);
    assert.equal(sqlite.prepare('SELECT failures FROM user_security_question_locks WHERE user_id = ?').get(target).failures, 5, change);
    if (change !== 'missing-audit') assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM admin_credential_events').get().n, 0, change);
  }
});

test('parallel wrong answers cannot lose increments or exceed the five-answer lock cap', async t => {
  const { sqlite, db, credentials } = await fixture(t);
  const owner = await login(db, 'y', credentials.y.password);
  await onRequest(context('security-question', db, { currentPassword: credentials.y.password, question: 'My question here?', answer: '1' }, owner.cookie));
  const results = await Promise.all(Array.from({ length: 5 }, (_, i) => {
    const c = context('recover-password', db, { method: 'security-question', username: 'y', answer: 'wrong', newPassword: 'newsecret' });
    c.request.headers.set('CF-Connecting-IP', `198.51.100.${i}`);
    return recoverPassword(c);
  }));
  assert.ok(results.some(r => r.status === 423));
  assert.equal(sqlite.prepare('SELECT failures FROM user_security_question_locks WHERE user_id = ?').get(credentials.y.user_id).failures, 5);
  assert.equal((await recoverPassword(context('recover-password', db, { method: 'security-question', username: 'y', answer: '1', newPassword: 'newsecret' }))).status, 423);
});

test('a correct answer verified before the fifth failure cannot commit after recovery is locked', async t => {
  const { sqlite, db, credentials } = await fixture(t);
  const owner = await login(db, 'h', credentials.h.password);
  await onRequest(context('security-question', db, { currentPassword: credentials.h.password, question: 'My question here?', answer: '1' }, owner.cookie));
  const target = credentials.h.user_id;
  const before = sqlite.prepare('SELECT password_hash FROM users WHERE id = ?').get(target).password_hash;
  const raced = { ...db, async batch(statements) {
    if (statements[0].query.startsWith('UPDATE users SET password_salt')) sqlite.prepare('INSERT INTO user_security_question_locks VALUES (?, 5)').run(target);
    return db.batch(statements);
  } };
  assert.equal((await recoverPassword(context('recover-password', raced, { method: 'security-question', username: 'h', answer: '1', newPassword: 'newsecret' }))).status, 423);
  assert.equal(sqlite.prepare('SELECT password_hash FROM users WHERE id = ?').get(target).password_hash, before);
  assert.equal(sqlite.prepare('SELECT failures FROM user_security_question_locks WHERE user_id = ?').get(target).failures, 5);
});

test('successful answer recovery clears preceding failed answers', async t => {
  const { sqlite, db, credentials } = await fixture(t);
  const owner = await login(db, 'm', credentials.m.password);
  await onRequest(context('security-question', db, { currentPassword: credentials.m.password, question: 'My question here?', answer: '1' }, owner.cookie));
  const body = { method: 'security-question', username: 'm', answer: 'wrong', newPassword: 'newsecret' };
  assert.equal((await recoverPassword(context('recover-password', db, body))).status, 401);
  assert.equal(sqlite.prepare('SELECT failures FROM user_security_question_locks WHERE user_id = ?').get(credentials.m.user_id).failures, 1);
  assert.equal((await recoverPassword(context('recover-password', db, { ...body, answer: '1' }))).status, 200);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM user_security_question_locks WHERE user_id = ?').get(credentials.m.user_id).n, 0);
});
