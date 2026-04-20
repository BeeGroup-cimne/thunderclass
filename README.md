# ThunderClass — Thunderbird Extension

A Thunderbird MailExtension that classifies the selected email into one of your existing subfolders using an AI agent (any OpenAI-compatible endpoint). You confirm the suggestion before anything is moved.

## Features

- Message header toolbar button **"ThunderClass"** and right-click menu **"ThunderClass: classify…"**
- **Batch classification** — select multiple emails and each one is classified independently; review all suggestions in a table and move in one click
- **Folder structure assistant** — analyzes a sample of recent messages and proposes new folders, merges, and renames. Editable inline: change proposed names, apply merges/renames with one click, choose which account to create folders in. Suggestions are always in English.
- **Destination folder exclusion** — multi-select checklist of all folders; uncheck any to exclude from classification. New folders are auto-included.
- **Preserves unread state** — if you hadn't read a message before classifying it, it stays unread after the move
- **Backup & restore** — export/import all settings (API config, classification rules, folder exclusions) as a portable JSON file
- Works with **any OpenAI-compatible `/v1/chat/completions` endpoint** — cloud or self-hosted (e.g. `https://192.168.50.58:8443`)
- Account picker in options — lets you select which account's folder tree is used as classification targets (defaults to Local Folders)
- Sends subject, sender, recipients, date, and a text excerpt of the body
- Confirmation popup shows the suggested folder preselected, with a dropdown to override (or a per-row dropdown in batch mode)
- Skips special folders (Trash, Drafts, Templates, Outbox, Junk)

## Install (permanent)

1. Place your icon files `icon-16.png`, `icon-32.png`, and `icon-64.png` in the root of the extension folder (same level as `manifest.json`).
2. Thunderbird → **Tools → Add-ons and Themes** → gear icon → **Install Add-on From File…** → select `thunderclass.xpi`.

## Configure

Open ThunderClass options (from the Add-ons Manager or the Settings link in the popup):

- **Certificate acceptance** — you must import the root.crt certificate through Settings / Privacy & Security / Manage Certificates... / Authorities / Import...
- **API base URL** — default `https://api.openai.com`; for your local server use `https://192.168.50.58:8443` (no trailing slash, no `/v1`).
- **API key** — ask to dblanco@cimne.upc.edu for it.
- **Model** — any model name your endpoint accepts (you should use `google/gemma-4-26B-A4B-it`).
- **Account to classify into** — pick the account whose subfolders should be the classification targets. Leave on "Auto" to prefer Local Folders.
- **Destination folders** — checklist of all folders in the target account. Uncheck any folder to exclude it from AI classification suggestions. New folders are automatically selected.
- **Extra classification rules** — free-form text that gets appended to the system prompt.

Click **Test endpoint** to verify connectivity.

## Use

- **Single message:** select an email → click **ThunderClass** in the message header toolbar, or right-click the message → **ThunderClass: classify…**. Review/override the suggested folder and click **Move message**.
- **Multiple messages:** select 2+ emails in the thread pane → right-click → **ThunderClass: classify…** (or use the toolbar button). Each email is classified independently (3 in parallel by default). A table opens showing every message with its suggested folder preselected in a dropdown — uncheck any row you want to skip, override any folder, then click **Move all selected**.

## Folder Structure Assistant

The assistant is integrated directly in the options page under "Folder structure assistant":

1. Set the **sample size** (default 1500) and **sort order** (newest or oldest first).
2. Select folders to sample from across any account (including mixing accounts, e.g. Gerard Mor's Inbox + Local Folders subfolders).
3. Click **Run proposal**. The AI analyzes subjects and senders and returns:
   - **Proposed new folders** — each with an editable path, reason, example subjects, and estimated count. Check/uncheck and edit names before creating.
   - **Merge suggestions** — editable destination name + per-row **Apply** button that moves all messages and deletes the empty source folders.
   - **Rename suggestions** — editable new name + per-row **Apply** button that renames the folder in place.
4. Choose the **Create in account** dropdown to select where new folders are created.
5. All folder names are suggested in English.

## Backup & Restore

At the bottom of the options page:

- **Export config** — downloads a JSON file with all settings: API config, extra classification rules, account selection, and destination folder exclusions (stored as portable folder paths).
- **Import config** — reads a JSON file and restores all settings. Folder exclusions are matched by path, so they work across Thunderbird sessions and machines.

## Troubleshooting

- **"No target folders found"** → open options, change the account selector from "Auto" to the exact account name whose subfolders you want to use.
- **Can't reach local endpoint** → make sure the URL is reachable from Thunderbird (try it in a normal browser first). The manifest grants `http://*/*` and `https://*/*` host permissions, so any host works.
- **Model didn't return valid JSON** → local models sometimes wrap output in prose. ThunderClass already parses out the first `{...}` block; if it still fails, add to the extra rules: "Output ONLY the JSON object. No prose, no markdown fences."
- **Proposal hangs or times out** → the proposal uses a persistent Port connection (no 30s timeout), but large samples on slow models can take 1-2 minutes. Check the debug console for progress logs.
- Open **Debug Add-ons → Inspect** on ThunderClass to see console logs (account list, folder count, sort order, sample stats, etc.).

## Files

```
thunderclass/
├── manifest.json
├── background.js         # context menu, endpoint call, folder enumeration, move, rename, merge, proposal
├── popup/
│   ├── popup.html/js/css     # single-message classify
│   └── batch.html/js/css     # multi-message classify
├── options/
│   ├── options.html/js/css   # all settings, folder exclusions, proposal assistant, backup/restore
└── images/                   # icons
```

## Notes

- Built against Thunderbird 128+ (Manifest V3 MailExtension).
- Body content is truncated to ~6000 chars before being sent, to keep prompts bounded.
- The API key is stored in `messenger.storage.local` — not encrypted.
- `response_format: json_object` is only used when the base URL is `api.openai.com`; for other endpoints the extension relies on prompt instructions plus tolerant JSON parsing.
- Merge is destructive: it moves messages and tries to delete the source folder. If delete fails, messages are safely moved but the empty folder remains. Test on a small folder first.
