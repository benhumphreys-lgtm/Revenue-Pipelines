// HubSpot owners lookup proxy.
// Fetches the full list of HubSpot owners (users with seats), transforms to the
// shape the original Cowork artifacts' search_owners MCP tool returned, and
// caches per-request. Used to resolve hubspot_owner_id values to display names.
//
// Auth: requires a valid Netlify Identity JWT in context.clientContext.user.
// Domain enforcement: only emails ending in @prescriberpoint.com may call this.

const ALLOWED_DOMAIN = '@prescriberpoint.com';

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

  const token = process.env.HUBSPOT_TOKEN;
  if (!token) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server missing HUBSPOT_TOKEN env var.' }) };
  }

  try {
    // Paginate through all owners (HubSpot returns up to 100 per page).
    // PrescriberPoint has well under 500 owners so 5 pages is plenty of headroom.
    let allOwners = [];
    let after = null;
    for (let i = 0; i < 5; i++) {
      const url = new URL('https://api.hubapi.com/crm/v3/owners');
      url.searchParams.set('limit', '100');
      if (after) url.searchParams.set('after', after);

      const resp = await fetch(url.toString(), {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await resp.json();
      if (!resp.ok) {
        return {
          statusCode: resp.status,
          body: JSON.stringify({ error: 'HubSpot owners API error.', detail: data })
        };
      }
      allOwners = allOwners.concat(data.results || []);
      after = data.paging && data.paging.next && data.paging.next.after;
      if (!after) break;
    }

    // Transform to the shape the artifact expects: { owners: [{ownerId, name}, ...] }
    const owners = allOwners.map(o => ({
      ownerId: parseInt(o.id, 10),
      name: [o.firstName, o.lastName].filter(Boolean).join(' ') || o.email || `Owner ${o.id}`,
      email: o.email || null
    }));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owners })
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
