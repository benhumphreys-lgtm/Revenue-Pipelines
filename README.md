# Revenue Pipeline

Live, team-shared HubSpot dashboards for the PrescriberPoint revenue team.

**Live URL (after deploy):** `https://<your-site-name>.netlify.app`

**Tabs:**
- **Asembia 2026 Tracker** — event ROI, conversion funnel, post-event momentum
- **First Meeting Tracker** — multi-source first-meeting volume, WoW (coming in v0.2)
- **Pipeline Confidence Scorecard** — per-rep coverage vs. the $4M ARR gap (coming in v0.2)

Access restricted to `@prescriberpoint.com` Google accounts via Netlify Identity.

---

## Deploy this thing — step by step

You will:
1. Upload these files to your empty GitHub repo
2. Connect the repo to Netlify
3. Paste your HubSpot token into Netlify's env vars
4. Enable Netlify Identity + Google SSO + the email-domain rule
5. Verify it works

Estimated time: 30 minutes. None of this requires writing code.

### Step 1 — Upload these files to your GitHub repo

You should already have an empty private repo called `revenue-pipeline` under your account.

1. Open your empty repo at `https://github.com/benhumphreys-lgtm/revenue-pipeline`.
2. Click **"uploading an existing file"** (it's a link in the middle of the empty-repo page).
3. **Drag the entire `revenue-pipeline` folder** from your Mac Finder into the GitHub browser tab. You can drag the whole folder at once — GitHub will preserve the subdirectory structure (`netlify/functions/`, `public/`, etc.).
4. At the bottom, leave the commit message as "Add files via upload" and click **Commit changes**.
5. Refresh the page. You should now see `README.md`, `netlify.toml`, `package.json`, `netlify/`, and `public/` listed.

### Step 2 — Connect the repo to Netlify

1. Sign in at netlify.com (use your GitHub account).
2. From the Netlify dashboard, click **Add new site** → **Import an existing project**.
3. Select **Deploy with GitHub**. Authorize Netlify to read your repos if prompted.
4. Find and click `revenue-pipeline` in the repo list.
5. **Site settings** screen:
   - **Branch to deploy:** `main` (default)
   - **Build command:** leave blank — Netlify will use the defaults from `netlify.toml`
   - **Publish directory:** `public` (auto-filled from `netlify.toml`)
6. **Do NOT click Deploy yet.** Click **Show advanced** → **New variable**:
   - Key: `HUBSPOT_TOKEN`
   - Value: paste your HubSpot Private App token (the one from your password manager — NOT the one you pasted in chat earlier)
7. Now click **Deploy site**.
8. Watch the deploy log scroll. Should finish green in ~30 seconds.
9. Netlify gives you a random URL like `https://magnificent-pony-a1b2c3.netlify.app`. Click it. You should see a "Please log in" gate (because Identity isn't configured yet).

### Step 3 — Configure Netlify Identity + Google SSO

1. In your Netlify site dashboard, click **Site configuration** (left sidebar) → **Identity**.
2. Click **Enable Identity**.
3. Under **Registration preferences**, set it to **Invite only** (so randoms can't sign themselves up).
4. Under **External providers**, click **Add provider** → **Google**. Use Netlify's default Google credentials (the easy path).
5. Under **Emails**, leave the default templates for now.
6. **(Optional but recommended)** Set the email domain restriction:
   - Click **Settings and usage** under Identity → **Registration**.
   - Add this **Git Gateway** rule OR add a Netlify Function trigger (see "Domain restriction" in `netlify/functions/` if I added one — otherwise enforce manually via invite-only).
   - Simplest: keep "Invite only" on. You manually invite each `@prescriberpoint.com` person from the Identity tab → **Invite users**. They get an email link to register.

7. Invite yourself first: **Identity** tab → **Invite users** → enter `ben.humphreys@prescriberpoint.com` → Send.
8. Check your email for the Netlify invite. Click the link. Click **Log in with Google**. Authenticate.
9. You should now see the Asembia dashboard with live HubSpot data.

### Step 4 — Verify it works

1. The Asembia tab should show 4 KPI cards with live numbers from HubSpot.
2. The "Last refresh" timestamp at the bottom should show "Live re-pull at [now]".
3. If you see "Cached value" / "Live re-pull failed", check:
   - Is `HUBSPOT_TOKEN` set in **Site configuration → Environment variables**?
   - Did you grant the right scopes when you created the Private App? (`crm.objects.contacts.read`, `crm.schemas.contacts.read`)
   - Open your browser's developer console (Cmd+Opt+I → Console tab) and look for error messages.

### Step 5 — Invite your team

In Netlify dashboard → **Identity** → **Invite users**. Enter each teammate's `@prescriberpoint.com` email. They get an invite email → click → log in with their Google account → they're in.

---

## Customization

Most config lives in `public/asembia.html` (for the Asembia tracker specifically) and would later live in a shared `config.js`. To change rep names, owner IDs, or filters, edit the file in GitHub directly (click the file → pencil icon → edit → commit). Netlify auto-redeploys in ~30 seconds.

---

## What's in this repo

| Path | What it does |
|---|---|
| `netlify.toml` | Tells Netlify how to build and where to find functions |
| `package.json` | Node project config (no real dependencies, just declares Node 18+) |
| `netlify/functions/hubspot-search.js` | Serverless function that proxies HubSpot search calls. Holds your token securely. Verifies the caller is authenticated via Netlify Identity. |
| `public/index.html` | Landing page — redirects to the first tab |
| `public/asembia.html` | Asembia 2026 tracker, fully live |
| `public/first-meeting.html` | First Meeting tracker (v0.1 placeholder) |
| `public/pipeline.html` | Pipeline Confidence scorecard (v0.1 placeholder) |
| `public/_shared.css` | Top nav + shared styles |
| `public/_api.js` | Frontend wrapper for calling the HubSpot proxy function |

---

## Troubleshooting

**Site loads but auth gate never goes away:** Identity isn't enabled, or you haven't invited your email, or you used a non-`@prescriberpoint.com` account.

**Auth works but numbers say "Cached value":** HubSpot token problem. Check Netlify env vars. Check Private App scopes.

**"Function not found" error:** `netlify.toml` not picked up. Check it's in the repo root, not inside `public/`.

**Need to rotate the HubSpot token:** New token in HubSpot → Netlify → **Site configuration → Environment variables** → edit `HUBSPOT_TOKEN` → paste new value → trigger a redeploy from the Netlify dashboard.
