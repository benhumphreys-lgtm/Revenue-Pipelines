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
      throw new Error(`HubSpot search failed (${response.status}): ${errData.error || response.statusText}`);
    }
    return response.json();
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

  // Compat shim: lets the Cowork artifact code work with minimal changes.
  window.cowork = {
    callMcpTool: function (toolName, params) {
      if (typeof toolName !== 'string') {
        return Promise.reject(new Error('Tool name must be a string'));
      }
      if (toolName.includes('search_crm_objects')) {
        return hubspotSearch(params);
      }
      if (toolName.includes('search_owners')) {
        return hubspotOwners(params);
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
