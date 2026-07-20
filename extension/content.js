// EOD Logger — floating entry button on GHL contact & conversation pages.
//
// GHL gives third-party apps no access to the contact/conversation right
// panels, so this runs as a content script in the exec's own browser instead:
// it watches the SPA URL, and on a contact or conversation page shows a
// floating button (bottom-right) that opens the dashboard's /eod-entry form
// in a panel. The company comes from the location id in the URL; the contact
// id comes from the URL (contact pages) or the DOM (conversation pages), so
// entries land already attached to the contact.
//
// The token below is the "agency" pseudo-slug token — regenerate with
// `node src/scripts/makeEodEntryLink.js agency <base>` after rotating
// EOD_ENTRY_SECRET, and update it here.

const CONFIG = {
  dashboardBase: "https://eod-creator.vercel.app",
  token: "agency.2b4653b54c41c2d4c85166a3ae01620a",
};

const CONTACT_RE = /\/v2\/location\/([^/]+)\/contacts\/detail\/([^/?#]+)/;
const CONVO_RE = /\/v2\/location\/([^/]+)\/conversations\b/;

let lastKey = "";
let root = null; // container for button + panel
let panelOpen = false;

function getContext() {
  const href = window.location.href;

  const contact = href.match(CONTACT_RE);
  if (contact) {
    return {
      locationId: contact[1],
      contactId: contact[2],
      contactName: scrapeContactName(contact[2]),
    };
  }

  const convo = href.match(CONVO_RE);
  if (convo) {
    // Conversations URLs don't carry the contact id — the right-hand contact
    // panel links to /contacts/detail/<id>, so lift it from the DOM.
    const link = document.querySelector('a[href*="/contacts/detail/"]');
    const m = link ? link.getAttribute("href").match(/\/contacts\/detail\/([^/?#]+)/) : null;
    return {
      locationId: convo[1],
      contactId: m ? m[1] : "",
      contactName: m ? scrapeContactName(m[1], link) : "",
    };
  }

  return null;
}

// GHL page/section headings that the scraper must never mistake for a
// person's name (the server also overrides with the DB name for known
// contacts, so a blank here just means the exec types the name once).
const JUNK_HEADINGS = new Set([
  "contacts", "contact", "conversations", "opportunities", "calendars",
  "calendar", "dashboard", "launchpad", "marketing", "automation", "sites",
  "payments", "reputation", "reporting", "app marketplace", "settings",
  "activity", "notes", "tasks", "appointments", "associations", "documents",
]);

function cleanName(raw) {
  const text = (raw || "").trim();
  if (!text || text.length > 80) return "";
  if (/^https?:/.test(text)) return "";
  if (JUNK_HEADINGS.has(text.toLowerCase())) return "";
  return text;
}

function scrapeContactName(contactId, knownLink) {
  // Strongest source: the contact panel's own First/Last Name inputs — GHL
  // names them "contact.first_name" / "contact.last_name" (with a
  // "contact.name" variant on some views).
  const inputVal = sel => document.querySelector(sel)?.value?.trim() || "";
  const full = inputVal('input[name="contact.name"], input[name="contact.full_name"]');
  if (full) {
    const cleaned = cleanName(full);
    if (cleaned) return cleaned;
  }
  const first = inputVal('input[name="contact.first_name"]');
  const last = inputVal('input[name="contact.last_name"]');
  if (first || last) {
    const cleaned = cleanName(`${first} ${last}`.trim());
    if (cleaned) return cleaned;
  }

  // Next: any link to this contact whose text looks like a name.
  const links = knownLink
    ? [knownLink]
    : Array.from(document.querySelectorAll(`a[href*="/contacts/detail/${contactId}"]`));
  for (const a of links) {
    const text = cleanName(a.textContent);
    if (text) return text;
  }
  // Fallback: first heading that isn't a known GHL page/section title.
  for (const h of document.querySelectorAll("h1, h2, h3")) {
    const text = cleanName(h.textContent);
    if (text) return text;
  }
  return "";
}

function formUrl(ctx) {
  const u = new URL(CONFIG.dashboardBase + "/eod-entry");
  u.searchParams.set("token", CONFIG.token);
  u.searchParams.set("location", ctx.locationId);
  if (ctx.contactId) u.searchParams.set("contact_id", ctx.contactId);
  if (ctx.contactName) u.searchParams.set("contact_name", ctx.contactName);
  return u.toString();
}

function ensureUi(ctx) {
  if (!root) {
    root = document.createElement("div");
    root.id = "eod-logger-root";
    root.innerHTML = `
      <button id="eod-logger-btn" type="button" title="Log EOD activity">EOD +</button>
      <div id="eod-logger-panel" hidden>
        <div id="eod-logger-panel-head">
          <span id="eod-logger-panel-title">EOD entry</span>
          <button id="eod-logger-close" type="button" title="Close">×</button>
        </div>
        <iframe id="eod-logger-frame" title="EOD entry form"></iframe>
      </div>`;
    document.documentElement.appendChild(root);

    root.querySelector("#eod-logger-btn").addEventListener("click", () => {
      panelOpen = !panelOpen;
      syncPanel();
    });
    root.querySelector("#eod-logger-close").addEventListener("click", () => {
      panelOpen = false;
      syncPanel();
    });
  }
  root.dataset.ctx = JSON.stringify(ctx);
  const title = root.querySelector("#eod-logger-panel-title");
  title.textContent = ctx.contactName ? `EOD entry — ${ctx.contactName}` : "EOD entry";
  syncPanel();
}

function syncPanel() {
  if (!root) return;
  const panel = root.querySelector("#eod-logger-panel");
  const frame = root.querySelector("#eod-logger-frame");
  if (panelOpen) {
    const ctx = JSON.parse(root.dataset.ctx || "null");
    const url = ctx ? formUrl(ctx) : "";
    // Only (re)load when the context changed, so an open form isn't wiped
    // mid-typing by the URL poller.
    if (url && frame.dataset.src !== url) {
      frame.src = url;
      frame.dataset.src = url;
    }
    panel.hidden = false;
  } else {
    panel.hidden = true;
  }
}

function removeUi() {
  if (root) {
    root.remove();
    root = null;
    panelOpen = false;
  }
}

function tick() {
  const ctx = getContext();
  const key = ctx ? `${ctx.locationId}|${ctx.contactId}|${ctx.contactName}` : "";
  if (key === lastKey) return;
  lastKey = key;
  if (!ctx) {
    removeUi();
  } else {
    ensureUi(ctx);
  }
}

// GHL is a SPA — poll the URL/DOM instead of hooking history (cheap, robust).
setInterval(tick, 800);
tick();
