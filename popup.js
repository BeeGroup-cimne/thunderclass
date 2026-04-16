// popup.js — single-message confirm UI
const $ = (id) => document.getElementById(id);

$("openOptions").addEventListener("click", (e) => {
  e.preventDefault();
  messenger.runtime.openOptionsPage();
});

$("cancel").addEventListener("click", () => window.close());

let currentMessageId = null;

async function resolveMessageIds() {
  const params = new URLSearchParams(location.search);
  const idsParam = params.get("ids") || params.get("messageId");
  if (idsParam) {
    return idsParam.split(",").map((s) => parseInt(s, 10)).filter((n) => !isNaN(n));
  }
  // Toolbar button path: read currently displayed messages.
  const tabs = await messenger.tabs.query({ active: true, currentWindow: true });
  if (tabs.length === 0) return [];
  const msgs = await messenger.messageDisplay.getDisplayedMessages(tabs[0].id);
  return msgs ? msgs.map((m) => m.id) : [];
}

function showError(msg) {
  $("status").classList.add("hidden");
  const el = $("error");
  el.textContent = msg;
  el.classList.remove("hidden");
}

function populateFolders(folders, selectedId) {
  const sel = $("folder");
  sel.innerHTML = "";
  for (const f of folders) {
    const opt = document.createElement("option");
    opt.value = String(f.id);
    opt.textContent = f.path;
    if (String(f.id) === String(selectedId)) opt.selected = true;
    sel.appendChild(opt);
  }
}

(async function init() {
  try {
    const ids = await resolveMessageIds();
    if (ids.length === 0) {
      showError("No message is selected.");
      return;
    }
    if (ids.length > 1) {
      // Redirect to the batch UI.
      location.href = messenger.runtime.getURL(
        `popup/batch.html?ids=${encodeURIComponent(ids.join(","))}&mode=window`
      );
      return;
    }

    currentMessageId = ids[0];
    const res = await messenger.runtime.sendMessage({
      type: "classify-message",
      messageId: currentMessageId
    });

    if (!res || !res.ok) {
      showError((res && res.error) || "Classification failed.");
      return;
    }

    $("from").textContent = res.header.author || "";
    $("subject").textContent = res.header.subject || "";
    $("meta").classList.remove("hidden");

    populateFolders(res.folders, res.suggestion ? res.suggestion.folderId : null);
    $("confidence").textContent =
      typeof res.confidence === "number" ? res.confidence.toFixed(2) : "n/a";
    $("reason").textContent = res.reason || "";
    if (!res.suggestion && res.rawFolderPath) {
      $("reason").textContent =
        `(AI proposed "${res.rawFolderPath}" which doesn't match any folder) ` + (res.reason || "");
    }

    $("status").classList.add("hidden");
    $("result").classList.remove("hidden");

    $("move").addEventListener("click", async () => {
      const folderId = $("folder").value;
      if (!folderId) return;
      $("move").disabled = true;
      const r = await messenger.runtime.sendMessage({
        type: "move-message",
        messageId: currentMessageId,
        folderId
      });
      if (!r || !r.ok) {
        showError((r && r.error) || "Move failed.");
        $("move").disabled = false;
        return;
      }
      window.close();
    });
  } catch (e) {
    showError(String(e && e.message ? e.message : e));
  }
})();
