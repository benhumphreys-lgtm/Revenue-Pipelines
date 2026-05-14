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

  // Compat shim: lets the Cowork artifact code work with minimal changes.
  // The artifacts call window.cowork.callMcpTool('mcp__..._search_crm_objects', params) — route that here.
  window.cowork = {
    callMcpTool: function (toolName, params) {
      if (typeof toolName === 'string' && toolName.includes('search_crm_objects')) {
        return hubspotSearch(params);
      }
      return Promise.reject(new Error('Unsupported MCP tool in Netlify build: ' + toolName));
    }
  };

  // Also expose directly for any new code
  window.hubspotSearch = hubspotSearch;

  // Auth helpers used by tab pages
  window.appAuth = {
    init: function (onAuthed) {
      const id = window.netlifyIdentity;
      if (!id) {
        console.error('Netlify Identity not on page');
        return;
      }

      function checkUser(user) {
        if (!user) {
          id.open('login');
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

      id.on('init', checkUser);
      id.on('login', user => { id.close(); checkUser(user); });
      id.on('logout', () => { location.reload(); });
    },
    logout: function () { window.netlifyIdentity.logout(); }
  };
})();
