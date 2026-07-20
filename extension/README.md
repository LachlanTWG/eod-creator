# EOD Logger — Chrome extension

Floating "EOD +" button on GHL contact and conversation pages
(app.tradiehub.net / app.gohighlevel.com). Opens the dashboard's /eod-entry
form in a corner panel with the client (from the location id in the URL) and
the contact (from the URL or the conversation's contact link) pre-attached.
Submissions run the normal dual-write, so they land in reports + dashboard.

## Install (each exec, once)

1. Get this `extension/` folder onto the machine (clone or a zip of it).
2. Chrome → `chrome://extensions` → toggle **Developer mode** (top right).
3. **Load unpacked** → select the `extension/` folder.
4. Open any contact in GHL — the green **EOD +** button appears bottom-right.

## Updating

Changes to these files aren't auto-distributed: re-share the folder and each
exec clicks the reload (↻) icon on `chrome://extensions`. Changes to the FORM
itself need nothing — it's served live from the dashboard.

## Token

`content.js` holds the shared "agency" token, which resolves the client per
page from the GHL location id. Regenerate after rotating EOD_ENTRY_SECRET:

    node src/scripts/makeEodEntryLink.js agency https://eod-creator.vercel.app

then paste the `token=` value into CONFIG in content.js.
