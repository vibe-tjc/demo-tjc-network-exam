// Google Apps Script backend for the network addiction quiz.
// Setup:
// 1. Create a new Google Sheet.
// 2. Extensions → Apps Script. Replace Code.gs contents with this file.
// 3. Set SHARED_SECRET below to a random string. The same value must be set
//    in index.html (SHARED_SECRET constant).
// 4. Deploy → New deployment → Type: Web app.
//    - Execute as: Me
//    - Who has access: Anyone
// 5. Copy the Web App URL into index.html (WEB_APP_URL constant).
// 6. Re-deploy whenever you change this script: Manage deployments → edit → New version.

const SHEET_NAME = 'Responses';
const SHARED_SECRET = 'CHANGE_ME_TO_A_RANDOM_STRING';

function doGet(e) {
  const params = (e && e.parameter) || {};
  const action = params.action || '';
  const session = params.session || '';
  const key = params.key || '';
  if (action === 'results') {
    if (key !== SHARED_SECRET) return json({ ok: false, error: 'unauthorized' });
    return json(getResults(session));
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
    if (data.key !== SHARED_SECRET) return json({ ok: false, error: 'unauthorized' });
    const attemptId = String(data.attemptId || '');
    if (!attemptId) return json({ ok: false, error: 'missing attemptId' });
    if (attemptIdExists(attemptId)) return json({ ok: true, dedup: true });
    appendRow(data, attemptId);
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

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

function appendRow(data, attemptId) {
  const sheet = getSheet();
  sheet.appendRow([
    new Date(),
    data.session || '',
    data.name || '',
    Number(data.score) || 0,
    (data.answers || []).join(','),
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

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
