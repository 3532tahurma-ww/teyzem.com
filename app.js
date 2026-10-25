const app = document.getElementById('app');
document.getElementById('year').textContent = new Date().getFullYear();

const CONFIG_KEY = 'teyzem-config';
const DEFAULT_TITLE = 'teyzem.com — en fantastik hikayeler';

let stories = [];
let query = '';

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function norm(s) {
  return String(s).toLocaleLowerCase('tr-TR');
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
}

function paragraphs(text) {
  return text.split(/\n\s*\n/).map(p => `<p>${escapeHtml(p.trim())}</p>`).join('');
}

function excerpt(text, len = 180) {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > len ? t.slice(0, len).trimEnd() + '…' : t;
}

function slugify(s) {
  const map = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' };
  return norm(s)
    .replace(/[çğıöşü]/g, c => map[c])
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'hikaye';
}

function parseTags(s) {
  const tags = s.split(',').map(t => norm(t.trim().replace(/^#+/, ''))).filter(Boolean);
  return [...new Set(tags)];
}

function tagLinks(tags = []) {
  if (!tags.length) return '';
  return `<div class="tags">${tags.map(t =>
    `<a class="tag" href="#/etiket/${encodeURIComponent(t)}">#${escapeHtml(t)}</a>`
  ).join('')}</div>`;
}

function loadConfig() {
  try { return JSON.parse(localStorage.getItem(CONFIG_KEY)) || {}; } catch { return {}; }
}

function saveConfig(cfg) {
  try { localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg)); } catch {}
}

function updateFooter() {
  document.getElementById('add-link').hidden = !loadConfig().token;
}

// --- List & search ---

function matches(s, tag) {
  const tags = (s.tags || []).map(norm);
  if (tag && !tags.includes(norm(tag))) return false;
  const haystack = norm([s.title, s.body, ...tags].join(' '));
  return norm(query).replace(/#/g, ' ').split(/\s+/).filter(Boolean).every(w => haystack.includes(w));
}

function tagCloud() {
  const counts = {};
  stories.forEach(s => (s.tags || []).forEach(t => { counts[t] = (counts[t] || 0) + 1; }));
  const tags = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b, 'tr'));
  return tags.length ? `<div class="tags tag-cloud">${tags.map(t =>
    `<a class="tag" href="#/etiket/${encodeURIComponent(t)}">#${escapeHtml(t)} <small>${counts[t]}</small></a>`
  ).join('')}</div>` : '';
}

function drawList(tag) {
  const list = document.getElementById('list');
  const found = stories.filter(s => matches(s, tag));
  if (!found.length) {
    list.innerHTML = `<p class="muted">${stories.length ? 'Sonuç bulunamadı.' : 'Henüz hikaye yok.'}</p>`;
    return;
  }
  list.innerHTML = found.map(s => `
    <article class="story-card">
      <h2><a href="#/${encodeURIComponent(s.id)}">${escapeHtml(s.title)}</a></h2>
      <div class="meta">${formatDate(s.date)}</div>
      <p class="excerpt">${escapeHtml(excerpt(s.body))}</p>
      ${tagLinks(s.tags)}
    </article>
  `).join('');
}

function renderList(tag) {
  document.title = tag ? `#${tag} — teyzem.com` : DEFAULT_TITLE;
  app.innerHTML = `
    <input id="search" class="search" type="search" placeholder="Hikaye veya etiket ara…" autocomplete="off">
    ${tag
      ? `<p class="filter">Etiket: <span class="tag">#${escapeHtml(tag)}</span> <a href="#/">× temizle</a></p>`
      : tagCloud()}
    <div id="list"></div>
  `;
  const input = document.getElementById('search');
  input.value = query;
  input.addEventListener('input', () => { query = input.value; drawList(tag); });
  drawList(tag);
}

// --- Single story ---

function renderStory(id) {
  const s = stories.find(x => x.id === id);
  if (!s) {
    app.innerHTML = '<p class="muted">Hikaye bulunamadı.</p><a class="back" href="#/">← Tüm hikayeler</a>';
    return;
  }
  document.title = `${s.title} — teyzem.com`;
  app.innerHTML = `
    <article class="story">
      <h1>${escapeHtml(s.title)}</h1>
      <div class="meta">${formatDate(s.date)}</div>
      ${tagLinks(s.tags)}
      <div class="body">${paragraphs(s.body)}</div>
    </article>
    ${loadConfig().token ? `
      <div class="actions">
        <a class="button" href="#/duzenle/${encodeURIComponent(s.id)}">Düzenle</a>
        <button id="delete" class="button danger" type="button">Sil</button>
      </div>` : ''}
    <a class="back" href="#/">← Tüm hikayeler</a>
  `;
  window.scrollTo(0, 0);

  document.getElementById('delete')?.addEventListener('click', async e => {
    if (!confirm(`"${s.title}" silinsin mi?`)) return;
    e.target.disabled = true;
    try {
      stories = await commit(loadConfig(), `Hikaye silindi: ${s.title}`, list => {
        const i = list.findIndex(x => x.id === s.id);
        if (i < 0) throw new Error('Hikaye repoda bulunamadı');
        list.splice(i, 1);
      });
      location.hash = '#/';
      alert('Silindi. Sitede güncellenmesi 1-2 dakika sürebilir.');
    } catch (err) {
      alert(err.message);
      e.target.disabled = false;
    }
  });
}

// --- Add / edit / delete (writes stories.json via GitHub API) ---

function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin);
}

function fromBase64(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}

// Reads the latest stories.json from the repo, applies `mutate`, and commits it back.
async function commit(cfg, message, mutate) {
  const url = `https://api.github.com/repos/${cfg.repo}/contents/stories.json`;
  const headers = { Authorization: `Bearer ${cfg.token}`, Accept: 'application/vnd.github+json' };

  const res = await fetch(`${url}?ref=${encodeURIComponent(cfg.branch)}`, { headers, cache: 'no-store' });
  if (!res.ok) throw new Error(`stories.json okunamadı (${res.status})`);
  const file = await res.json();
  const list = JSON.parse(fromBase64(file.content));

  mutate(list);

  const put = await fetch(url, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      message,
      content: toBase64(JSON.stringify(list, null, 2) + '\n'),
      sha: file.sha,
      branch: cfg.branch
    })
  });
  if (!put.ok) {
    const detail = await put.json().then(d => d.message).catch(() => '');
    throw new Error(`Kaydedilemedi (${put.status})${detail ? ': ' + detail : ''}`);
  }
  return list.sort((a, b) => b.date.localeCompare(a.date));
}

function renderForm(editId) {
  const existing = editId ? stories.find(s => s.id === editId) : null;
  if (editId && !existing) {
    app.innerHTML = '<p class="muted">Hikaye bulunamadı.</p><a class="back" href="#/">← Tüm hikayeler</a>';
    return;
  }
  document.title = `${existing ? 'Hikayeyi düzenle' : 'Yeni hikaye'} — teyzem.com`;
  const cfg = loadConfig();
  const s = existing || { title: '', date: new Date().toISOString().slice(0, 10), tags: [], body: '' };
  app.innerHTML = `
    <form id="new-story" class="form">
      <h1>${existing ? 'Hikayeyi düzenle' : 'Yeni hikaye'}</h1>
      <label>Başlık <input name="title" value="${escapeHtml(s.title)}" required></label>
      <label>Tarih <input name="date" type="date" value="${escapeHtml(s.date)}" required></label>
      <label>Etiketler <input name="tags" value="${escapeHtml((s.tags || []).join(', '))}" placeholder="aile, düğün, komşu"></label>
      <label>Hikaye <textarea name="body" rows="12" required placeholder="Paragrafları boş satırla ayır.">${escapeHtml(s.body)}</textarea></label>

      <details ${cfg.token ? '' : 'open'}>
        <summary>GitHub ayarları</summary>
        <label>Repo <input name="repo" placeholder="kullanici/teyzem.com" value="${escapeHtml(cfg.repo || '')}" required></label>
        <label>Branch <input name="branch" value="${escapeHtml(cfg.branch || 'main')}" required></label>
        <label>Token <input name="token" type="password" value="${escapeHtml(cfg.token || '')}" required></label>
        <p class="hint">Fine-grained token: sadece bu repo, <b>Contents: Read and write</b> izni. Yalnızca bu cihazda saklanır.</p>
      </details>

      <button type="submit">${existing ? 'Kaydet' : 'Yayınla'}</button>
      <p id="status" class="status"></p>
    </form>
    <a class="back" href="${existing ? `#/${encodeURIComponent(existing.id)}` : '#/'}">← Geri</a>
  `;

  const form = document.getElementById('new-story');
  const status = document.getElementById('status');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(form);
    const newCfg = { repo: f.get('repo').trim(), branch: f.get('branch').trim(), token: f.get('token').trim() };
    saveConfig(newCfg);
    updateFooter();

    const data = {
      title: f.get('title').trim(),
      date: f.get('date'),
      tags: parseTags(f.get('tags')),
      body: f.get('body').trim()
    };
    let id = existing ? existing.id : '';

    const button = form.querySelector('button');
    button.disabled = true;
    status.textContent = 'Kaydediliyor…';
    try {
      stories = existing
        ? await commit(newCfg, `Hikaye düzenlendi: ${data.title}`, list => {
            const i = list.findIndex(x => x.id === id);
            if (i < 0) throw new Error('Hikaye repoda bulunamadı');
            list[i] = { ...list[i], ...data };
          })
        : await commit(newCfg, `Yeni hikaye: ${data.title}`, list => {
            id = slugify(data.title);
            for (let i = 2; list.some(x => x.id === id); i++) id = `${slugify(data.title)}-${i}`;
            list.push({ id, ...data });
          });
      location.hash = `#/${encodeURIComponent(id)}`;
      alert('Kaydedildi. Sitede görünmesi 1-2 dakika sürebilir.');
    } catch (err) {
      status.textContent = err.message;
      button.disabled = false;
    }
  });
}

// --- Router ---

function route() {
  const path = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  if (path === 'yeni') return renderForm();
  if (path.startsWith('duzenle/')) return renderForm(path.slice(8));
  if (path.startsWith('etiket/')) return renderList(path.slice(7));
  path ? renderStory(path) : renderList();
}

updateFooter();

fetch('stories.json', { cache: 'no-cache' })
  .then(r => r.json())
  .then(data => {
    stories = data.sort((a, b) => b.date.localeCompare(a.date));
    route();
  })
  .catch(() => {
    app.innerHTML = '<p class="muted">Hikayeler yüklenemedi.</p>';
  });

window.addEventListener('hashchange', route);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js'));
}
