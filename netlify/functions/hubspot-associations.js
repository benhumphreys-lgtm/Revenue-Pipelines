// HubSpot object-to-object associations proxy.
// Walks an association from one record (object_type + object_id) to all
// records of another type. Used by the RP Dashboard to walk lead → contacts,
// contact → RP custom object, deal → RP, etc.
//
// Auth: requires a valid Netlify Identity JWT and @prescriberpoint.com email.
// Body: { object_type: "deals" | "0-136" | "2-37656252", object_id: "...", to_object_type: "...", limit?: 10 }
// Returns: { results: [{ id, type }], paging?: { next: { after } } }

const ALLOWED_DOMAIN = '@prescriberpoint.com';

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

  const { object_type, object_id, to_object_type, limit, after } = body;
  if (!object_type || !object_id || !to_object_type) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'object_type, object_id, to_object_type all required.' })
    };
  }

  // HubSpot v4 associations endpoint:
  //   GET /crm/v4/objects/{fromType}/{fromId}/associations/{toType}
  const params = new URLSearchParams();
  if (limit) params.set('limit', String(limit));
  if (after) params.set('after', after);
  const url = `https://api.hubapi.com/crm/v4/objects/${encodeURIComponent(object_type)}/${encodeURIComponent(object_id)}/associations/${encodeURIComponent(to_object_type)}${params.toString() ? '?' + params.toString() : ''}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    const data = await response.json();

    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({
          error: 'HubSpot associations API error.',
          status: response.status,
          detail: data
        })
      };
    }

    // Normalize response shape: { results: [{ id, type }], paging? }
    // HubSpot v4 returns { results: [{ toObjectId, associationTypes }], paging }
    const results = (data.results || []).map(r => ({
      id: String(r.toObjectId || r.id || ''),
      type: to_object_type,
      associationTypes: r.associationTypes
    }));
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ results, paging: data.paging || undefined })
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Function execution error.', detail: err && err.message ? err.message : String(err) })
    };
  }
};
