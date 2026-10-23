// HubSpot update-by-id proxy — PATCH a single record's properties.
// Used by the Accountability sub-view to change rp_tier on an RP record,
// and generally any property update on any object type.
//
// Auth: requires a valid Netlify Identity JWT and @prescriberpoint.com email.
// Body: {
//   object_type: "2-37656252" | "contacts" | "deals" | "0-136" | ...,
//   object_id: "26400465215",
//   properties: { rp_tier: "TIER 1: ACTIVE PUSH", ... }
// }
// Returns: HubSpot v3 PATCH response (updated record).

const ALLOWED_DOMAIN = '@prescriberpoint.com';

exports.handler = async (event, context) => {
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

  const token = process.env.HUBSPOT_TOKEN;
  if (!token) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server missing HUBSPOT_TOKEN env var.' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body.' }) };
  }

  const { object_type, object_id, properties } = body;
  if (!object_type || !object_id || !properties || typeof properties !== 'object') {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'object_type, object_id, and properties (object) all required.' })
    };
  }

  // Standard-object aliases
  const objTypeMap = { '0-1': 'contacts', '0-3': 'deals', '0-136': 'leads' };
  const resolvedType = objTypeMap[object_type] || object_type;
  const url = `https://api.hubapi.com/crm/v3/objects/${encodeURIComponent(resolvedType)}/${encodeURIComponent(object_id)}`;

  try {
    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ properties })
    });
    const data = await response.json();

    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({
          error: 'HubSpot PATCH failed.',
          status: response.status,
          detail: data
        })
      };
    }

    // Audit log — append-only line per update, visible in Netlify function logs
    console.log(JSON.stringify({
      ts: new Date().toISOString(),
      user: user.email,
      object_type: resolvedType,
      object_id,
      properties_changed: Object.keys(properties),
      properties
    }));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, record: data })
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Function execution error.',
        detail: err && err.message ? err.message : String(err)
      })
    };
  }
};
