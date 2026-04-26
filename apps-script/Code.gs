// Google Apps Script backend for the network addiction quiz.
//
// Setup:
// 1. Create a new Google Sheet.
// 2. Extensions → Apps Script. Replace Code.gs contents with this file.
// 3. Set TEACHER_KEY below to a random string (only the teacher uses it).
//    Students never see this key — they authenticate via per-session tokens.
// 4. Deploy → New deployment → Type: Web app.
//      Execute as: Me
//      Who has access: Anyone
// 5. Copy the Web App URL into index.html (WEB_APP_URL constant).
// 6. Re-deploy after any change: Manage deployments → edit → New version.
//
// Security model:
//   - Teacher creates a session with TEACHER_KEY. Backend returns a short-lived token.
//   - QR includes ?session=ABC&token=XYZ.
//   - Students submit with that token. Backend validates session+token+expiry+count.
//   - URL leak only exposes one session for at most SESSION_TTL_MS.

const SHEET_NAME = 'Responses';
const TEACHER_KEY = 'CHANGE_ME_TEACHER_KEY';
const SESSION_TTL_MS = 4 * 60 * 60 * 1000;     // 4 hours
const MAX_PER_SESSION = 200;
const MAX_NAME_LEN = 30;
const QUESTION_COUNT = 10;

function doGet(e) {
  const p = (e && e.parameter) || {};
  const action = p.action || '';

  if (action === 'createSession') {
    if (p.teacherKey !== TEACHER_KEY) return json({ ok: false, error: 'unauthorized' });
    return json(createSession());
  }
  if (action === 'results') {
    if (p.teacherKey !== TEACHER_KEY) return json({ ok: false, error: 'unauthorized' });
    return json(getResults(p.session || ''));
  }
  if (action === 'sessionInfo') {
    return json(sessionInfo(p.session || ''));
  }
  return json({ ok: true, msg: 'quiz backend alive' });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
  } catch (err) {
    return json({ ok: false, error: 'busy, try again' });
  }
  try {
    const data = JSON.parse(e.postData.contents);
    const v = validateSubmission(data);
    if (!v.ok) return json(v);
    if (attemptIdExists(data.attemptId)) return json({ ok: true, dedup: true });
    const score = data.answers.reduce((a, b) => a + b, 0);
    appendRow(data, score, data.attemptId);
    incrementSessionCount(data.session);
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// --- Session management ---

function createSession() {
  const code = randomCode(5);
  const token = randomCode(20);
  const now = Date.now();
  const sess = {
    token: token,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
    count: 0
  };
  PropertiesService.getScriptProperties().setProperty('session:' + code, JSON.stringify(sess));
  return { ok: true, session: code, token: token, expiresAt: sess.expiresAt };
}

function getSession(code) {
  if (!code) return null;
  const raw = PropertiesService.getScriptProperties().getProperty('session:' + code);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

function sessionInfo(code) {
  const s = getSession(code);
  if (!s) return { ok: false, error: 'session not found' };
  return { ok: true, expiresAt: s.expiresAt, count: s.count, full: s.count >= MAX_PER_SESSION };
}

function incrementSessionCount(code) {
  const s = getSession(code);
  if (!s) return;
  s.count++;
  PropertiesService.getScriptProperties().setProperty('session:' + code, JSON.stringify(s));
}

// Optional helper: clean up old sessions. You can run this manually from the editor.
function cleanupExpiredSessions() {
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  const now = Date.now();
  Object.keys(all).forEach(k => {
    if (k.indexOf('session:') !== 0) return;
    try {
      const s = JSON.parse(all[k]);
      if (now > s.expiresAt + 24 * 60 * 60 * 1000) props.deleteProperty(k);
    } catch (e) { props.deleteProperty(k); }
  });
}

// --- Validation ---

function validateSubmission(data) {
  if (!data || typeof data !== 'object') return { ok: false, error: 'bad payload' };
  if (typeof data.session !== 'string' || !data.session) return { ok: false, error: 'missing session' };
  if (typeof data.token !== 'string' || !data.token) return { ok: false, error: 'missing token' };
  if (typeof data.attemptId !== 'string' || !data.attemptId) return { ok: false, error: 'missing attemptId' };
  if (typeof data.name !== 'string') return { ok: false, error: 'bad name' };
  if (data.name.length > MAX_NAME_LEN) return { ok: false, error: 'name too long' };
  if (!Array.isArray(data.answers) || data.answers.length !== QUESTION_COUNT) return { ok: false, error: 'bad answers' };
  if (!data.answers.every(a => a === 0 || a === 1)) return { ok: false, error: 'bad answers' };

  const sess = getSession(data.session);
  if (!sess) return { ok: false, error: 'session not found' };
  if (sess.token !== data.token) return { ok: false, error: 'invalid token' };
  if (Date.now() > sess.expiresAt) return { ok: false, error: 'session expired' };
  if (sess.count >= MAX_PER_SESSION) return { ok: false, error: 'session full' };

  return { ok: true };
}

// --- Sheet I/O ---

function attemptIdExists(id) {
  const sheet = getSheet();
  const last = sheet.getLastRow();
  if (last < 2) return false;
  const ids = sheet.getRange(2, 6, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === id) return true;
  }
  return false;
}

function appendRow(data, score, attemptId) {
  const sheet = getSheet();
  sheet.appendRow([
    new Date(),
    data.session || '',
    String(data.name || '').slice(0, MAX_NAME_LEN),
    score,
    data.answers.join(','),
    attemptId
  ]);
}

function getResults(session) {
  const sheet = getSheet();
  const values = sheet.getDataRange().getValues();
  const rows = values.slice(1).filter(r => !session || String(r[1]) === session);
  const submissions = rows.map(r => ({
    time: r[0] instanceof Date ? r[0].toISOString() : String(r[0]),
    name: String(r[2] || ''),
    score: Number(r[3]) || 0,
    answers: String(r[4] || '').split(',').filter(Boolean).map(Number)
  }));
  return { ok: true, session: session, count: submissions.length, submissions: submissions };
}

function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(['Time', 'Session', 'Name', 'Score', 'Answers', 'AttemptId']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// --- Utils ---

function randomCode(len) {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
