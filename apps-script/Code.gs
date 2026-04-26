// Google Apps Script backend for the network addiction quiz.
// Setup:
// 1. Create a new Google Sheet.
// 2. Extensions → Apps Script. Replace Code.gs contents with this file.
// 3. Deploy → New deployment → Type: Web app.
//    - Execute as: Me
//    - Who has access: Anyone
// 4. Copy the Web App URL into index.html (WEB_APP_URL constant).
// 5. Re-deploy whenever you change this script (or use "Manage deployments" → edit → New version).

const SHEET_NAME = 'Responses';

function doGet(e) {
  const action = (e.parameter && e.parameter.action) || '';
  const session = (e.parameter && e.parameter.session) || '';
  if (action === 'results') return json(getResults(session));
  return json({ ok: true, msg: 'quiz backend alive' });
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    appendRow(data);
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

function appendRow(data) {
  const sheet = getSheet();
  sheet.appendRow([
    new Date(),
    data.session || '',
    data.name || '',
    Number(data.score) || 0,
    (data.answers || []).join(',')
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
  return {
    ok: true,
    session: session,
    count: submissions.length,
    submissions: submissions
  };
}

function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(['Time', 'Session', 'Name', 'Score', 'Answers']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
