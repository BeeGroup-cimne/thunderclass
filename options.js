// options.js
const $ = (id) => document.getElementById(id);

async function load() {
  const { apiKey, model, instructions, baseUrl, accountId } =
    await messenger.storage.local.get([
      "apiKey",
      "model",
      "instructions",
      "baseUrl",
      "accountId"
    ]);
  $("baseUrl").value = baseUrl || "https://api.openai.com";
  $("apiKey").value = apiKey || "";
  $("model").value = model || "gpt-4o-mini";
  $("instructions").value = instructions || "";

  // Populate account picker
  const res = await messenger.runtime.sendMessage({ type: "list-accounts" });
  const sel = $("account");
  sel.innerHTML = "";
  const anyOpt = document.createElement("option");
  anyOpt.value = "";
  anyOpt.textContent = "Auto (prefer Local Folders)";
  sel.appendChild(anyOpt);
  if (res && res.ok) {
    for (const a of res.accounts) {
      const o = document.createElement("option");
      o.value = a.id;
      o.textContent = `${a.name}  [${a.type}]`;
      if (a.id === accountId) o.selected = true;
      sel.appendChild(o);
    }
  }
}

function setStatus(text, cls) {
  const el = $("status");
  el.textContent = text;
  el.className = "status " + (cls || "");
}

$("save").addEventListener("click", async () => {
  await messenger.storage.local.set({
    baseUrl: $("baseUrl").value.trim() || "https://api.openai.com",
    apiKey: $("apiKey").value.trim(),
    model: $("model").value.trim() || "gpt-4o-mini",
    instructions: $("instructions").value,
    accountId: $("account").value || null
  });
  setStatus("Saved.", "ok");
});

$("test").addEventListener("click", async () => {
  setStatus("Testing…");
  const r = await messenger.runtime.sendMessage({
    type: "test-endpoint",
    baseUrl: $("baseUrl").value.trim(),
    apiKey: $("apiKey").value.trim(),
    model: $("model").value.trim() || "gpt-4o-mini"
  });
  if (r && r.ok) setStatus("Endpoint reachable and responded.", "ok");
  else setStatus((r && r.error) || "Test failed.", "err");
});

$("listFolders").addEventListener("click", async () => {
  // Save accountId first so the listing respects the current selection.
  await messenger.storage.local.set({
    accountId: $("account").value || null
  });
  setStatus("Listing folders…");
  const r = await messenger.runtime.sendMessage({ type: "list-target-folders" });
  if (!r || !r.ok) {
    setStatus((r && r.error) || "Failed to list folders.", "err");
    return;
  }
  if (r.folders.length === 0) {
    setStatus("No target folders found for the selected account.", "err");
    $("folderDump").textContent = "";
    return;
  }
  setStatus(`Found ${r.folders.length} folders:`, "ok");
  $("folderDump").textContent = r.folders.map((f) => f.path).join("\n");
});

load();
