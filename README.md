# ThunderClass — Thunderbird Extension

A Thunderbird MailExtension that classifies the selected email into one of your existing subfolders using an AI agent (any OpenAI-compatible endpoint). You confirm the suggestion before anything is moved.

## Features

- Message header toolbar button **"ThunderClass"** and right-click menu **"ThunderClass: classify…"**
- **Batch classification** — select multiple emails and each one is classified independently; review all suggestions in a table and move in one click
- Works with **any OpenAI-compatible `/v1/chat/completions` endpoint** — cloud or self-hosted (e.g. `https://192.168.50.58:8443`)
- Account picker in options — lets you select which account's folder tree is used as classification targets (defaults to Local Folders)
- **"List detected folders"** diagnostic button to verify what ThunderClass sees
- Sends subject, sender, recipients, date, and a text excerpt of the body
- Confirmation popup shows the suggested folder preselected, with a dropdown to override (or a per-row dropdown in batch mode)
- Skips special folders (Trash, Drafts, Templates, Outbox, Junk)

## Install (permanent)

1. Thunderbird → **Tools → Add-ons and Themes** → gear icon → **Install Add-on From File…** → select `thunderclass.xpi`.

## Configure

Open ThunderClass options (from the Add-ons Manager or the Settings link in the popup):
- **Certificate acceptance** - you must import the root.crt certificate through Settings / Privacy & Security / Manage Certificates... / Authorities / Import...
- **API base URL** — default `https://api.openai.com`; for your local server use `https://192.168.50.58:8443` (no trailing slash, no `/v1`).
- **API key** — ask to dblanco@cimne.upc.edu for it.
- **Model** — any model name your endpoint accepts (you should use `google/gemma-4-26B-A4B-it`).
- **Account to classify into** — pick the account whose subfolders should be the classification targets. Leave on "Auto" to prefer Local Folders.
- **Extra classification rules** — free-form text that gets appended to the system prompt.

Click **Test endpoint** to verify connectivity, then **List detected folders** to confirm ThunderClass can see your subfolders.

## Use

- **Single message:** select an email → click **ThunderClass** in the message header toolbar, or right-click the message → **ThunderClass: classify…**. Review/override the suggested folder and click **Move message**.
- **Multiple messages:** select 2+ emails in the thread pane → right-click → **ThunderClass: classify…** (or use the toolbar button). Each email is classified independently (3 in parallel by default). A table opens showing every message with its suggested folder preselected in a dropdown — uncheck any row you want to skip, override any folder, then click **Move all selected**.

## Troubleshooting

- **"No target folders found"** → open options, change the account selector from "Auto" to the exact account name whose subfolders you want to use, then hit **List detected folders** to verify.
- **Can't reach local endpoint** → make sure the URL is reachable from Thunderbird (try it in a normal browser first). The manifest grants `http://*/*` and `https://*/*` host permissions, so any host works.
- **Model didn't return valid JSON** → local models sometimes wrap output in prose. ThunderClass already parses out the first `{...}` block; if it still fails, tighten your model's system prompt or switch to one that follows instructions better.
- Open **Debug Add-ons → Inspect** on ThunderClass to see console logs (account list, folder count, etc.).

## Files

```
thunderclass/
├── manifest.json
├── background.js         # context menu, endpoint call, folder enumeration, move
├── popup/                # confirmation UI
├── options/              # settings page with account picker + diagnostics
└── images/               # icons
```

## Notes

- Built against Thunderbird 128+ (Manifest V3 MailExtension).
- Body content is truncated to ~6000 chars before being sent, to keep prompts bounded.
- The API key is stored in `messenger.storage.local` — not encrypted.
- `response_format: json_object` is only used when the base URL is `api.openai.com`; for other endpoints the extension relies on prompt instructions plus tolerant JSON parsing.
