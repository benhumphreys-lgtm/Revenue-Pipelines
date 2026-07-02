// Frontend wrapper around the /api/hubspot-search Netlify Function.
// Drop-in replacement for the Cowork window.cowork.callMcpTool(..._search_crm_objects, ...) pattern.
// Returns the parsed HubSpot response — same { total, results } shape the artifacts expect.

(function () {
  async function hubspotSearch(params) {
    if (!window.netlifyIdentity) {
      throw new Error('Netlify Identity widget not loaded.');
    }
    const user = window.netlifyIdentity.currentUser();
    if (!user) {
      throw new Error('Not authenticated. Please log in.');
    }
    // Fresh JWT (auto-refreshes if expired)
    const jwt = await user.jwt();
    // Strip MCP-only fields that HubSpot doesn't care about
    const { chatInsights, ...cleanParams } = params || {};
    const response = await fetch('/api/hubspot-search', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${jwt}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(cleanParams)
    });
    if (!response.ok) {
      let errData = {};
      try { errData = await response.json(); } catch (e) {}
      let detailMsg = '';
      if (errData.detail) {
        if (typeof errData.detail === 'string') detailMsg = errData.detail;
        else if (errData.detail.message) detailMsg = errData.detail.message;
        else detailMsg = JSON.stringify(errData.detail).slice(0, 200);
      }
      throw new Error(`HubSpot search failed (${response.status}): ${errData.error || response.statusText}${detailMsg ? ' — ' + detailMsg : ''}`);
    }
    const data = await response.json();
    // Flatten properties to the top level of each result, in addition to keeping
    // the standard nested .properties object. The Cowork MCP tools return results
    // with properties at the top level (e.g. r.hs_lead_name), while HubSpot's
    // v3 search API nests them (r.properties.hs_lead_name). This dual-shape
    // satisfies BOTH calling conventions used by ported artifacts.
    if (data && Array.isArray(data.results)) {
      data.results = data.results.map(r => {
        if (r && r.properties && typeof r.properties === 'object') {
          return { ...r.properties, ...r };
        }
        return r;
      });
    }
    // Also expose the MCP envelope shape that newer artifacts expect.
    // Pattern they use: `r.structuredContent ?? JSON.parse(r.content[0].text)`.
    // Build the stringified fallback BEFORE adding the self-reference, otherwise
    // JSON.stringify will hit a circular structure.
    const envelopeText = JSON.stringify(data);
    data.structuredContent = data;
    data.content = [{ type: 'text', text: envelopeText }];
    return data;
  }

  // Owners lookup: fetches all HubSpot owners. Original artifacts called this with
  // an ownerIds array, but the underlying HubSpot API doesn't filter that way —
  // we just return all owners and let the artifact build its own ID-to-name map.
  let _ownersCache = null;
  async function hubspotOwners(_params) {
    if (_ownersCache) return _ownersCache;
    if (!window.netlifyIdentity) {
      throw new Error('Netlify Identity widget not loaded.');
    }
    const user = window.netlifyIdentity.currentUser();
    if (!user) {
      throw new Error('Not authenticated. Please log in.');
    }
    const jwt = await user.jwt();
    const response = await fetch('/api/hubspot-owners', {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${jwt}` }
    });
    if (!response.ok) {
      let errData = {};
      try { errData = await response.json(); } catch (e) {}
      throw new Error(`HubSpot owners failed (${response.status}): ${errData.error || response.statusText}`);
    }
    _ownersCache = await response.json();
    return _ownersCache;
  }

  // Google Drive export: fetches a Sheet/Doc as CSV (or other format) via the
  // gdrive-export Netlify Function. Used by the Meeting Factory dashboard.
  // Returns the raw export text (e.g. CSV string).
  async function gdriveExport(params) {
    if (!window.netlifyIdentity) {
      throw new Error('Netlify Identity widget not loaded.');
    }
    const user = window.netlifyIdentity.currentUser();
    if (!user) {
      throw new Error('Not authenticated. Please log in.');
    }
    const jwt = await user.jwt();
    const response = await fetch('/api/gdrive-export', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${jwt}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(params || {})
    });
    if (!response.ok) {
      let errData = {};
      try { errData = await response.json(); } catch (e) {}
      const errBits = [errData.error || response.statusText];
      if (errData.detail && errData.detail !== errData.error) errBits.push(errData.detail);
      throw new Error(`Google Drive export failed (${response.status}): ${errBits.join(' — ')}`);
    }
    return await response.text();
  }

  // Normalize the NEW HubSpot MCP tool param shape to the shape my function expects.
  // New shape (from rp-dashboard / meeting-factory): { object_type, filters: jsonString, properties: csv, limit, after }
  // Old shape (what my function takes):              { objectType, filterGroups: [{filters: [...]}], properties: [], limit, after }
  function normalizeSearchParams(params) {
    if (!params) return params;
    // If old-shape, pass through
    if (params.objectType || params.filterGroups) return params;
    const out = { ...params };
    // object_type → objectType
    if (params.object_type && !out.objectType) out.objectType = params.object_type;
    delete out.object_type;
    // filters (JSON string) → filterGroups
    if (typeof params.filters === 'string') {
      try {
        const arr = JSON.parse(params.filters);
        out.filterGroups = [{ filters: arr.map(f => ({
          propertyName: f.property || f.propertyName,
          operator: f.operator,
          value: f.value,
          values: f.values,
          highValue: f.highValue
        })) }];
        delete out.filters;
      } catch (e) {
        delete out.filters;
      }
    } else if (Array.isArray(params.filters) && !out.filterGroups) {
      out.filterGroups = [{ filters: params.filters }];
      delete out.filters;
    }
    // properties CSV → array
    if (typeof params.properties === 'string' && !Array.isArray(params.properties)) {
      out.properties = params.properties.split(',').map(s => s.trim()).filter(Boolean);
    }
    // sorts JSON-string → array (the new artifacts send this as a JSON-stringified array)
    if (typeof params.sorts === 'string') {
      try {
        out.sorts = JSON.parse(params.sorts);
      } catch (e) {
        // Drop malformed sorts rather than crash the request
        delete out.sorts;
      }
    }
    return out;
  }

  // HubSpot GET-by-id — fetches a single record of any object type by ID.
  // Routes hubspot_get_contact, hubspot_get_deal, hubspot_get_custom_object to
  // the /api/hubspot-get Netlify Function. Normalizes the MCP tool param shape
  // (contact_id / deal_id → object_id, tool-specific object_type).
  async function hubspotGetById(objectType, params) {
    if (!window.netlifyIdentity) throw new Error('Netlify Identity widget not loaded.');
    const user = window.netlifyIdentity.currentUser();
    if (!user) throw new Error('Not authenticated. Please log in.');
    const jwt = await user.jwt();
    // Normalize params: hubspot_get_contact passes { contact_id }, hubspot_get_deal
    // passes { deal_id }, hubspot_get_custom_object passes { object_type, object_id, ... }.
    const p = params || {};
    const body = {
      object_type: p.object_type || objectType,
      object_id: p.object_id || p.contact_id || p.deal_id || p.id,
      properties: p.properties,
      associations: p.associations
    };
    const response = await fetch('/api/hubspot-get', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      let errData = {};
      try { errData = await response.json(); } catch (e) {}
      let detailMsg = '';
      if (errData.detail) {
        if (typeof errData.detail === 'string') detailMsg = errData.detail;
        else if (errData.detail.message) detailMsg = errData.detail.message;
        else detailMsg = JSON.stringify(errData.detail).slice(0, 200);
      }
      throw new Error(`HubSpot GET failed (${response.status}): ${errData.error || response.statusText}${detailMsg ? ' — ' + detailMsg : ''}`);
    }
    const data = await response.json();
    // Expose MCP envelope shape for artifacts that access res.structuredContent /
    // res.content[0].text. Build the stringified fallback BEFORE adding the self-ref
    // to avoid circular JSON.
    const envelopeText = JSON.stringify(data);
    data.structuredContent = data;
    data.content = [{ type: 'text', text: envelopeText }];
    return data;
  }

  // HubSpot associations (object-to-object walks)
  async function hubspotAssociations(params) {
    if (!window.netlifyIdentity) {
      throw new Error('Netlify Identity widget not loaded.');
    }
    const user = window.netlifyIdentity.currentUser();
    if (!user) throw new Error('Not authenticated. Please log in.');
    const jwt = await user.jwt();
    const response = await fetch('/api/hubspot-associations', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(params || {})
    });
    if (!response.ok) {
      let errData = {};
      try { errData = await response.json(); } catch (e) {}
      let detailMsg = '';
      if (errData.detail) {
        if (typeof errData.detail === 'string') detailMsg = errData.detail;
        else if (errData.detail.message) detailMsg = errData.detail.message;
        else detailMsg = JSON.stringify(errData.detail).slice(0, 200);
      }
      throw new Error(`HubSpot associations failed (${response.status}): ${errData.error || response.statusText}${detailMsg ? ' — ' + detailMsg : ''}`);
    }
    const data = await response.json();
    // Expose MCP envelope shape for artifacts that access res.structuredContent /
    // res.content[0].text. Without this, the Top 6 Account Map's rawCall unwrap
    // returns undefined and every assoc() call silently returns empty results.
    const envelopeText = JSON.stringify(data);
    data.structuredContent = data;
    data.content = [{ type: 'text', text: envelopeText }];
    return data;
  }

  // Compat shim: lets the Cowork artifact code work with minimal changes.
  window.cowork = {
    callMcpTool: function (toolName, params) {
      if (typeof toolName !== 'string') {
        return Promise.reject(new Error('Tool name must be a string'));
      }
      // OLD HubSpot MCP tools (mcp__80845023-...)
      if (toolName.includes('search_crm_objects')) {
        return hubspotSearch(params);
      }
      if (toolName.includes('search_owners')) {
        return hubspotOwners(params);
      }
      // NEW HubSpot MCP tools (mcp__6b11666e-...)
      if (toolName.includes('hubspot_search_custom_objects') || toolName.includes('hubspot_search_deals') || toolName.includes('hubspot_search_contacts')) {
        return hubspotSearch(normalizeSearchParams(params));
      }
      if (toolName.includes('hubspot_list_owners')) {
        return hubspotOwners(params);
      }
      if (toolName.includes('hubspot_get_custom_object_associations')) {
        return hubspotAssociations(params);
      }
      // GET-by-id routes for the Top 6 Account Map dashboard.
      // hubspot_get_custom_object_associations is matched ABOVE this one — so
      // this hubspot_get_custom_object match won't accidentally intercept it.
      if (toolName.includes('hubspot_get_contact')) {
        return hubspotGetById('contacts', params);
      }
      if (toolName.includes('hubspot_get_deal')) {
        return hubspotGetById('deals', params);
      }
      if (toolName.includes('hubspot_get_custom_object')) {
        return hubspotGetById(params && params.object_type, params);
      }
      if (toolName.includes('gdrive_export_file')) {
        return gdriveExport(params);
      }
      return Promise.reject(new Error('Unsupported MCP tool in Netlify build: ' + toolName));
    }
  };

  // Also expose directly for any new code
  window.hubspotSearch = hubspotSearch;
  window.hubspotOwners = hubspotOwners;
  window.hubspotAssociations = hubspotAssociations;
  window.hubspotGetById = hubspotGetById;
  window.gdriveExport = gdriveExport;

  // Auth helpers used by tab pages
  window.appAuth = {
    init: function (onAuthed) {
      const id = window.netlifyIdentity;
      if (!id) {
        console.error('Netlify Identity widget not loaded on this page.');
        document.body.innerHTML = '<div style="padding:40px;text-align:center;font-family:sans-serif"><h1>Identity widget failed to load</h1><p>Check network tab or contact admin.</p></div>';
        return;
      }

      function checkUser(user) {
        if (!user) {
          // Not logged in — open the widget (it handles invite tokens in URL hash automatically)
          id.open();
          return;
        }
        const email = (user.email || '').toLowerCase();
        if (!email.endsWith('@prescriberpoint.com')) {
          alert('Only @prescriberpoint.com accounts can access this dashboard. Logging out.');
          id.logout();
          return;
        }
        onAuthed(user);
      }

      // Register login/logout listeners
      id.on('login', user => { id.close(); checkUser(user); });
      id.on('logout', () => { location.reload(); });

      // The widget script loads synchronously before this defer script runs,
      // so by now currentUser() is reliable. But we also register an init
      // listener as a fallback in case the widget is still initializing.
      let handled = false;
      function handle(user) {
        if (handled) return;
        handled = true;
        checkUser(user);
      }

      const existing = id.currentUser();
      if (existing) {
        handle(existing);
      } else {
        id.on('init', handle);
        // Safety net: if init never fires within 1.5s, treat as not logged in
        setTimeout(() => handle(id.currentUser()), 1500);
      }
    },
    logout: function () { window.netlifyIdentity.logout(); }
  };
})();
