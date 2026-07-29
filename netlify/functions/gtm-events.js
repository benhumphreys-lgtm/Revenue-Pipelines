// GTM Calendar shared team events store.
// Backed by Netlify Blobs — one blob per site holds the whole team's
// user-added events + overrides on curated seed events.
//
// Auth: requires a valid Netlify Identity JWT and @prescriberpoint.com email.
// Body: { action: "get" }  → { userEvents: [], overrides: {}, updatedAt, updatedBy }
//   OR: { action: "save", userEvents: [...], overrides: {...} } → { ok: true, updatedAt }
//
// Concurrency: last-write-wins. The frontend polls periodically to pick up
// changes from other users.

const { getStore } = require('@netlify/blobs');

const ALLOWED_DOMAIN = '@prescriberpoint.com';
const STORE_NAME = 'gtm-calendar';
const BLOB_KEY = 'shared-events-v1';

exports.handler = async (event, context) => {
  // Auth gate
  const user = context.clientContext && context.clientContext.user;
  if (!user) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized — please log in.' }) };
  }
  const email = (user.email || '').toLowerCase();
  if (!email.endsWith(ALLOWED_DOMAIN)) {
    return { statusCode: 403, body: JSON.stringify({ error: `Forbidden — only ${ALLOWED_DOMAIN} accounts allowed.` }) };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'POST only.' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body.' }) };
  }

  const action = body.action;
  let store;
  try {
    store = getStore(STORE_NAME);
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Failed to init Netlify Blob store.',
        detail: err && err.message ? err.message : String(err)
      })
    };
  }

  try {
    if (action === 'get') {
      const raw = await store.get(BLOB_KEY);
      if (!raw) {
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userEvents: [], overrides: {}, updatedAt: null, updatedBy: null })
        };
      }
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: raw };
    }

    if (action === 'save') {
      const payload = {
        userEvents: Array.isArray(body.userEvents) ? body.userEvents : [],
        overrides: (body.overrides && typeof body.overrides === 'object') ? body.overrides : {},
        updatedAt: new Date().toISOString(),
        updatedBy: user.email
      };
      await store.set(BLOB_KEY, JSON.stringify(payload));
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true, updatedAt: payload.updatedAt, updatedBy: payload.updatedBy })
      };
    }

    return {
      statusCode: 400,
      body: JSON.stringify({ error: `Unknown action: ${action}. Use "get" or "save".` })
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Blob store operation failed.',
        detail: err && err.message ? err.message : String(err)
      })
    };
  }
};
