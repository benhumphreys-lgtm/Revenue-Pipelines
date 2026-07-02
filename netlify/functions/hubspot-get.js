// HubSpot GET-by-id proxy.
// Fetches a single record of any object type (contacts, deals, custom objects) by ID.
// Used by the Top 6 Account Map dashboard, which calls hubspot_get_contact,
// hubspot_get_deal, and hubspot_get_custom_object for every lead / deal / meeting / task.
//
// Auth: requires a valid Netlify Identity JWT and @prescriberpoint.com email.
// Body: {
//   object_type: "contacts" | "deals" | "0-47" | "0-27" | "0-136" | ...,
//   object_id: "12345",
//   properties?: "prop1,prop2,prop3",    // CSV string (matches MCP tool shape)
//   associations?: "contacts,deals"      // CSV string
// }
// Returns: HubSpot v3 GET-by-id response, with properties FLATTENED to top level
//          alongside the nested .properties object (dual shape for artifact compat).

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

  const { object_type, object_id, properties, associations } = body;
  if (!object_type || !object_id) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'object_type and object_id both required.' })
    };
  }

  // Normalize object_type — allow "0-136" → "leads" style aliasing (same as hubspot-search).
  const objTypeMap = {
    '0-1': 'contacts',
    '0-3': 'deals',
    '0-136': 'leads'
  };
  const resolvedType = objTypeMap[object_type] || object_type;

  const params = new URLSearchParams();
  if (properties) {
    const propsCsv = Array.isArray(properties) ? properties.join(',') : String(properties);
    if (propsCsv) params.set('properties', propsCsv);
  }
  if (associations) {
    const assocCsv = Array.isArray(associations) ? associations.join(',') : String(associations);
    if (assocCsv) params.set('associations', assocCsv);
  }
  // Always request archived=false (default) and standard fields
  const url = `https://api.hubapi.com/crm/v3/objects/${encodeURIComponent(resolvedType)}/${encodeURIComponent(object_id)}${params.toString() ? '?' + params.toString() : ''}`;

  // Retry once on 429 rate limits with a short backoff.
  async function fetchOnce() {
    return fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
  }

  try {
    let response = await fetchOnce();
    if (response.status === 429) {
      await new Promise(r => setTimeout(r, 800));
      response = await fetchOnce();
    }
    const data = await response.json();

    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({
          error: 'HubSpot GET-by-id API error.',
          status: response.status,
          detail: data
        })
      };
    }

    // Flatten properties to top level for artifact compat (matches hubspot-search behavior).
    // HubSpot v3 GET returns { id, properties: {...}, associations?: {...}, createdAt, updatedAt }
    // Artifacts access c.jobtitle, d.dealname, m.hs_meeting_title (top-level).
    if (data && data.properties && typeof data.properties === 'object') {
      const flat = { ...data.properties, ...data };
      // Preserve .properties nested (some artifacts still use it)
      flat.properties = data.properties;
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(flat)
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
      body: JSON.stringify({ error: 'Function execution error.', detail: err && err.message ? err.message : String(err) })
    };
  }
};
