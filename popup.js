// ===== STATE =====
let memos = [];
let currentUrl = '';
let editingId = null;

// ===== INIT =====
document.addEventListener('DOMContentLoaded', async () => {
  await loadMemos();
  await getCurrentUrl();
  initEvents();
  autoRoute();
});

// ===== DATA =====
async function loadMemos() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['memos'], (result) => {
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

async function getCurrentUrl() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      currentUrl = tabs[0]?.url || '';
      resolve();
    });
  });
}

// ===== ROUTING =====
function autoRoute() {
  const matched = memos.find(m => normalizeUrl(m.url) === normalizeUrl(currentUrl));
  if (matched) {
    openDetail(matched.id);
  } else {
    showView('list');
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
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  document.getElementById(`view-${name}`).classList.remove('hidden');
}

// ===== LIST =====
function renderList(filter = '') {
  const list = document.getElementById('memo-list');
  const filtered = filter
    ? memos.filter(m =>
        m.body.includes(filter) ||
        m.url.includes(filter) ||
        (m.tags || []).some(t => t.includes(filter))
      )
    : memos;

  if (filtered.length === 0) {
    list.innerHTML = `<div class="empty-state">${filter ? '該当するメモがありません' : 'メモはまだありません\n+ 新規から作成できます'}</div>`;
    return;
  }

  const currentNorm = normalizeUrl(currentUrl);

  list.innerHTML = filtered
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(m => {
      const isActive = normalizeUrl(m.url) === currentNorm;
      const tags = (m.tags || []).map(t => `<span class="tag">${t}</span>`).join('');
      const date = formatDate(m.updatedAt);
      const domain = getDomain(m.url);
      return `
        <div class="memo-item ${isActive ? 'active' : ''}" data-id="${m.id}">
          <div class="memo-item-url">${domain}</div>
          <div class="memo-item-body">${escHtml(m.body)}</div>
          ${tags ? `<div class="memo-item-tags">${tags}</div>` : ''}
          <div class="memo-item-date">${date}</div>
        </div>
      `;
    })
    .join('');

  list.querySelectorAll('.memo-item').forEach(el => {
    el.addEventListener('click', () => openDetail(el.dataset.id));
  });
}

// ===== DETAIL =====
function openDetail(id) {
  const memo = memos.find(m => m.id === id);
  if (!memo) return;
  editingId = id;

  document.getElementById('detail-url').value = memo.url;
  document.getElementById('detail-body').value = memo.body;
  document.getElementById('detail-tags').value = (memo.tags || []).join(' ');
  document.getElementById('detail-date').textContent = `更新: ${formatDate(memo.updatedAt)}`;

  showView('detail');
}

// ===== NEW =====
function openNew() {
  document.getElementById('new-url').value = currentUrl;
  document.getElementById('new-body').value = '';
  document.getElementById('new-tags').value = '';
  showView('new');
}

// ===== SAVE =====
async function saveDetail() {
  const url = document.getElementById('detail-url').value.trim();
  const body = document.getElementById('detail-body').value.trim();
  const tags = parseTags(document.getElementById('detail-tags').value);

  if (!body) { showToast('本文を入力してください'); return; }

  const idx = memos.findIndex(m => m.id === editingId);
  if (idx !== -1) {
    memos[idx] = { ...memos[idx], url, body, tags, updatedAt: Date.now() };
  }

  await saveMemos();
  showToast('保存しました');
}

async function saveNew() {
  const url = document.getElementById('new-url').value.trim();
  const body = document.getElementById('new-body').value.trim();
  const tags = parseTags(document.getElementById('new-tags').value);

  if (!body) { showToast('本文を入力してください'); return; }

  const memo = {
    id: crypto.randomUUID(),
    url: url || currentUrl,
    body,
    tags,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  memos.push(memo);
  await saveMemos();
  showToast('保存しました');
  showView('list');
  renderList();
}

// ===== DELETE =====
async function deleteMemo() {
  if (!editingId) return;
  if (!confirm('このメモを削除しますか？')) return;

  memos = memos.filter(m => m.id !== editingId);
  await saveMemos();
  editingId = null;
  showView('list');
  renderList();
}

// ===== EXPORT =====
function exportCSV() {
  if (memos.length === 0) { showToast('メモがありません'); return; }

  const header = ['ID', 'URL', '本文', 'タグ', '作成日', '更新日'];
  const rows = memos.map(m => [
    m.id,
    m.url,
    `"${m.body.replace(/"/g, '""')}"`,
    (m.tags || []).join(' '),
    formatDate(m.createdAt),
    formatDate(m.updatedAt),
  ]);

  const csv = [header, ...rows].map(r => r.join(',')).join('\n');
  downloadFile(csv, `design-memo-${dateStamp()}.csv`, 'text/csv');
  showToast('CSVをエクスポートしました');
}

function exportMarkdown() {
  if (memos.length === 0) { showToast('メモがありません'); return; }

  const sorted = [...memos].sort((a, b) => b.updatedAt - a.updatedAt);

  const lines = [
    '# Design Memo',
    '',
    `> エクスポート: ${formatDate(Date.now())}  |  ${memos.length}件`,
    '',
  ];

  // URLごとにグループ化
  const groups = {};
  sorted.forEach(m => {
    const key = getDomain(m.url) || 'その他';
    if (!groups[key]) groups[key] = [];
    groups[key].push(m);
  });

  Object.entries(groups).forEach(([domain, items]) => {
    lines.push(`## ${domain}`);
    lines.push('');
    items.forEach(m => {
      lines.push(`### ${formatDate(m.updatedAt)}`);
      lines.push('');
      lines.push(`**URL:** \`${m.url}\``);
      lines.push('');
      lines.push(m.body);
      if (m.tags && m.tags.length > 0) {
        lines.push('');
        lines.push('**タグ:** ' + m.tags.map(t => `\`${t}\``).join(' '));
      }
      lines.push('');
      lines.push('---');
      lines.push('');
    });
  });

  downloadFile(lines.join('\n'), `design-memo-${dateStamp()}.md`, 'text/markdown');
  showToast('Markdownをエクスポートしました');
}

// ===== EVENTS =====
function initEvents() {
  // 一覧
  document.getElementById('btn-new').addEventListener('click', openNew);
  document.getElementById('btn-export-csv').addEventListener('click', exportCSV);
  document.getElementById('btn-export-md').addEventListener('click', exportMarkdown);
  document.getElementById('search-input').addEventListener('input', e => {
    renderList(e.target.value.trim());
  });

  // 詳細
  document.getElementById('btn-back-detail').addEventListener('click', () => {
    showView('list');
    renderList();
  });
  document.getElementById('btn-save-detail').addEventListener('click', saveDetail);
  document.getElementById('btn-delete').addEventListener('click', deleteMemo);

  // 新規
  document.getElementById('btn-back-new').addEventListener('click', () => {
    showView('list');
    renderList();
  });
  document.getElementById('btn-save-new').addEventListener('click', saveNew);

  // Cmd+Enter / Ctrl+Enter で保存
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      const detail = document.getElementById('view-detail');
      const newView = document.getElementById('view-new');
      if (!detail.classList.contains('hidden')) saveDetail();
      if (!newView.classList.contains('hidden')) saveNew();
    }
  });
}

// ===== UTILS =====
function parseTags(str) {
  return str.trim().split(/\s+/).filter(Boolean);
}

function getDomain(url) {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return url;
  }
}

function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function dateStamp() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function downloadFile(content, filename, type) {
  const blob = new Blob([content], { type: `${type};charset=utf-8;` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function showToast(msg) {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2000);
}
