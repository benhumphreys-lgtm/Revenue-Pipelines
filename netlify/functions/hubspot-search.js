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
  if (s === 'contact' || s === 'contacts' || s === '0-1') return 'contacts';
  if (s === 'deal' || s === 'deals' || s === '0-3') return 'deals';
  if (s === 'company' || s === 'companies' || s === '0-2') return 'companies';
  if (s === 'ticket' || s === 'tickets' || s === '0-5') return 'tickets';
  if (s === 'lead' || s === 'leads' || s === '0-136') return 'leads';
  return s; // pass through for custom objects (e.g., "2-37656252")
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

  // ---- Call HubSpot with retry-on-429 ----
  async function fetchWithRetry(url, options, maxRetries = 2) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const resp = await fetch(url, options);
      if (resp.status !== 429 || attempt === maxRetries) return resp;
      // Respect Retry-After header if present, otherwise backoff 1s, 2s
      const retryAfter = parseInt(resp.headers.get('Retry-After') || '', 10);
      const waitMs = (isFinite(retryAfter) && retryAfter > 0)
        ? Math.min(retryAfter * 1000, 3000)
        : (1000 * (attempt + 1));
      await new Promise(r => setTimeout(r, waitMs));
    }
  }

  try {
    const response = await fetchWithRetry(hubspotUrl, {
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
