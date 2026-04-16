// batch.js — batch classification UI
const $ = (id) => document.getElementById(id);

$("openOptions").addEventListener("click", (e) => {
  e.preventDefault();
  messenger.runtime.openOptionsPage();
});
$("cancel").addEventListener("click", () => window.close());

function parseIds() {
  const params = new URLSearchParams(location.search);
  const raw = params.get("ids") || "";
  return raw.split(",").map((s) => parseInt(s, 10)).filter((n) => !isNaN(n));
}

function showError(msg) {
  const el = $("error");
  el.textContent = msg;
  el.classList.remove("hidden");
}

function truncate(s, n) {
  s = String(s || "");
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

// state
let folders = [];
let rows = []; // { messageId, result, skip }

function renderRow(i, r) {
  const tr = document.createElement("tr");
  tr.dataset.index = String(i);
  tr.id = `row-${i}`;

  // Skip column
  const tdSkip = document.createElement("td");
  tdSkip.className = "col-skip";
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = !rows[i].skip;
  cb.addEventListener("change", () => {
    rows[i].skip = !cb.checked;
    tr.classList.toggle("skipped", rows[i].skip);
    updateMoveButton();
  });
  tdSkip.appendChild(cb);

  // Subject
  const tdSubject = document.createElement("td");
  tdSubject.className = "col-subject";
  tdSubject.title = r.header ? r.header.subject || "" : "";
  tdSubject.textContent = r.header ? truncate(r.header.subject || "(no subject)", 50) : "(loading)";

  // From
  const tdFrom = document.createElement("td");
  tdFrom.className = "col-from";
  tdFrom.title = r.header ? r.header.author || "" : "";
  tdFrom.textContent = r.header ? truncate(r.header.author || "", 40) : "";

  // Folder dropdown (or error message)
  const tdFolder = document.createElement("td");
  tdFolder.className = "col-folder";
  if (!r.ok) {
    tdFolder.innerHTML = `<span class="err-cell"></span>`;
    tdFolder.querySelector(".err-cell").textContent = r.error || "Failed";
    tr.classList.add("error");
    rows[i].skip = true;
    cb.checked = false;
    tr.classList.add("skipped");
  } else {
    const sel = document.createElement("select");
    for (const f of folders) {
      const opt = document.createElement("option");
      opt.value = String(f.id);
      opt.textContent = f.path;
      if (r.suggestion && String(f.id) === String(r.suggestion.folderId)) {
        opt.selected = true;
      }
      sel.appendChild(opt);
    }
    if (!r.suggestion) {
      // Prepend an "unchosen" option so we don't silently use the first one
      const warn = document.createElement("option");
      warn.value = "";
      warn.textContent = r.rawFolderPath
        ? `(AI said "${r.rawFolderPath}" — no match; pick one)`
        : "(no suggestion; pick one)";
      warn.selected = true;
      sel.prepend(warn);
    }
    sel.addEventListener("change", updateMoveButton);
    tdFolder.appendChild(sel);
  }

  // Confidence
  const tdConf = document.createElement("td");
  tdConf.className = "col-conf";
  if (r.ok && typeof r.confidence === "number") {
    tdConf.textContent = r.confidence.toFixed(2);
    if (r.confidence < 0.5) tdConf.style.color = "#b07";
  } else {
    tdConf.textContent = "";
  }

  tr.append(tdSkip, tdSubject, tdFrom, tdFolder, tdConf);
  return tr;
}

function updateMoveButton() {
  const movable = rows.filter((r, i) => {
    if (r.skip) return false;
    if (!r.result || !r.result.ok) return false;
    const tr = $(`row-${i}`);
    if (!tr) return false;
    const sel = tr.querySelector("select");
    return sel && sel.value;
  }).length;

  const btn = $("moveAll");
  btn.disabled = movable === 0;
  btn.textContent = movable === 0
    ? "Move all selected"
    : `Move ${movable} message${movable === 1 ? "" : "s"}`;
}

$("toggleAll").addEventListener("change", (e) => {
  const checked = e.target.checked;
  for (let i = 0; i < rows.length; i++) {
    if (!rows[i].result || !rows[i].result.ok) continue;
    rows[i].skip = !checked;
    const tr = $(`row-${i}`);
    if (tr) {
      const cb = tr.querySelector('input[type="checkbox"]');
      if (cb) cb.checked = checked;
      tr.classList.toggle("skipped", rows[i].skip);
    }
  }
  updateMoveButton();
});

$("moveAll").addEventListener("click", async () => {
  const moves = [];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].skip) continue;
    if (!rows[i].result || !rows[i].result.ok) continue;
    const tr = $(`row-${i}`);
    const folderId = tr.querySelector("select").value;
    if (!folderId) continue;
    moves.push({ messageId: rows[i].messageId, folderId });
  }
  if (moves.length === 0) return;

  $("moveAll").disabled = true;
  $("moveAll").textContent = "Moving…";
  const r = await messenger.runtime.sendMessage({ type: "move-batch", moves });
  if (!r || !r.ok) {
    showError(`Moved ${r ? r.moved : 0} of ${moves.length}. Errors: ${(r && r.errors ? r.errors : []).join("; ")}`);
    $("moveAll").disabled = false;
    updateMoveButton();
    return;
  }
  window.close();
});

(async function init() {
  try {
    const ids = parseIds();
    if (ids.length === 0) {
      showError("No messages provided.");
      return;
    }

    // Initialize rows placeholders
    rows = ids.map((id) => ({ messageId: id, result: null, skip: false }));

    // Render placeholder rows immediately so user sees progress.
    const tbody = $("tbody");
    for (let i = 0; i < ids.length; i++) {
      const tr = document.createElement("tr");
      tr.id = `row-${i}`;
      tr.innerHTML = `
        <td class="col-skip"><input type="checkbox" checked disabled /></td>
        <td class="col-subject pending">classifying…</td>
        <td class="col-from"></td>
        <td class="col-folder pending"></td>
        <td class="col-conf"></td>`;
      tbody.appendChild(tr);
    }

    $("summary").textContent = `${ids.length} messages selected.`;
    $("progress").classList.remove("hidden");

    // Fire the batch. The background processes with concurrency and
    // returns all results at once.
    const res = await messenger.runtime.sendMessage({
      type: "classify-batch",
      messageIds: ids
    });

    if (!res || !res.ok) {
      showError((res && res.error) || "Batch classification failed.");
      return;
    }

    folders = res.folders;
    $("bar-fill").style.width = "100%";
    $("progress-text").textContent = `Classified ${res.results.length} messages.`;

    // Replace each placeholder with the real row.
    for (let i = 0; i < res.results.length; i++) {
      const r = res.results[i];
      rows[i].result = r;
      const placeholder = $(`row-${i}`);
      const newRow = renderRow(i, r);
      placeholder.replaceWith(newRow);
    }

    const okCount = res.results.filter((r) => r.ok).length;
    const errCount = res.results.length - okCount;
    $("summary").textContent =
      `${okCount} classified, ${errCount} failed. Review the suggestions and click Move.`;
    $("progress").classList.add("hidden");

    updateMoveButton();
  } catch (e) {
    showError(String(e && e.message ? e.message : e));
  }
})();
