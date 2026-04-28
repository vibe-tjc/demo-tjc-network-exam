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
//   - Teacher creates a session with TEACHER_KEY (POST). Backend returns a short-lived token.
//   - QR includes ?session=ABC&token=XYZ.
//   - Students submit with that token. Backend validates session+token+expiry+count+set.
//   - URL leak only exposes one session for at most SESSION_TTL_MS.
//
// Set support:
//   - Each session is bound to a question set (built-in id or full custom payload).
//   - Sets are stored inside the session record in PropertiesService.
//   - Students fetch the set via ?action=getSet (no auth — set definitions are not secret).

const SHEET_NAME = 'Responses';
const TEACHER_KEY = 'CHANGE_ME_TEACHER_KEY';
const SESSION_TTL_MS = 4 * 60 * 60 * 1000;     // 4 hours
const MAX_PER_SESSION = 200;
const MAX_NAME_LEN = 30;
const MIN_QUESTIONS = 5;
const MAX_QUESTIONS = 20;
const LEGACY_QUESTION_COUNT = 10; // for sessions created before set support

const SHEET_HEADERS = ['Time', 'Session', 'Name', 'Score', 'Answers', 'AttemptId', 'Set'];

function doGet(e) {
  const p = (e && e.parameter) || {};
  const action = p.action || '';

  if (action === 'results') {
    if (p.teacherKey !== TEACHER_KEY) return json({ ok: false, error: 'unauthorized' });
    return json(getResults(p.session || ''));
  }
  if (action === 'sessionInfo') {
    return json(sessionInfo(p.session || ''));
  }
  if (action === 'getSet') {
    return json(getSetForSession(p.session || ''));
  }
  return json({ ok: true, msg: 'quiz backend alive' });
}

function doPost(e) {
  // Routing: createSession comes via POST so it can carry a set payload.
  // Submissions are POST without an ?action= param (legacy behaviour).
  let body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json({ ok: false, error: 'bad payload' }); }
  const action = (e && e.parameter && e.parameter.action) || body.action || '';

  if (action === 'createSession') {
    if (body.teacherKey !== TEACHER_KEY) return json({ ok: false, error: 'unauthorized' });
    return json(createSession(body.set));
  }

  return submitAnswers(body);
}

function submitAnswers(data) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
  } catch (err) {
    return json({ ok: false, error: 'busy, try again' });
  }
  try {
    const v = validateSubmission(data);
    if (!v.ok) return json(v);
    if (attemptIdExists(data.attemptId)) return json({ ok: true, dedup: true });
    const score = data.answers.reduce((a, b) => a + b, 0);
    const sess = getSession(data.session);
    const setId = (sess && sess.set && sess.set.id) || 'adults';
    appendRow(data, score, data.attemptId, setId);
    incrementSessionCount(data.session);
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// --- Session management ---

function createSession(setPayload) {
  const set = normalizeSet(setPayload);
  if (!set.ok) return set;
  const code = randomCode(5);
  const token = randomCode(20);
  const now = Date.now();
  const sess = {
    token: token,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
    count: 0,
    set: set.set
  };
  PropertiesService.getScriptProperties().setProperty('session:' + code, JSON.stringify(sess));
  return { ok: true, session: code, token: token, expiresAt: sess.expiresAt, set: set.set };
}

function normalizeSet(payload) {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, error: 'missing set' };
  }
  if (payload.kind === 'builtin') {
    if (typeof payload.id !== 'string') return { ok: false, error: 'bad set id' };
    const count = Number(payload.questionCount);
    if (!Number.isFinite(count) || count < MIN_QUESTIONS || count > MAX_QUESTIONS) {
      return { ok: false, error: 'bad question count' };
    }
    return { ok: true, set: { id: payload.id, kind: 'builtin', questionCount: count } };
  }
  if (payload.kind === 'custom') {
    if (typeof payload.id !== 'string' || !payload.id) return { ok: false, error: 'bad set id' };
    if (!Array.isArray(payload.questions)) return { ok: false, error: 'bad questions' };
    if (payload.questions.length < MIN_QUESTIONS || payload.questions.length > MAX_QUESTIONS) {
      return { ok: false, error: 'bad question count' };
    }
    for (let i = 0; i < payload.questions.length; i++) {
      const q = payload.questions[i];
      if (!q || typeof q.emoji !== 'string' || typeof q.text !== 'string') {
        return { ok: false, error: 'bad question at row ' + (i + 1) };
      }
    }
    const rubric = Array.isArray(payload.rubric) ? payload.rubric : [];
    return {
      ok: true,
      set: {
        id: payload.id,
        kind: 'custom',
        title: String(payload.title || '自訂題庫').slice(0, 60),
        description: String(payload.description || '').slice(0, 200),
        questions: payload.questions.map(q => ({
          emoji: String(q.emoji).slice(0, 8),
          text: String(q.text).slice(0, 120)
        })),
        rubric: rubric,
        questionCount: payload.questions.length
      }
    };
  }
  return { ok: false, error: 'bad set kind' };
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

function getSetForSession(code) {
  const s = getSession(code);
  if (!s) return { ok: false, error: 'session not found' };
  // Sessions created before set support have no `.set` field — treat as legacy adults set.
  const set = s.set || { id: 'adults', kind: 'builtin', questionCount: LEGACY_QUESTION_COUNT };
  return { ok: true, set: set };
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
  if (!Array.isArray(data.answers)) return { ok: false, error: 'bad answers' };
  if (!data.answers.every(a => a === 0 || a === 1)) return { ok: false, error: 'bad answers' };

  const sess = getSession(data.session);
  if (!sess) return { ok: false, error: 'session not found' };
  if (sess.token !== data.token) return { ok: false, error: 'invalid token' };
  if (Date.now() > sess.expiresAt) return { ok: false, error: 'session expired' };
  if (sess.count >= MAX_PER_SESSION) return { ok: false, error: 'session full' };

  const expected = (sess.set && sess.set.questionCount) || LEGACY_QUESTION_COUNT;
  if (data.answers.length !== expected) return { ok: false, error: 'bad answers' };

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

function appendRow(data, score, attemptId, setId) {
  const sheet = getSheet();
  sheet.appendRow([
    new Date(),
    data.session || '',
    String(data.name || '').slice(0, MAX_NAME_LEN),
    score,
    data.answers.join(','),
    attemptId,
    setId || ''
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
    answers: String(r[4] || '').split(',').filter(Boolean).map(Number),
    set: String(r[6] || '')
  }));
  return { ok: true, session: session, count: submissions.length, submissions: submissions };
}

function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(SHEET_HEADERS);
    sheet.setFrozenRows(1);
    return sheet;
  }
  // Migrate older sheets that pre-date the Set column.
  const lastCol = sheet.getLastColumn();
  if (lastCol < SHEET_HEADERS.length) {
    sheet.getRange(1, lastCol + 1, 1, SHEET_HEADERS.length - lastCol)
      .setValues([SHEET_HEADERS.slice(lastCol)]);
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
