// ===== STATE =====
let memos = [];
let currentUrl = "";
let editingId = null;
let newDraftId = null;
let settings = { autosaveNewOnBlur: false };

// ===== INIT =====
document.addEventListener("DOMContentLoaded", async () => {
  await loadMemos();
  await loadSettings();
  await getCurrentUrl();
  initEvents();
  autoRoute();
});

// ===== DATA =====
async function loadMemos() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["memos"], (result) => {
      memos = result.memos || [];
      resolve();
    });
  });
}

async function saveMemos() {
  return new Promise((resolve) => {
    chrome.storage.local.set({ memos }, resolve);
  });
}

async function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["settings"], (result) => {
      settings = { autosaveNewOnBlur: false, ...result.settings };
      const toggle = document.getElementById("setting-autosave-new");
      if (toggle) toggle.checked = settings.autosaveNewOnBlur;
      resolve();
    });
  });
}

async function saveSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.set({ settings }, resolve);
  });
}

async function getCurrentUrl() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      currentUrl = tabs[0]?.url || "";
      resolve();
    });
  });
}

// ===== ROUTING =====
function autoRoute() {
  const matched = memos.find(
    (m) => normalizeUrl(m.url) === normalizeUrl(currentUrl)
  );
  if (matched) {
    openDetail(matched.id);
  } else {
    showView("list");
    renderList();
  }
}

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return url;
  }
}

function showView(name) {
  document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
  document.getElementById(`view-${name}`).classList.remove("hidden");
}

// ===== LIST =====
function renderList(filter = "") {
  const list = document.getElementById("memo-list");
  const filtered = filter
    ? memos.filter(
        (m) =>
          m.body.includes(filter) ||
          m.url.includes(filter) ||
          (m.tags || []).some((t) => t.includes(filter))
      )
    : memos;

  if (filtered.length === 0) {
    list.innerHTML = `<div class="empty-state">${
      filter
        ? "該当するメモがありません"
        : "メモはまだありません\n+ 新規から作成できます"
    }</div>`;
    return;
  }

  const currentNorm = normalizeUrl(currentUrl);

  list.innerHTML = filtered
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((m) => {
      const isActive = normalizeUrl(m.url) === currentNorm;
      const tags = (m.tags || [])
        .map((t) => `<span class="tag">${t}</span>`)
        .join("");
      const date = formatDate(m.updatedAt);
      const domain = getDomain(m.url);
      return `
        <div class="memo-item ${isActive ? "active" : ""}" data-id="${m.id}">
          <div class="memo-item-head">
            <div class="memo-item-url">${escHtml(domain)}</div>
            <button type="button" class="btn-open-link" data-id="${m.id}" title="ページを開く">↗</button>
          </div>
          <div class="memo-item-body">${escHtml(m.body)}</div>
          ${tags ? `<div class="memo-item-tags">${tags}</div>` : ""}
          <div class="memo-item-date">${date}</div>
        </div>
      `;
    })
    .join("");

  list.querySelectorAll(".memo-item").forEach((el) => {
    el.addEventListener("click", () => openDetail(el.dataset.id));
  });

  list.querySelectorAll(".btn-open-link").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const memo = memos.find((m) => m.id === btn.dataset.id);
      if (memo) navigateToUrl(memo.url);
    });
  });
}

// ===== DETAIL =====
function openDetail(id) {
  const memo = memos.find((m) => m.id === id);
  if (!memo) return;
  editingId = id;

  document.getElementById("detail-url").value = memo.url;
  document.getElementById("detail-body").value = memo.body;
  document.getElementById("detail-tags").value = (memo.tags || []).join(" ");
  document.getElementById("detail-date").textContent = `更新: ${formatDate(
    memo.updatedAt
  )}`;

  showView("detail");
}

// ===== NEW =====
function openNew() {
  newDraftId = null;
  document.getElementById("new-url").value = currentUrl;
  document.getElementById("new-body").value = "";
  document.getElementById("new-tags").value = "";
  showView("new");
}

// ===== SETTINGS =====
function openSettings() {
  document.getElementById("setting-autosave-new").checked =
    settings.autosaveNewOnBlur;
  showView("settings");
}

// ===== SAVE =====

// silent=true のとき: bodyが空なら何もしない、トーストも出さない（autosave用）
// silent=false のとき: bodyが空ならエラートースト、成功なら通知トースト（ボタン押下用）
async function saveDetail(silent = false) {
  const url = document.getElementById("detail-url").value.trim();
  const body = document.getElementById("detail-body").value.trim();
  const tags = parseTags(document.getElementById("detail-tags").value);

  if (!body) {
    if (!silent) showToast("本文を入力してください");
    return;
  }

  const idx = memos.findIndex((m) => m.id === editingId);
  if (idx === -1) return;

  // 変更がない場合はスキップ（autosaveの無駄な書き込みを防ぐ）
  const prev = memos[idx];
  if (
    prev.url === url &&
    prev.body === body &&
    (prev.tags || []).join(" ") === tags.join(" ")
  ) {
    return;
  }

  memos[idx] = { ...prev, url, body, tags, updatedAt: Date.now() };
  await saveMemos();

  // 更新日を即時反映
  document.getElementById("detail-date").textContent = `更新: ${formatDate(
    memos[idx].updatedAt
  )}`;

  if (silent) {
    showToast("自動保存しました");
  } else {
    showToast("保存しました");
  }
}

// silent=true のとき: bodyが空なら何もしない、トーストも出さない（autosave用）
async function saveNew(silent = false) {
  const url = document.getElementById("new-url").value.trim();
  const body = document.getElementById("new-body").value.trim();
  const tags = parseTags(document.getElementById("new-tags").value);

  if (!body) {
    if (!silent) showToast("本文を入力してください");
    return;
  }

  const draftId = newDraftId;
  const existingIdx = draftId ? memos.findIndex((m) => m.id === draftId) : -1;

  if (existingIdx !== -1) {
    const prev = memos[existingIdx];
    if (
      prev.url === (url || currentUrl) &&
      prev.body === body &&
      (prev.tags || []).join(" ") === tags.join(" ")
    ) {
      return;
    }
    memos[existingIdx] = {
      ...prev,
      url: url || currentUrl,
      body,
      tags,
      updatedAt: Date.now(),
    };
  } else {
    const memo = {
      id: crypto.randomUUID(),
      url: url || currentUrl,
      body,
      tags,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    newDraftId = memo.id;
    memos.push(memo);
  }

  await saveMemos();

  if (silent) {
    showToast("自動保存しました");
    return;
  }

  showToast("保存しました");
  newDraftId = null;
  showView("list");
  renderList();
}

// ===== DELETE =====
async function deleteMemo() {
  if (!editingId) return;
  if (!confirm("このメモを削除しますか？")) return;

  memos = memos.filter((m) => m.id !== editingId);
  await saveMemos();
  editingId = null;
  showView("list");
  renderList();
}

// ===== EXPORT =====
function exportCSV() {
  if (memos.length === 0) {
    showToast("メモがありません");
    return;
  }

  const header = ["ID", "URL", "本文", "タグ", "作成日", "更新日"];
  const rows = memos.map((m) => [
    m.id,
    m.url,
    `"${m.body.replace(/"/g, '""')}"`,
    (m.tags || []).join(" "),
    formatDate(m.createdAt),
    formatDate(m.updatedAt),
  ]);

  const csv = [header, ...rows].map((r) => r.join(",")).join("\n");
  downloadFile(csv, `design-memo-${dateStamp()}.csv`, "text/csv");
  showToast("CSVをエクスポートしました");
}

function exportMarkdown() {
  if (memos.length === 0) {
    showToast("メモがありません");
    return;
  }

  const sorted = [...memos].sort((a, b) => b.updatedAt - a.updatedAt);

  const lines = [
    "# Design Memo",
    "",
    `> エクスポート: ${formatDate(Date.now())}  |  ${memos.length}件`,
    "",
  ];

  // URLごとにグループ化
  const groups = {};
  sorted.forEach((m) => {
    const key = getDomain(m.url) || "その他";
    if (!groups[key]) groups[key] = [];
    groups[key].push(m);
  });

  Object.entries(groups).forEach(([domain, items]) => {
    lines.push(`## ${domain}`);
    lines.push("");
    items.forEach((m) => {
      lines.push(`### ${formatDate(m.updatedAt)}`);
      lines.push("");
      lines.push(`**URL:** \`${m.url}\``);
      lines.push("");
      lines.push(m.body);
      if (m.tags && m.tags.length > 0) {
        lines.push("");
        lines.push("**タグ:** " + m.tags.map((t) => `\`${t}\``).join(" "));
      }
      lines.push("");
      lines.push("---");
      lines.push("");
    });
  });

  downloadFile(
    lines.join("\n"),
    `design-memo-${dateStamp()}.md`,
    "text/markdown"
  );
  showToast("Markdownをエクスポートしました");
}

// ===== EVENTS =====
function initEvents() {
  // 一覧
  document.getElementById("btn-new").addEventListener("click", openNew);
  document
    .getElementById("btn-export-csv")
    .addEventListener("click", exportCSV);
  document
    .getElementById("btn-export-md")
    .addEventListener("click", exportMarkdown);
  document.getElementById("search-input").addEventListener("input", (e) => {
    renderList(e.target.value.trim());
  });

  // 設定
  document.getElementById("btn-settings").addEventListener("click", openSettings);
  document
    .getElementById("btn-back-settings")
    .addEventListener("click", () => {
      showView("list");
      renderList();
    });
  document
    .getElementById("setting-autosave-new")
    .addEventListener("change", async (e) => {
      settings.autosaveNewOnBlur = e.target.checked;
      await saveSettings();
      showToast(settings.autosaveNewOnBlur ? "自動保存をONにしました" : "自動保存をOFFにしました");
    });

  // 詳細 - フォーカスアウトで自動保存
  ["detail-url", "detail-body", "detail-tags"].forEach((id) => {
    document
      .getElementById(id)
      .addEventListener("blur", () => saveDetail(true));
  });

  document
    .getElementById("btn-back-detail")
    .addEventListener("click", async () => {
      await saveDetail(true); // 戻る前にも自動保存
      showView("list");
      renderList();
    });
  document
    .getElementById("btn-save-detail")
    .addEventListener("click", () => saveDetail(false));
  document.getElementById("btn-delete").addEventListener("click", deleteMemo);
  document
    .getElementById("btn-open-detail-url")
    .addEventListener("click", () =>
      navigateToUrl(document.getElementById("detail-url").value)
    );

  // 新規 - 設定ON時はフォーカスアウトで自動保存
  ["new-url", "new-body", "new-tags"].forEach((id) => {
    document.getElementById(id).addEventListener("blur", () => {
      if (settings.autosaveNewOnBlur) saveNew(true);
    });
  });

  document.getElementById("btn-back-new").addEventListener("click", async () => {
    if (settings.autosaveNewOnBlur) await saveNew(true);
    newDraftId = null;
    showView("list");
    renderList();
  });
  document.getElementById("btn-save-new").addEventListener("click", () =>
    saveNew(false)
  );

  // Cmd+Enter / Ctrl+Enter で保存
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      const detail = document.getElementById("view-detail");
      const newView = document.getElementById("view-new");
      if (!detail.classList.contains("hidden")) saveDetail(false);
      if (!newView.classList.contains("hidden")) saveNew();
    }
  });
}

// ===== UTILS =====
function parseTags(str) {
  return str.trim().split(/\s+/).filter(Boolean);
}

function getDomain(url) {
  try {
    return new URL(url).hostname.replace("www.", "");
  } catch {
    return url;
  }
}

function formatDate(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(
    2,
    "0"
  )}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(
    2,
    "0"
  )}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function dateStamp() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(
    2,
    "0"
  )}${String(d.getDate()).padStart(2, "0")}`;
}

function escHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function normalizeOpenUrl(url) {
  const trimmed = (url || "").trim();
  if (!trimmed) return null;
  try {
    new URL(trimmed);
    return trimmed;
  } catch {
    return `https://${trimmed}`;
  }
}

function navigateToUrl(url) {
  const target = normalizeOpenUrl(url);
  if (!target) {
    showToast("URLを入力してください");
    return;
  }
  chrome.tabs.create({ url: target });
}

function downloadFile(content, filename, type) {
  const blob = new Blob([content], { type: `${type};charset=utf-8;` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function showToast(msg) {
  let toast = document.querySelector(".toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "toast";
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2000);
}
