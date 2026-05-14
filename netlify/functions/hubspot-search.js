// HubSpot search proxy.
// Receives the same params shape the Cowork artifacts used to send to MCP,
// forwards to HubSpot's /crm/v3/objects/{type}/search with the server-side token.
//
// Auth: requires a valid Netlify Identity JWT in context.clientContext.user.
// Domain enforcement: only emails ending in @prescriberpoint.com may call this.

const ALLOWED_DOMAIN = '@prescriberpoint.com';

function normalizeObjectType(t) {
  if (!t) return null;
  const s = String(t).toLowerCase();
  if (s === 'contact' || s === 'contacts') return 'contacts';
  if (s === 'deal' || s === 'deals') return 'deals';
  if (s === 'company' || s === 'companies') return 'companies';
  if (s === 'ticket' || s === 'tickets') return 'tickets';
  return s; // pass through for custom objects
}

exports.handler = async (event, context) => {
  // ---- Auth gate ----
  const user = context.clientContext && context.clientContext.user;
  if (!user) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: 'Unauthorized — please log in.' })
    };
  }
  const email = (user.email || '').toLowerCase();
  if (!email.endsWith(ALLOWED_DOMAIN)) {
    return {
      statusCode: 403,
      body: JSON.stringify({ error: `Forbidden — only ${ALLOWED_DOMAIN} accounts allowed.` })
    };
  }

  // ---- Method check ----
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'POST only.' })
    };
  }

  // ---- Token check ----
  const token = process.env.HUBSPOT_TOKEN;
  if (!token) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server missing HUBSPOT_TOKEN env var.' })
    };
  }

  // ---- Body parse ----
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid JSON body.' })
    };
  }

  const { objectType, filterGroups, properties, limit, sorts, after } = body;
  const objType = normalizeObjectType(objectType);
  if (!objType) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'objectType required.' })
    };
  }

  // ---- Build HubSpot request ----
  const hubspotUrl = `https://api.hubapi.com/crm/v3/objects/${objType}/search`;
  const hubspotBody = {
    filterGroups: filterGroups || [],
    properties: properties || [],
    limit: typeof limit === 'number' ? limit : 10,
    sorts: sorts || []
  };
  if (after) hubspotBody.after = after;

  // ---- Call HubSpot ----
  try {
    const response = await fetch(hubspotUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(hubspotBody)
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({
          error: 'HubSpot API error.',
          status: response.status,
          detail: data
        })
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
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
