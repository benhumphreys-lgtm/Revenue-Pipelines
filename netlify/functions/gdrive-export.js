// Google Drive export proxy.
// Authenticates with a Google Cloud service account (credentials in env var
// GOOGLE_SERVICE_ACCOUNT_JSON), and exports a Google Doc/Sheet to a downloadable
// MIME type. Used by the Meeting Factory dashboard to pull live data from the
// HubSpot Master → Leads mirror sheet.
//
// Auth: requires a valid Netlify Identity JWT and @prescriberpoint.com email.
// Body: { file_id: "...", export_format?: "csv" | "tsv" | "xlsx" }
// Returns: raw export contents as text (CSV by default).

const { google } = require('googleapis');

const ALLOWED_DOMAIN = '@prescriberpoint.com';
const MIME_MAP = {
  csv:  'text/csv',
  tsv:  'text/tab-separated-values',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};

exports.handler = async (event, context) => {
  // ---- Auth gate ----
  const user = context.clientContext && context.clientContext.user;
  if (!user) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized — please log in.' }) };
  }
  const email = (user.email || '').toLowerCase();
  if (!email.endsWith(ALLOWED_DOMAIN)) {
    return { statusCode: 403, body: JSON.stringify({ error: `Forbidden — only ${ALLOWED_DOMAIN} accounts allowed.` }) };
  }

  // ---- Method check ----
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'POST only.' }) };
  }

  // ---- Credential check ----
  const credsRaw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!credsRaw) {
    return { statusCode: 500, body: JSON.stringify({
      error: 'Server missing GOOGLE_SERVICE_ACCOUNT_JSON env var. Add it in Netlify → Site configuration → Environment variables.'
    })};
  }
  let credentials;
  try {
    credentials = JSON.parse(credsRaw);
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({
      error: 'GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON. Paste the entire .json file contents as the env var value.'
    })};
  }

  // ---- Body parse ----
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body.' }) };
  }

  const { file_id, export_format } = body;
  if (!file_id) {
    return { statusCode: 400, body: JSON.stringify({ error: 'file_id required.' }) };
  }

  const fmt = String(export_format || 'csv').toLowerCase();
  const mimeType = MIME_MAP[fmt] || MIME_MAP.csv;

  // ---- Call Google Drive ----
  try {
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/drive.readonly']
    });
    const drive = google.drive({ version: 'v3', auth });
    const resp = await drive.files.export(
      { fileId: file_id, mimeType },
      { responseType: 'text' }
    );

    return {
      statusCode: 200,
      headers: { 'Content-Type': mimeType + '; charset=utf-8' },
      body: typeof resp.data === 'string' ? resp.data : String(resp.data)
    };
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    const code = err && err.code ? err.code : 500;
    // Surface common errors helpfully
    if (msg.includes('insufficient') || msg.includes('not found') || code === 404) {
      return { statusCode: 403, body: JSON.stringify({
        error: 'Service account cannot access this file. Share the sheet with the service account email (found in your GOOGLE_SERVICE_ACCOUNT_JSON under client_email).',
        detail: msg
      })};
    }
    return { statusCode: 500, body: JSON.stringify({
      error: 'Google Drive export failed.',
      detail: msg
    })};
  }
};
