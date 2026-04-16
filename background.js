// background.js
// Shared logic for AI classification and folder moving.

const DEFAULT_BASE_URL = "https://api.openai.com";
const CLASSIFY_CONCURRENCY = 3;

// --------- Read-state preservation ---------
// We remember which messageIds were unread when ThunderClass first touched
// them. After messages.move(), Thunderbird fires messages.onMoved with the
// new IDs; we look up the old IDs in this set and mark the new messages
// unread again if they were unread before.
const unreadPreMove = new Set();

function rememberUnread(messageId) {
  unreadPreMove.add(messageId);
}

messenger.messages.onMoved.addListener(async (originalMessages, movedMessages) => {
  try {
    // originalMessages / movedMessages are MessageList objects. In MV3 they
    // arrive as { id, messages: [...] } with headers in .messages.
    const originals = originalMessages && originalMessages.messages
      ? originalMessages.messages : (Array.isArray(originalMessages) ? originalMessages : []);
    const moved = movedMessages && movedMessages.messages
      ? movedMessages.messages : (Array.isArray(movedMessages) ? movedMessages : []);

    for (let i = 0; i < originals.length; i++) {
      const origId = originals[i] && originals[i].id;
      const newMsg = moved[i];
      if (origId == null || !newMsg) continue;
      if (unreadPreMove.has(origId)) {
        unreadPreMove.delete(origId);
        // Only restore if Thunderbird flipped it to read during the move.
        if (newMsg.read === true) {
          try {
            await messenger.messages.update(newMsg.id, { read: false });
          } catch (e) {
            console.warn("[ThunderClass] failed to restore unread:", e);
          }
        }
      }
    }
  } catch (e) {
    console.error("[ThunderClass] onMoved handler error:", e);
  }
});

// --------- Context menu on messages ---------
messenger.menus.create({
  id: "ai-classify-selected",
  title: "ThunderClass: classify…",
  contexts: ["message_list"]
});

messenger.menus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== "ai-classify-selected") return;
  const selected = info.selectedMessages && info.selectedMessages.messages;
  if (!selected || selected.length === 0) return;
  const ids = selected.map((m) => m.id);
  await openClassifyWindow(ids);
});

async function openClassifyWindow(messageIds) {
  const page = messageIds.length > 1 ? "popup/batch.html" : "popup/popup.html";
  const url = messenger.runtime.getURL(
    `${page}?ids=${encodeURIComponent(messageIds.join(","))}&mode=window`
  );
  const size = messageIds.length > 1
    ? { width: 860, height: 640 }
    : { width: 520, height: 560 };
  await messenger.windows.create({ url, type: "popup", ...size });
}

// --------- Message handlers ---------
messenger.runtime.onMessage.addListener(async (request) => {
  try {
    if (request.type === "list-accounts") {
      const accounts = await messenger.accounts.list(false);
      return {
        ok: true,
        accounts: accounts.map((a) => ({ id: a.id, name: a.name, type: a.type }))
      };
    }
    if (request.type === "list-target-folders") {
      return { ok: true, folders: await listTargetFolders() };
    }
    if (request.type === "classify-message") {
      return await classifyMessage(request.messageId);
    }
    if (request.type === "classify-batch") {
      return await classifyBatch(request.messageIds);
    }
    if (request.type === "move-message") {
      await messenger.messages.move([request.messageId], request.folderId);
      return { ok: true };
    }
    if (request.type === "move-batch") {
      return await moveBatch(request.moves);
    }
    if (request.type === "test-endpoint") {
      return await testEndpoint(request.baseUrl, request.apiKey, request.model);
    }
  } catch (e) {
    console.error("[ThunderClass]", e);
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
  return { ok: false, error: "Unknown request" };
});

// --------- Folder enumeration ---------
async function listTargetFolders() {
  const { accountId: preferredAccountId } = await messenger.storage.local.get([
    "accountId"
  ]);
  const accounts = await messenger.accounts.list(true);

  let candidates = accounts;
  if (preferredAccountId) {
    candidates = accounts.filter((a) => a.id === preferredAccountId);
  } else {
    const local = accounts.filter((a) => a.type === "none");
    if (local.length > 0) candidates = local;
  }

  const out = [];
  for (const acc of candidates) {
    const root = acc.rootFolder;
    if (!root) continue;
    for (const f of root.subFolders || []) walk(f, "", out);
  }
  return out;
}

function walk(folder, prefix, out) {
  if (!folder || !folder.name) return;
  const path = prefix ? `${prefix} / ${folder.name}` : folder.name;
  const special = (folder.specialUse || []).some((s) =>
    ["trash", "outbox", "templates", "drafts", "junk"].includes(s)
  );
  if (!special && !folder.isRoot) {
    out.push({ id: folder.id, path, name: folder.name });
  }
  for (const child of folder.subFolders || []) walk(child, path, out);
}

// --------- Single-message classification ---------
async function classifyMessage(messageId) {
  const cfg = await loadConfig();
  const folders = await listTargetFolders();
  if (folders.length === 0) {
    return { ok: false, error: "No target folders found. Pick an account in ThunderClass options." };
  }
  const one = await classifyOne(messageId, folders, cfg);
  return {
    ...one,
    folders,
    header: one.header
  };
}

// --------- Batch classification ---------
// Returns per-message results in input order so the UI can render rows before
// all classifications finish (the popup polls with "progress" requests below,
// but we also do parallel-with-concurrency server-side and return everything
// at the end for simplicity). With concurrency=3 this stays well under typical
// local-LLM rate limits.
async function classifyBatch(messageIds) {
  const cfg = await loadConfig();
  const folders = await listTargetFolders();
  if (folders.length === 0) {
    return { ok: false, error: "No target folders found. Pick an account in ThunderClass options." };
  }

  const results = new Array(messageIds.length);
  let next = 0;

  async function worker() {
    while (true) {
      const i = next++;
      if (i >= messageIds.length) return;
      const id = messageIds[i];
      try {
        results[i] = await classifyOne(id, folders, cfg);
      } catch (e) {
        results[i] = {
          ok: false,
          messageId: id,
          error: String(e && e.message ? e.message : e)
        };
      }
    }
  }

  const workers = [];
  for (let w = 0; w < Math.min(CLASSIFY_CONCURRENCY, messageIds.length); w++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  return { ok: true, folders, results };
}

// --------- Shared: classify one message, given preloaded folders+config ---------
async function classifyOne(messageId, folders, cfg) {
  const header = await messenger.messages.get(messageId);
  // Capture read state *before* calling getFull — reading the body could
  // update the "new" flag in some setups. We'll restore unread state after move.
  const wasUnread = header.read === false;
  if (wasUnread) rememberUnread(messageId);

  const full = await messenger.messages.getFull(messageId);
  const bodyText = extractPlainText(full).slice(0, 6000);

  const { effectiveBase, apiKey, model, instructions } = cfg;

  const system = [
    "You are an email-classification assistant.",
    "Given the subject, sender, and body of one email, choose the single most appropriate destination folder from the provided list.",
    "Return ONLY a compact JSON object: {\"folderPath\":\"<one of the provided paths verbatim>\",\"confidence\":0.0-1.0,\"reason\":\"<short>\"}.",
    "If nothing fits well, pick the closest match and set confidence low.",
    instructions ? `Additional user rules:\n${instructions}` : ""
  ].filter(Boolean).join("\n");

  const user = [
    "Available folders (use the path string verbatim):",
    folders.map((f) => `- ${f.path}`).join("\n"),
    "",
    `From: ${header.author || ""}`,
    `To: ${(header.recipients || []).join(", ")}`,
    `Subject: ${header.subject || ""}`,
    `Date: ${header.date ? new Date(header.date).toISOString() : ""}`,
    "",
    "Body:",
    bodyText
  ].join("\n");

  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const body = {
    model: model || "gpt-4o-mini",
    temperature: 0,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ]
  };
  if (/api\.openai\.com/i.test(effectiveBase)) {
    body.response_format = { type: "json_object" };
  }

  const url = `${effectiveBase}/v1/chat/completions`;
  let resp;
  try {
    resp = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  } catch (e) {
    return { ok: false, messageId, error: `Network error: ${e.message}`, header: pickHeader(header) };
  }
  if (!resp.ok) {
    const text = await resp.text();
    return { ok: false, messageId, error: `${resp.status}: ${text.slice(0, 200)}`, header: pickHeader(header) };
  }

  const data = await resp.json();
  const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!content) {
    return { ok: false, messageId, error: "Empty response", header: pickHeader(header) };
  }

  const parsed = tolerantJsonParse(content);
  if (!parsed) {
    return { ok: false, messageId, error: "Model didn't return JSON: " + String(content).slice(0, 180), header: pickHeader(header) };
  }

  const match = folders.find((f) => f.path === parsed.folderPath);
  return {
    ok: true,
    messageId,
    suggestion: match ? { folderId: match.id, folderPath: match.path } : null,
    rawFolderPath: parsed.folderPath,
    confidence: parsed.confidence,
    reason: parsed.reason,
    header: pickHeader(header)
  };
}

function pickHeader(h) {
  return { subject: h.subject, author: h.author };
}

async function loadConfig() {
  const { apiKey, model, instructions, baseUrl } = await messenger.storage.local.get([
    "apiKey", "model", "instructions", "baseUrl"
  ]);
  return {
    apiKey,
    model,
    instructions,
    effectiveBase: (baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "")
  };
}

// --------- Batch move ---------
// Move messages grouped by destination folder (messages.move accepts arrays).
async function moveBatch(moves) {
  // moves: [{ messageId, folderId }, ...]
  const groups = new Map();
  for (const m of moves) {
    if (!m.folderId) continue;
    const key = JSON.stringify(m.folderId);
    if (!groups.has(key)) groups.set(key, { folderId: m.folderId, ids: [] });
    groups.get(key).ids.push(m.messageId);
  }
  let moved = 0;
  const errors = [];
  for (const { folderId, ids } of groups.values()) {
    try {
      await messenger.messages.move(ids, folderId);
      moved += ids.length;
    } catch (e) {
      errors.push(String(e && e.message ? e.message : e));
    }
  }
  return { ok: errors.length === 0, moved, errors };
}

// --------- Utilities ---------
function tolerantJsonParse(text) {
  try { return JSON.parse(text); } catch {}
  const m = String(text).match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}

function extractPlainText(part) {
  if (!part) return "";
  if (part.contentType && part.contentType.startsWith("text/plain") && part.body) {
    return part.body;
  }
  let out = "";
  if (part.parts && part.parts.length) {
    for (const p of part.parts) out += extractPlainText(p) + "\n";
  }
  if (!out && part.contentType && part.contentType.startsWith("text/html") && part.body) {
    return part.body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  }
  return out;
}

// --------- Options helper ---------
async function testEndpoint(baseUrl, apiKey, model) {
  const effectiveBase = (baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const url = `${effectiveBase}/v1/chat/completions`;
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: model || "gpt-4o-mini",
        max_tokens: 5,
        messages: [{ role: "user", content: "ping" }]
      })
    });
    if (!resp.ok) {
      return { ok: false, error: `HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Network error: ${e.message}` };
  }
}
