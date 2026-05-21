// M365 Signature Manager — Single-Page Frontend (vanilla)

// ---------- API client ----------
const api = {
  async req(method, url, body) {
    const opts = { method, credentials: 'same-origin', headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const r = await fetch(url, opts);
    if (r.status === 401 && !url.endsWith('/api/auth/me') && !url.endsWith('/api/auth/login')) {
      showLogin();
      throw new Error('unauthorized');
    }
    const txt = await r.text();
    const json = txt ? JSON.parse(txt) : {};
    if (!r.ok) throw new Error(json.error || `HTTP ${r.status}`);
    return json;
  },
  get(u) { return this.req('GET', u); },
  post(u, b) { return this.req('POST', u, b); },
  put(u, b) { return this.req('PUT', u, b); },
  del(u) { return this.req('DELETE', u); },
};

// ---------- Helpers ----------
function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function esc(s) {
  return (s == null ? '' : String(s)).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function toast(message, type = 'info') {
  const colors = {
    info: 'bg-slate-800', success: 'bg-emerald-600', error: 'bg-red-600', warn: 'bg-amber-600',
  };
  const t = el(`<div class="toast ${colors[type]} text-white px-4 py-2 rounded-lg shadow-lg text-sm">${esc(message)}</div>`);
  document.getElementById('toasts').appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

function openModal(title, contentEl, options = {}) {
  const root = document.getElementById('modal-root');
  let containerStyle = '';
  let containerCls = 'bg-white rounded-xl shadow-2xl overflow-hidden flex flex-col';
  if (options.huge) {
    containerStyle = 'width: 96vw; max-width: 1700px; height: 94vh;';
  } else if (options.wide) {
    containerStyle = 'width: 90vw; max-width: 1024px; max-height: 90vh;';
  } else {
    containerStyle = 'width: 90vw; max-width: 640px; max-height: 90vh;';
  }
  const bodyPad = options.huge ? 'p-4' : 'p-6';
  const overlay = el(`
    <div class="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-2">
      <div class="${containerCls}" style="${containerStyle}">
        <div class="px-6 py-3 border-b flex items-center justify-between">
          <h2 class="text-lg font-semibold">${esc(title)}</h2>
          <button class="text-slate-400 hover:text-slate-700 text-2xl leading-none" data-close>&times;</button>
        </div>
        <div class="${bodyPad} overflow-y-auto flex-1 modal-body"></div>
      </div>
    </div>`);
  overlay.querySelector('.modal-body').appendChild(contentEl);
  overlay.querySelector('[data-close]').onclick = () => overlay.remove();
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
  root.appendChild(overlay);
  return { close: () => overlay.remove(), overlay };
}

async function confirm(message) {
  return new Promise(resolve => {
    const body = el(`
      <div class="space-y-4">
        <p class="text-slate-700">${esc(message)}</p>
        <div class="flex justify-end gap-2">
          <button data-no class="px-4 py-2 bg-slate-200 hover:bg-slate-300 rounded-lg">Abbrechen</button>
          <button data-yes class="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg">Bestaetigen</button>
        </div>
      </div>`);
    const m = openModal('Bestaetigung', body);
    body.querySelector('[data-no]').onclick = () => { m.close(); resolve(false); };
    body.querySelector('[data-yes]').onclick = () => { m.close(); resolve(true); };
  });
}

function setActiveNav() {
  document.querySelectorAll('.nav-link').forEach(a => {
    a.classList.toggle('active', a.getAttribute('href') === location.hash);
  });
}

// ---------- Rich Editor (SunEditor) ----------
const editorHelpers = {
  defaultButtonList: [
    ['undo', 'redo'],
    ['font', 'fontSize', 'formatBlock'],
    ['bold', 'italic', 'underline', 'strike'],
    ['fontColor', 'hiliteColor'],
    ['align', 'horizontalRule', 'list'],
    ['table', 'link', 'image'],
    ['removeFormat'],
    ['codeView', 'showBlocks'],
  ],

  // Erzeugt einen SunEditor auf einem <textarea>. Liefert Editor-Instanz.
  // Image-Upload geht an /api/assets — die Datei landet in der Asset-Library
  // und wird im Editor mit /api/assets/<id>/file als src referenziert.
  create(textareaEl, { height = '350px' } = {}) {
    const lang = (window.SUNEDITOR_LANG && window.SUNEDITOR_LANG.de) || undefined;
    const ed = SUNEDITOR.create(textareaEl, {
      lang,
      height,
      buttonList: this.defaultButtonList,
      defaultStyle: 'font-family: Calibri, Arial, sans-serif; font-size: 11pt;',
      defaultTag: 'div',
      addTagsWhitelist: 'table|tr|td|th|tbody|thead|tfoot',
      attributesWhitelist: { all: 'style|class|width|height|cellpadding|cellspacing|border|valign|align|colspan|rowspan' },
      imageUploadSizeLimit: 5 * 1024 * 1024,
      imageUrlInput: false, // nur Upload, keine externen URLs
    });
    ed.onImageUploadBefore = (files, _info, uploadHandler) => {
      const fd = new FormData();
      fd.append('file', files[0]);
      fd.append('name', files[0].name);
      fetch('/api/assets', { method: 'POST', body: fd, credentials: 'same-origin' })
        .then(r => r.ok ? r.json() : r.json().then(j => Promise.reject(new Error(j.error || 'Upload failed'))))
        .then(j => {
          uploadHandler({
            result: [{ url: j.url, name: j.name || j.filename, size: j.size_bytes }],
          });
        })
        .catch(err => {
          toast(err.message, 'error');
          uploadHandler({ errorMessage: err.message });
        });
      return false; // Wir haben den Upload selbst gemacht
    };
    return ed;
  },

  destroy(ed) { try { ed?.destroy(); } catch {} },
};

// ---------- State ----------
const state = {
  currentUser: null,
  templates: [],
  servers: [],
};

async function refreshTemplates() { state.templates = await api.get('/api/templates'); }
async function refreshServers() { state.servers = await api.get('/api/servers'); }

// ---------- Asset Picker (Bilder-Library als Auswahl-Dialog) ----------
async function openAssetPicker(onSelect) {
  let assets = [];
  try { assets = await api.get('/api/assets'); }
  catch (err) { toast(err.message, 'error'); return; }

  const body = el(`
    <div class="space-y-3">
      <div class="flex items-center justify-between">
        <p class="text-sm text-slate-500">${assets.length} Bild${assets.length === 1 ? '' : 'er'} verfuegbar</p>
        <label class="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg cursor-pointer">
          + Neues Bild hochladen
          <input type="file" id="picker-upload" accept="image/png,image/jpeg,image/gif,image/webp" class="hidden"/>
        </label>
      </div>
      ${assets.length === 0
        ? '<div class="bg-slate-50 rounded-lg p-12 text-center text-slate-400">Noch keine Bilder hochgeladen. Klick oben rechts auf „Neues Bild hochladen".</div>'
        : `<div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 max-h-[60vh] overflow-y-auto">
            ${assets.map(a => `
              <button type="button" data-pick="${a.id}" class="bg-white border-2 border-transparent hover:border-blue-500 rounded-lg overflow-hidden text-left transition group">
                <div class="aspect-square bg-slate-50 flex items-center justify-center overflow-hidden">
                  <img src="/api/assets/${a.id}/file" alt="${esc(a.name)}" class="max-w-full max-h-full object-contain"/>
                </div>
                <div class="p-2">
                  <div class="text-xs font-medium truncate" title="${esc(a.name)}">${esc(a.name)}</div>
                  <div class="text-[10px] text-slate-400">${formatBytes(a.size_bytes)}</div>
                </div>
              </button>
            `).join('')}
          </div>`
      }
    </div>
  `);

  const modal = openModal('Bild aus Library einfuegen', body, { wide: true });

  body.querySelector('#picker-upload').onchange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('name', file.name);
      const r = await fetch('/api/assets', { method: 'POST', body: fd, credentials: 'same-origin' });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      const asset = await r.json();
      toast(`Hochgeladen: ${asset.name}`, 'success');
      modal.close();
      onSelect(asset);
    } catch (err) { toast(err.message, 'error'); }
  };

  body.querySelectorAll('[data-pick]').forEach(btn => {
    btn.onclick = () => {
      const id = btn.dataset.pick;
      const asset = assets.find(a => a.id == id);
      modal.close();
      onSelect(asset);
    };
  });
}

// ---------- Auth ----------
async function showLogin() {
  document.getElementById('app-view').classList.add('hidden');
  document.getElementById('login-view').classList.remove('hidden');
}

async function showApp() {
  document.getElementById('login-view').classList.add('hidden');
  document.getElementById('app-view').classList.remove('hidden');
  document.getElementById('current-user').textContent = state.currentUser?.username || '';
  if (!location.hash) location.hash = '#/dashboard';
  else route();
}

document.getElementById('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.target;
  const errEl = document.getElementById('login-error');
  errEl.classList.add('hidden');
  try {
    await api.post('/api/auth/login', {
      username: form.username.value,
      password: form.password.value,
    });
    state.currentUser = await api.get('/api/auth/me');
    showApp();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  }
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  await api.post('/api/auth/logout');
  state.currentUser = null;
  showLogin();
});

// ---------- Router ----------
const routes = {};
function registerRoute(hash, fn) { routes[hash] = fn; }

async function route() {
  setActiveNav();
  const path = (location.hash || '#/dashboard').split('?')[0];
  const handler = routes[path] || routes['#/dashboard'];
  const content = document.getElementById('content');
  content.innerHTML = '<div class="text-slate-400">Laedt...</div>';
  try {
    await handler(content);
  } catch (err) {
    console.error(err);
    content.innerHTML = `<div class="bg-red-50 border border-red-200 text-red-800 p-4 rounded">${esc(err.message)}</div>`;
  }
}
window.addEventListener('hashchange', route);

// ---------- View: Dashboard ----------
registerRoute('#/dashboard', async (content) => {
  const [users, servers, deploys, settings] = await Promise.all([
    api.get('/api/users'),
    api.get('/api/servers'),
    api.get('/api/audit/deploys?limit=10'),
    api.get('/api/settings'),
  ]);
  const okCount = deploys.filter(d => d.status === 'ok').length;
  const errCount = deploys.filter(d => d.status === 'error').length;
  const bannerDismissed = settings.roaming_banner_dismissed === '1' || settings.roaming_banner_dismissed === 'true';
  content.innerHTML = '';
  content.appendChild(el(`
    <div class="space-y-6">
      ${bannerDismissed ? '' : `
      <div id="roaming-banner" class="bg-amber-50 border border-amber-300 text-amber-900 rounded-xl p-4 flex items-start justify-between gap-4">
        <div class="text-sm">
          <strong>Empfohlen vor erstem Rollout:</strong> Outlook Cloud-Roaming-Signatures tenant-weit deaktivieren via PowerShell.
          Solange Roaming aktiv ist, kann es bei der ersten Anmeldung nach einem Deploy zu einer Race-Condition kommen, in der Outlook
          die alte Cloud-Signatur zurueckholt, bevor unsere Registry-Settings greifen.
          <div class="mt-2 text-xs">
            Skript:
            <a href="https://github.com/ruehlingdaniel/m365-signature-manager/blob/main/scripts/disable-roaming-signatures.ps1" target="_blank" class="font-mono underline">scripts/disable-roaming-signatures.ps1</a>
            (Global Admin / Exchange Admin noetig). Setzt <code class="bg-white px-1 rounded">Set-OrganizationConfig -PostponeRoamingSignaturesUntilLater $true</code>.
          </div>
        </div>
        <button id="roaming-banner-dismiss" class="text-amber-900 hover:text-amber-700 text-xs whitespace-nowrap underline">Banner ausblenden</button>
      </div>`}

      <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div class="bg-white p-5 rounded-xl shadow-sm">
          <div class="text-xs uppercase text-slate-500">Mitarbeiter</div>
          <div class="text-3xl font-bold mt-1">${users.length}</div>
          <div class="text-xs text-slate-500 mt-2">${users.filter(u => u.enabled).length} aktiv</div>
        </div>
        <div class="bg-white p-5 rounded-xl shadow-sm">
          <div class="text-xs uppercase text-slate-500">Terminalserver</div>
          <div class="text-3xl font-bold mt-1">${servers.length}</div>
          <div class="text-xs text-slate-500 mt-2">${servers.filter(s => s.enabled).length} aktiv</div>
        </div>
        <div class="bg-white p-5 rounded-xl shadow-sm">
          <div class="text-xs uppercase text-slate-500">Letzte Deploys OK</div>
          <div class="text-3xl font-bold mt-1 text-emerald-600">${okCount}</div>
          <div class="text-xs text-slate-500 mt-2">von letzten ${deploys.length}</div>
        </div>
        <div class="bg-white p-5 rounded-xl shadow-sm">
          <div class="text-xs uppercase text-slate-500">Fehler</div>
          <div class="text-3xl font-bold mt-1 ${errCount ? 'text-red-600' : 'text-slate-400'}">${errCount}</div>
          <div class="text-xs text-slate-500 mt-2">von letzten ${deploys.length}</div>
        </div>
      </div>

      <div class="bg-white rounded-xl shadow-sm overflow-hidden">
        <div class="px-5 py-3 border-b flex items-center justify-between">
          <h2 class="font-semibold">Schnellaktion</h2>
        </div>
        <div class="p-5 flex gap-3 flex-wrap">
          <button id="deploy-all" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold">
            Alle Mitarbeiter auf alle Server deployen
          </button>
          <a href="#/users" class="px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg">Mitarbeiter pflegen</a>
          <a href="#/templates" class="px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg">Templates bearbeiten</a>
        </div>
      </div>

      <div class="bg-white rounded-xl shadow-sm overflow-hidden">
        <div class="px-5 py-3 border-b"><h2 class="font-semibold">Letzte Deployments</h2></div>
        <table class="w-full text-sm">
          <thead class="bg-slate-50 text-slate-600">
            <tr>
              <th class="text-left px-5 py-2">Zeit</th>
              <th class="text-left px-5 py-2">User</th>
              <th class="text-left px-5 py-2">Server</th>
              <th class="text-left px-5 py-2">Status</th>
              <th class="text-left px-5 py-2">Details</th>
            </tr>
          </thead>
          <tbody>
            ${deploys.map(d => `
              <tr class="border-t">
                <td class="px-5 py-2 text-slate-500">${esc(d.created_at)}</td>
                <td class="px-5 py-2">${esc(d.display_name || d.windows_username || '—')}</td>
                <td class="px-5 py-2">${esc(d.server_name || '—')}</td>
                <td class="px-5 py-2">${statusBadge(d.status)}</td>
                <td class="px-5 py-2 text-slate-500">${esc(d.message || '')}</td>
              </tr>
            `).join('') || '<tr><td colspan="5" class="px-5 py-4 text-slate-400">Noch keine Deployments</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `));

  document.getElementById('deploy-all').onclick = async () => {
    if (!await confirm('Alle aktiven Mitarbeiter auf alle aktiven Server deployen?')) return;
    try {
      const r = await api.post('/api/deploy/all', {});
      toast(`Deploy fertig: OK ${r.by_status.ok || 0}, Skip ${r.by_status.skipped || 0}, Fehler ${r.by_status.error || 0}`, 'success');
      route();
    } catch (err) { toast(err.message, 'error'); }
  };

  const dismissBtn = document.getElementById('roaming-banner-dismiss');
  if (dismissBtn) dismissBtn.onclick = async () => {
    try {
      await api.put('/api/settings', { roaming_banner_dismissed: '1' });
      document.getElementById('roaming-banner').remove();
    } catch (err) { toast(err.message, 'error'); }
  };
});

function statusBadge(status) {
  const map = {
    ok: 'bg-emerald-100 text-emerald-800',
    skipped: 'bg-amber-100 text-amber-800',
    error: 'bg-red-100 text-red-800',
  };
  return `<span class="inline-block px-2 py-0.5 rounded text-xs font-medium ${map[status] || 'bg-slate-100 text-slate-600'}">${esc(status)}</span>`;
}

// ---------- View: Users ----------
registerRoute('#/users', async (content) => {
  await Promise.all([refreshTemplates(), refreshServers()]);
  const users = await api.get('/api/users');

  content.innerHTML = '';
  content.appendChild(el(`
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <h1 class="text-2xl font-bold">Mitarbeiter (${users.length})</h1>
        <div class="flex gap-2">
          <input id="user-search" placeholder="Suche..." class="px-3 py-2 border rounded-lg text-sm"/>
          <button id="bulk-replace" class="px-4 py-2 bg-amber-100 hover:bg-amber-200 text-amber-900 rounded-lg font-semibold" title="Bei allen aktiven Mitarbeitern das Flag 'Bestehende Signaturen ersetzen' setzen/zuruecksetzen">⟳ Bulk-Replace</button>
          <button id="csv-import" class="px-4 py-2 bg-slate-200 hover:bg-slate-300 rounded-lg font-semibold">CSV-Import</button>
          <button id="new-user" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold">+ Mitarbeiter</button>
        </div>
      </div>

      <div class="bg-white rounded-xl shadow-sm overflow-hidden">
        <table class="w-full text-sm">
          <thead class="bg-slate-50 text-slate-600">
            <tr>
              <th class="text-left px-5 py-2">Name</th>
              <th class="text-left px-5 py-2">Windows-User</th>
              <th class="text-left px-5 py-2">Abteilung</th>
              <th class="text-left px-5 py-2">Template</th>
              <th class="text-left px-5 py-2">Letzter Deploy</th>
              <th class="text-left px-5 py-2">Ersetzt alle</th>
              <th class="text-left px-5 py-2">Aktiv</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="users-tbody">
            ${renderUsersTable(users)}
          </tbody>
        </table>
      </div>
    </div>
  `));

  document.getElementById('user-search').oninput = async e => {
    const q = e.target.value;
    const filtered = await api.get('/api/users?q=' + encodeURIComponent(q));
    document.getElementById('users-tbody').innerHTML = renderUsersTable(filtered);
    bindUsersRowEvents();
  };

  document.getElementById('new-user').onclick = () => openUserModal(null);
  document.getElementById('csv-import').onclick = () => openCsvImportModal();
  document.getElementById('bulk-replace').onclick = () => openBulkReplaceModal();
  bindUsersRowEvents();
});

function openBulkReplaceModal() {
  const body = el(`
    <div class="space-y-4">
      <p class="text-sm text-slate-600">Setzt das Flag <strong>"Bestehende Signaturen ersetzen"</strong> bei allen <strong>aktiven</strong> Mitarbeitern.</p>
      <div class="bg-amber-50 border border-amber-300 text-amber-900 rounded-lg p-3 text-sm">
        <strong>Achtung:</strong> Mit aktiviertem Flag werden bei jedem Deploy alle anderen Signaturen im Outlook-Signatures-Ordner der Mitarbeiter auf den Terminalservern geloescht. Nur diese Tool-Signatur bleibt uebrig.
      </div>
      <div class="flex gap-2 justify-end pt-2 border-t">
        <button data-action="off" class="px-4 py-2 bg-slate-200 hover:bg-slate-300 rounded-lg">Auf "Nein" setzen</button>
        <button data-action="on" class="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-semibold">Auf "Ja" setzen</button>
      </div>
    </div>
  `);
  const modal = openModal('Bulk-Replace fuer alle aktiven Mitarbeiter', body);
  async function run(value) {
    try {
      const r = await api.post('/api/users/bulk-replace', { value });
      toast(`${r.count} Mitarbeiter aktualisiert (replace = ${r.value})`, 'success');
      modal.close();
      route();
    } catch (err) { toast(err.message, 'error'); }
  }
  body.querySelector('[data-action=off]').onclick = () => run(false);
  body.querySelector('[data-action=on]').onclick = () => run(true);
}

async function openCsvImportModal() {
  const body = el(`
    <div class="space-y-4">
      <div class="bg-blue-50 border border-blue-200 rounded p-3 text-sm">
        <p class="font-medium mb-1">Format</p>
        <p class="text-slate-600">CSV mit Header-Zeile. Trennzeichen: Komma, Semikolon oder Tab. Pflicht-Spalten:
          <code class="bg-white px-1 rounded">windows_username</code> und
          <code class="bg-white px-1 rounded">display_name</code> (oder dt. Aliase wie „Anzeigename").</p>
        <p class="text-slate-600 mt-1">Optionale Spalten: email, job_title, department, company, office_location, phone, mobile, fax, street, city, postal_code, country, website</p>
        <p class="text-slate-600 mt-1">Bei vorhandenem <code class="bg-white px-1 rounded">windows_username</code> wird der Mitarbeiter aktualisiert (Upsert).</p>
      </div>
      <input id="csv-file" type="file" accept=".csv,text/csv" class="block w-full text-sm"/>
      <div>
        <label class="text-xs uppercase text-slate-500">Oder direkt einfuegen</label>
        <textarea id="csv-text" rows="8" class="code w-full px-3 py-2 border rounded-lg" placeholder="windows_username,display_name,email,job_title&#10;jmueller,Jens Mueller,j.mueller@example.com,Vertriebsleiter"></textarea>
      </div>
      <div id="csv-result" class="hidden bg-slate-50 border rounded p-3 text-sm"></div>
      <div class="flex justify-end gap-2 pt-2 border-t">
        <button data-action="dry-run" class="px-4 py-2 bg-slate-200 hover:bg-slate-300 rounded-lg">Test-Lauf (nichts speichern)</button>
        <button data-action="import" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold">Importieren</button>
      </div>
    </div>
  `);
  const modal = openModal('Mitarbeiter aus CSV importieren', body, { wide: true });

  body.querySelector('#csv-file').onchange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { body.querySelector('#csv-text').value = String(reader.result || ''); };
    reader.readAsText(file, 'utf-8');
  };

  async function run(dry) {
    const csv = body.querySelector('#csv-text').value;
    if (!csv.trim()) return toast('CSV ist leer', 'error');
    const resBox = body.querySelector('#csv-result');
    resBox.className = 'bg-slate-50 border rounded p-3 text-sm';
    resBox.textContent = 'Verarbeite...';
    try {
      const r = await api.post('/api/users/import-csv', { csv, dry_run: dry });
      resBox.innerHTML = `
        <div class="font-semibold mb-1">${dry ? 'Test-Lauf' : 'Import'} fertig</div>
        <ul class="space-y-0.5">
          <li><strong>${r.created}</strong> neu angelegt${dry ? ' (waeren)' : ''}</li>
          <li><strong>${r.updated}</strong> aktualisiert${dry ? ' (waeren)' : ''}</li>
          <li><strong>${r.skipped}</strong> uebersprungen</li>
          <li><strong>${r.errors.length}</strong> Fehler</li>
        </ul>
        ${r.errors.length ? `<details class="mt-2"><summary class="cursor-pointer text-red-600">Fehler-Details</summary>
          <pre class="text-xs bg-white border p-2 mt-1 max-h-40 overflow-auto">${esc(JSON.stringify(r.errors, null, 2))}</pre>
        </details>` : ''}
      `;
      if (!dry) {
        toast(`Import OK: ${r.created} neu, ${r.updated} aktualisiert`, 'success');
        setTimeout(() => { modal.close(); route(); }, 1500);
      }
    } catch (err) { toast(err.message, 'error'); resBox.classList.add('hidden'); }
  }
  body.querySelector('[data-action=dry-run]').onclick = () => run(true);
  body.querySelector('[data-action=import]').onclick = () => run(false);
}

function renderUsersTable(users) {
  if (!users.length) return '<tr><td colspan="8" class="px-5 py-6 text-slate-400 text-center">Keine Mitarbeiter angelegt</td></tr>';
  return users.map(u => `
    <tr class="border-t hover:bg-slate-50">
      <td class="px-5 py-2 font-medium">${esc(u.display_name)}</td>
      <td class="px-5 py-2 text-slate-600">${esc(u.windows_username)}</td>
      <td class="px-5 py-2 text-slate-600">${esc(u.department || '')}</td>
      <td class="px-5 py-2 text-slate-600">${esc(u.template_name || '—')}</td>
      <td class="px-5 py-2 text-slate-500">
        ${u.last_deploy_at ? `${esc(u.last_deploy_at)} ${statusBadge(u.last_deploy_status)}` : '<span class="text-slate-400">nie</span>'}
      </td>
      <td class="px-5 py-2">${u.replace_existing_signatures ? '<span title="Loescht beim Deploy alle anderen Signaturen" class="text-amber-600">⟳ Ja</span>' : '<span class="text-slate-300">—</span>'}</td>
      <td class="px-5 py-2">${u.enabled ? '<span class="text-emerald-600">●</span>' : '<span class="text-slate-300">○</span>'}</td>
      <td class="px-5 py-2 text-right whitespace-nowrap">
        <button data-edit="${u.id}" class="text-blue-600 hover:underline mr-3">Bearbeiten</button>
        <button data-deploy="${u.id}" class="text-emerald-600 hover:underline mr-3">Deploy</button>
        <button data-delete="${u.id}" class="text-red-600 hover:underline">Loeschen</button>
      </td>
    </tr>
  `).join('');
}

function bindUsersRowEvents() {
  document.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openUserModal(b.dataset.edit));
  document.querySelectorAll('[data-deploy]').forEach(b => b.onclick = () => deploySingleUser(b.dataset.deploy));
  document.querySelectorAll('[data-delete]').forEach(b => b.onclick = async () => {
    if (!await confirm('Mitarbeiter wirklich loeschen?')) return;
    try { await api.del('/api/users/' + b.dataset.delete); toast('Geloescht', 'success'); route(); }
    catch (err) { toast(err.message, 'error'); }
  });
}

async function deploySingleUser(id) {
  if (!await confirm('Signatur fuer diesen Mitarbeiter jetzt auf alle Server deployen?')) return;
  try {
    const r = await api.post('/api/deploy/user/' + id, {});
    const summary = r.results.map(x => `${x.server_name}: ${x.status}`).join(', ');
    toast(summary, r.results.every(x => x.status === 'ok') ? 'success' : 'warn');
    route();
  } catch (err) { toast(err.message, 'error'); }
}

async function openUserModal(id) {
  const user = id ? await api.get('/api/users/' + id) : {
    windows_username: '', display_name: '', email: '', job_title: '', department: '',
    company: '', office_location: '', phone: '', mobile: '', fax: '',
    street: '', city: '', postal_code: '', country: '', website: '',
    signature_name: 'Firma_Standard', template_id: '', enabled: 1,
    replace_existing_signatures: 0, custom_fields: {},
  };

  const body = el(`
    <div class="space-y-4">
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="text-xs uppercase text-slate-500">Windows-Username *</label>
          <input data-f="windows_username" value="${esc(user.windows_username)}" class="w-full px-3 py-2 border rounded-lg" ${id ? 'readonly' : ''}/>
          <p class="text-xs text-slate-400 mt-1">Ohne Domain, z.B. "jmueller"</p>
        </div>
        <div>
          <label class="text-xs uppercase text-slate-500">Anzeigename *</label>
          <input data-f="display_name" value="${esc(user.display_name)}" class="w-full px-3 py-2 border rounded-lg"/>
        </div>
        <div>
          <label class="text-xs uppercase text-slate-500">E-Mail</label>
          <input data-f="email" value="${esc(user.email)}" class="w-full px-3 py-2 border rounded-lg"/>
        </div>
        <div>
          <label class="text-xs uppercase text-slate-500">Position / Titel</label>
          <input data-f="job_title" value="${esc(user.job_title)}" class="w-full px-3 py-2 border rounded-lg"/>
        </div>
        <div>
          <label class="text-xs uppercase text-slate-500">Abteilung</label>
          <input data-f="department" value="${esc(user.department)}" class="w-full px-3 py-2 border rounded-lg"/>
        </div>
        <div>
          <label class="text-xs uppercase text-slate-500">Firma</label>
          <input data-f="company" value="${esc(user.company)}" class="w-full px-3 py-2 border rounded-lg"/>
        </div>
        <div>
          <label class="text-xs uppercase text-slate-500">Telefon</label>
          <input data-f="phone" value="${esc(user.phone)}" class="w-full px-3 py-2 border rounded-lg"/>
        </div>
        <div>
          <label class="text-xs uppercase text-slate-500">Mobil</label>
          <input data-f="mobile" value="${esc(user.mobile)}" class="w-full px-3 py-2 border rounded-lg"/>
        </div>
        <div>
          <label class="text-xs uppercase text-slate-500">Fax</label>
          <input data-f="fax" value="${esc(user.fax)}" class="w-full px-3 py-2 border rounded-lg"/>
        </div>
        <div>
          <label class="text-xs uppercase text-slate-500">Webseite</label>
          <input data-f="website" value="${esc(user.website)}" class="w-full px-3 py-2 border rounded-lg"/>
        </div>
        <div>
          <label class="text-xs uppercase text-slate-500">Strasse</label>
          <input data-f="street" value="${esc(user.street)}" class="w-full px-3 py-2 border rounded-lg"/>
        </div>
        <div class="grid grid-cols-3 gap-2">
          <div>
            <label class="text-xs uppercase text-slate-500">PLZ</label>
            <input data-f="postal_code" value="${esc(user.postal_code)}" class="w-full px-3 py-2 border rounded-lg"/>
          </div>
          <div class="col-span-2">
            <label class="text-xs uppercase text-slate-500">Stadt</label>
            <input data-f="city" value="${esc(user.city)}" class="w-full px-3 py-2 border rounded-lg"/>
          </div>
        </div>
        <div>
          <label class="text-xs uppercase text-slate-500">Standort</label>
          <input data-f="office_location" value="${esc(user.office_location)}" class="w-full px-3 py-2 border rounded-lg"/>
        </div>
        <div>
          <label class="text-xs uppercase text-slate-500">Land</label>
          <input data-f="country" value="${esc(user.country)}" class="w-full px-3 py-2 border rounded-lg"/>
        </div>
      </div>

      <hr/>
      <div class="grid grid-cols-3 gap-4">
        <div class="col-span-2">
          <label class="text-xs uppercase text-slate-500">Signatur-Template</label>
          <select data-f="template_id" class="w-full px-3 py-2 border rounded-lg">
            <option value="">Default-Template benutzen</option>
            ${state.templates.map(t => `<option value="${t.id}" ${user.template_id == t.id ? 'selected' : ''}>${esc(t.name)}${t.is_default ? ' (Default)' : ''}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="text-xs uppercase text-slate-500">Signatur-Name in Outlook</label>
          <input data-f="signature_name" value="${esc(user.signature_name)}" class="w-full px-3 py-2 border rounded-lg"/>
        </div>
      </div>

      <div>
        <label class="text-xs uppercase text-slate-500">Eigene Felder (JSON, fuer beliebige Placeholder)</label>
        <textarea data-f="custom_fields" rows="3" class="code w-full px-3 py-2 border rounded-lg">${esc(JSON.stringify(user.custom_fields || {}, null, 2))}</textarea>
      </div>

      <div class="space-y-2">
        <label class="flex items-center gap-2">
          <input type="checkbox" data-f="enabled" ${user.enabled ? 'checked' : ''}/>
          <span class="text-sm">Aktiv (deployt diesen User)</span>
        </label>
        <label class="flex items-start gap-2">
          <input type="checkbox" data-f="replace_existing_signatures" class="mt-1" ${user.replace_existing_signatures ? 'checked' : ''}/>
          <span class="text-sm">
            <span class="font-medium text-amber-700">Bestehende Signaturen ersetzen</span>
            <span class="block text-xs text-slate-500">Beim Deploy wird der komplette Outlook-Signatures-Ordner dieses Users auf den Terminalservern geleert, bevor die neue Signatur geschrieben wird. Alle anderen Signaturen des Users gehen verloren.</span>
          </span>
        </label>
      </div>

      <div class="border-t pt-4">
        <h3 class="font-semibold mb-2">Live-Preview</h3>
        <div id="user-preview" class="sig-preview">Bitte erst speichern fuer Preview</div>
      </div>

      <div class="flex justify-between gap-2 pt-2 border-t">
        <div>
          ${id ? '<button data-action="uninstall" class="px-4 py-2 bg-red-100 hover:bg-red-200 text-red-800 rounded-lg" title="Tool-Spuren (Startup-CMD + Signatures-Ordner) auf allen TS entfernen">Tool-Spuren entfernen</button>' : ''}
        </div>
        <div class="flex gap-2">
          <button data-action="preview" class="px-4 py-2 bg-slate-200 hover:bg-slate-300 rounded-lg">Preview</button>
          <button data-action="save" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold">Speichern</button>
          ${id ? '<button data-action="save-deploy" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold">Speichern + Deploy</button>' : ''}
        </div>
      </div>
    </div>
  `);

  const modal = openModal(id ? `Mitarbeiter bearbeiten: ${user.display_name}` : 'Neuen Mitarbeiter anlegen', body, { wide: true });

  function readForm() {
    const data = {};
    body.querySelectorAll('[data-f]').forEach(input => {
      const f = input.dataset.f;
      if (input.type === 'checkbox') data[f] = input.checked;
      else data[f] = input.value;
    });
    if (data.custom_fields) {
      try { data.custom_fields = JSON.parse(data.custom_fields); } catch { throw new Error('Custom-Fields ist kein valides JSON'); }
    }
    if (data.template_id === '') data.template_id = null;
    return data;
  }

  async function save() {
    try {
      const data = readForm();
      let savedId = id;
      if (id) {
        await api.put('/api/users/' + id, data);
      } else {
        const r = await api.post('/api/users', data);
        savedId = r.id;
      }
      toast('Gespeichert', 'success');
      return savedId;
    } catch (err) { toast(err.message, 'error'); return null; }
  }

  async function preview() {
    if (!id) { toast('Erst speichern fuer Preview', 'warn'); return; }
    try {
      const tplId = body.querySelector('[data-f=template_id]').value;
      const r = await api.get(`/api/users/${id}/preview${tplId ? '?template_id=' + tplId : ''}`);
      body.querySelector('#user-preview').innerHTML = r.html || '<em class="text-slate-400">Kein Template-Output</em>';
    } catch (err) { toast(err.message, 'error'); }
  }

  body.querySelector('[data-action=save]').onclick = async () => {
    const sid = await save();
    if (sid) { modal.close(); route(); }
  };
  body.querySelector('[data-action=preview]').onclick = preview;
  const sd = body.querySelector('[data-action=save-deploy]');
  if (sd) sd.onclick = async () => {
    const sid = await save();
    if (sid) { await deploySingleUser(sid); modal.close(); route(); }
  };
  const ub = body.querySelector('[data-action=uninstall]');
  if (ub) ub.onclick = async () => {
    if (!await confirm(`Wirklich Startup-CMD und Signatures-Ordner von "${user.windows_username}" auf ALLEN aktiven TS entfernen?`)) return;
    try {
      const r = await api.post('/api/deploy/uninstall/' + id, {});
      const summary = r.results.map(x => `${x.server_name}: ${x.status}`).join(', ');
      toast(summary, r.results.every(x => x.status === 'ok' || x.status === 'skipped') ? 'success' : 'warn');
      modal.close();
      route();
    } catch (err) { toast(err.message, 'error'); }
  };

  if (id) preview();
}

// ---------- View: Templates ----------
registerRoute('#/templates', async (content) => {
  const [templates, variables] = await Promise.all([
    api.get('/api/templates'),
    api.get('/api/templates/variables'),
  ]);
  content.innerHTML = '';
  content.appendChild(el(`
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <h1 class="text-2xl font-bold">Signatur-Templates</h1>
        <button id="new-tpl" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold">+ Template</button>
      </div>
      <div class="bg-white rounded-xl shadow-sm overflow-hidden">
        <table class="w-full text-sm">
          <thead class="bg-slate-50 text-slate-600">
            <tr>
              <th class="text-left px-5 py-2">Name</th>
              <th class="text-left px-5 py-2">Default</th>
              <th class="text-left px-5 py-2">Anwendungsfaelle</th>
              <th class="text-left px-5 py-2">Aktualisiert</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${templates.map(t => `
              <tr class="border-t hover:bg-slate-50">
                <td class="px-5 py-2 font-medium">${esc(t.name)}</td>
                <td class="px-5 py-2">${t.is_default ? '<span class="text-emerald-600">●</span>' : ''}</td>
                <td class="px-5 py-2 text-slate-500 text-xs">
                  ${[t.apply_to_new && 'Neu', t.apply_to_reply && 'Reply', t.apply_to_forward && 'Forward'].filter(Boolean).join(' · ')}
                  ${t.internal_only ? ' · nur intern' : ''}
                </td>
                <td class="px-5 py-2 text-slate-500">${esc(t.updated_at)}</td>
                <td class="px-5 py-2 text-right">
                  <button data-edit-tpl="${t.id}" class="text-blue-600 hover:underline mr-3">Bearbeiten</button>
                  <button data-del-tpl="${t.id}" class="text-red-600 hover:underline">Loeschen</button>
                </td>
              </tr>
            `).join('') || '<tr><td colspan="5" class="px-5 py-6 text-slate-400 text-center">Noch keine Templates</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `));

  document.getElementById('new-tpl').onclick = () => openTemplateModal(null, variables);
  document.querySelectorAll('[data-edit-tpl]').forEach(b => b.onclick = () => openTemplateModal(b.dataset.editTpl, variables));
  document.querySelectorAll('[data-del-tpl]').forEach(b => b.onclick = async () => {
    if (!await confirm('Template loeschen?')) return;
    try { await api.del('/api/templates/' + b.dataset.delTpl); toast('Geloescht', 'success'); route(); }
    catch (err) { toast(err.message, 'error'); }
  });
});

async function openTemplateModal(id, variables) {
  const tpl = id ? await api.get('/api/templates/' + id) : {
    name: '', description: '', html_body: defaultTemplateHtml(),
    is_default: 0, apply_to_new: 1, apply_to_reply: 1, apply_to_forward: 1, internal_only: 0,
  };

  const body = el(`
    <div class="h-full flex flex-col gap-4">
      <!-- Kopf-Felder einreihig oben -->
      <div class="grid grid-cols-12 gap-3 items-end">
        <div class="col-span-3">
          <label class="text-xs uppercase text-slate-500">Name *</label>
          <input data-f="name" value="${esc(tpl.name)}" class="w-full px-3 py-2 border rounded-lg"/>
        </div>
        <div class="col-span-4">
          <label class="text-xs uppercase text-slate-500">Beschreibung</label>
          <input data-f="description" value="${esc(tpl.description || '')}" class="w-full px-3 py-2 border rounded-lg"/>
        </div>
        <div class="col-span-5 flex gap-4 flex-wrap items-center text-sm">
          <label class="flex items-center gap-1"><input type="checkbox" data-f="is_default" ${tpl.is_default ? 'checked' : ''}/> Default</label>
          <label class="flex items-center gap-1"><input type="checkbox" data-f="apply_to_new" ${tpl.apply_to_new ? 'checked' : ''}/> Neu</label>
          <label class="flex items-center gap-1"><input type="checkbox" data-f="apply_to_reply" ${tpl.apply_to_reply ? 'checked' : ''}/> Reply</label>
          <label class="flex items-center gap-1"><input type="checkbox" data-f="apply_to_forward" ${tpl.apply_to_forward ? 'checked' : ''}/> Forward</label>
        </div>
      </div>

      <!-- Schnelleinfuege-Leiste: Platzhalter + Bilder -->
      <div class="bg-slate-50 border rounded-lg px-3 py-2 text-xs flex flex-wrap items-center gap-1">
        <button type="button" id="pick-asset-btn" class="bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded font-semibold mr-2 flex items-center gap-1">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
          Bild aus Library
        </button>
        <span class="text-slate-500 mx-2">|</span>
        <span class="text-slate-500 mr-1">Platzhalter:</span>
        ${variables.map(v => `<button type="button" data-insert="{{${v.key}}}" class="bg-white hover:bg-blue-100 border px-2 py-0.5 rounded">{{${v.key}}}</button>`).join('')}
      </div>

      <!-- Editor links (breit) + Preview rechts -->
      <div class="grid grid-cols-12 gap-4 flex-1 min-h-0">
        <div class="col-span-8 flex flex-col min-h-0">
          <label class="text-xs uppercase text-slate-500 mb-1">Signatur-Inhalt</label>
          <textarea data-f="html_body" id="tpl-editor">${esc(tpl.html_body)}</textarea>
        </div>
        <div class="col-span-4 flex flex-col min-h-0">
          <label class="text-xs uppercase text-slate-500 mb-1">Live-Preview</label>
          <div id="tpl-preview" class="sig-preview flex-1 overflow-auto">—</div>
          <p class="text-xs text-slate-400 mt-1">Bilder werden im echten Deploy als lokale Dateien (image001...) eingebettet.</p>
        </div>
      </div>

      <!-- Aktionsleiste -->
      <div class="flex justify-end gap-2 pt-3 border-t">
        <button data-action="refresh" class="px-4 py-2 bg-slate-200 hover:bg-slate-300 rounded-lg">Preview aktualisieren</button>
        <button data-action="save" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold">Speichern</button>
      </div>
    </div>
  `);

  const modal = openModal(id ? 'Template bearbeiten' : 'Neues Template', body, { huge: true });

  // SunEditor montieren — Hoehe dynamisch zur Modal-Hoehe
  const ed = editorHelpers.create(body.querySelector('#tpl-editor'), { height: 'calc(94vh - 280px)' });
  // SunEditor neu vermessen, nachdem das Modal im Layout sitzt
  requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));

  // Placeholder-Buttons fuegen Variable im Editor ein
  body.querySelectorAll('[data-insert]').forEach(b => {
    b.onclick = () => ed.insertHTML(b.dataset.insert, true);
  });

  // "Bild aus Library" — oeffnet Asset-Picker und fuegt das gewaehlte Bild ein
  body.querySelector('#pick-asset-btn').onclick = () => {
    openAssetPicker(asset => {
      if (!asset) return;
      const altText = (asset.name || 'Bild').replace(/"/g, '');
      const html = `<img src="/api/assets/${asset.id}/file" alt="${altText}" style="max-width:200px;height:auto;" />`;
      ed.insertHTML(html, true);
      toast(`"${asset.name}" eingefuegt`, 'success');
    });
  };

  let cachedLogoTag = null;
  async function refreshPreview() {
    if (cachedLogoTag === null) {
      try {
        const s = await api.get('/api/settings');
        cachedLogoTag = s.company_logo_asset_id
          ? `<img src="/api/assets/${s.company_logo_asset_id}/file" alt="Logo" style="max-width:${s.company_logo_width || 150}px;height:auto;" />`
          : '';
      } catch { cachedLogoTag = ''; }
    }
    const html = ed.getContents();
    const sample = {
      displayName: 'Max Mustermann', jobTitle: 'Geschaeftsfuehrer', department: 'Vertrieb',
      company: 'Beispiel GmbH', office: 'Hauptsitz', email: 'max@example.com',
      phone: '+49 6341 1234567', mobile: '+49 170 1234567', fax: '+49 6341 1234568',
      street: 'Musterstr. 1', city: 'Musterstadt', postalCode: '12345', country: 'DE',
      website: 'https://example.com',
      logo: cachedLogoTag,
    };
    const rendered = html.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => sample[k] != null ? sample[k] : '');
    body.querySelector('#tpl-preview').innerHTML = rendered;
  }

  ed.onChange = refreshPreview;
  body.querySelector('[data-action=refresh]').onclick = refreshPreview;
  refreshPreview();

  body.querySelector('[data-action=save]').onclick = async () => {
    const data = { html_body: ed.getContents() };
    body.querySelectorAll('[data-f]').forEach(input => {
      const f = input.dataset.f;
      if (f === 'html_body') return; // schon aus Editor geholt
      if (input.type === 'checkbox') data[f] = input.checked;
      else data[f] = input.value;
    });
    if (!data.name) { toast('Name fehlt', 'error'); return; }
    try {
      if (id) await api.put('/api/templates/' + id, data);
      else await api.post('/api/templates', data);
      toast('Gespeichert', 'success');
      editorHelpers.destroy(ed);
      modal.close();
      route();
    } catch (err) { toast(err.message, 'error'); }
  };
}

function defaultTemplateHtml() {
  return `<table cellpadding="0" cellspacing="0" border="0" style="font-family: Calibri, Arial, sans-serif; font-size: 11pt; color: #0f172a;">
<tbody><tr>
<td style="padding-right: 16px; border-right: 2px solid #2563eb; vertical-align: top;">
<strong style="font-size: 13pt; color: #0f172a;">{{displayName}}</strong><br>
<span style="color: #64748b;">{{jobTitle}}</span>
</td>
<td style="padding-left: 16px; vertical-align: top;">
<strong>{{company}}</strong><br>
{{street}}, {{postalCode}} {{city}}<br>
Tel: {{phone}} &nbsp;|&nbsp; Mobil: {{mobile}}<br>
<a href="mailto:{{email}}" style="color: #2563eb;">{{email}}</a> &nbsp;|&nbsp;
<a href="{{website}}" style="color: #2563eb;">{{website}}</a>
</td>
</tr></tbody></table>`;
}

// ---------- View: Servers ----------
registerRoute('#/servers', async (content) => {
  const servers = await api.get('/api/servers');
  content.innerHTML = '';
  content.appendChild(el(`
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <h1 class="text-2xl font-bold">Terminalserver (${servers.length})</h1>
        <button id="new-srv" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold">+ Server</button>
      </div>
      <div class="bg-white rounded-xl shadow-sm overflow-hidden">
        <table class="w-full text-sm">
          <thead class="bg-slate-50 text-slate-600">
            <tr>
              <th class="text-left px-5 py-2">Name</th>
              <th class="text-left px-5 py-2">Hostname</th>
              <th class="text-left px-5 py-2">Domain\\User</th>
              <th class="text-left px-5 py-2">Profile-Pfad</th>
              <th class="text-left px-5 py-2">Letzter Check</th>
              <th class="text-left px-5 py-2">Aktiv</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${servers.map(s => `
              <tr class="border-t hover:bg-slate-50">
                <td class="px-5 py-2 font-medium">${esc(s.name)}</td>
                <td class="px-5 py-2">${esc(s.hostname)} \\ ${esc(s.share)}</td>
                <td class="px-5 py-2 text-slate-600">${esc(s.domain || '')}\\${esc(s.username)}</td>
                <td class="px-5 py-2 text-slate-600">${esc(s.profile_path)}</td>
                <td class="px-5 py-2 text-slate-500">
                  ${s.last_check_at ? `${esc(s.last_check_at)} ${s.last_check_ok ? '<span class="text-emerald-600">OK</span>' : '<span class="text-red-600">Fehler</span>'}` : '<span class="text-slate-400">nie</span>'}
                  <div class="text-xs text-slate-400">${esc(s.last_check_message || '')}</div>
                </td>
                <td class="px-5 py-2">${s.enabled ? '<span class="text-emerald-600">●</span>' : '<span class="text-slate-300">○</span>'}</td>
                <td class="px-5 py-2 text-right whitespace-nowrap">
                  <button data-test-srv="${s.id}" class="text-emerald-600 hover:underline mr-3">Test</button>
                  <button data-edit-srv="${s.id}" class="text-blue-600 hover:underline mr-3">Bearbeiten</button>
                  <button data-del-srv="${s.id}" class="text-red-600 hover:underline">Loeschen</button>
                </td>
              </tr>
            `).join('') || '<tr><td colspan="7" class="px-5 py-6 text-slate-400 text-center">Noch keine Server angelegt</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `));

  document.getElementById('new-srv').onclick = () => openServerModal(null);
  document.querySelectorAll('[data-edit-srv]').forEach(b => b.onclick = () => openServerModal(b.dataset.editSrv));
  document.querySelectorAll('[data-test-srv]').forEach(b => b.onclick = async () => {
    try {
      const r = await api.post(`/api/servers/${b.dataset.testSrv}/test`, {});
      toast(r.ok ? `OK: ${r.message}` : `Fehler: ${r.message}`, r.ok ? 'success' : 'error');
      route();
    } catch (err) { toast(err.message, 'error'); }
  });
  document.querySelectorAll('[data-del-srv]').forEach(b => b.onclick = async () => {
    if (!await confirm('Server loeschen?')) return;
    try { await api.del('/api/servers/' + b.dataset.delSrv); toast('Geloescht', 'success'); route(); }
    catch (err) { toast(err.message, 'error'); }
  });
});

async function openServerModal(id) {
  const srv = id ? (await api.get('/api/servers')).find(s => s.id == id) : {
    name: '', hostname: '', share: 'C$', profile_path: 'Users',
    domain: '', username: 'Administrator', enabled: 1, has_password: false,
  };
  const body = el(`
    <div class="space-y-3">
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="text-xs uppercase text-slate-500">Anzeige-Name *</label>
          <input data-f="name" value="${esc(srv.name)}" class="w-full px-3 py-2 border rounded-lg" placeholder="TS01"/>
        </div>
        <div>
          <label class="text-xs uppercase text-slate-500">Hostname / IP *</label>
          <input data-f="hostname" value="${esc(srv.hostname)}" class="w-full px-3 py-2 border rounded-lg" placeholder="ts01.example.local"/>
        </div>
        <div>
          <label class="text-xs uppercase text-slate-500">Share</label>
          <input data-f="share" value="${esc(srv.share)}" class="w-full px-3 py-2 border rounded-lg"/>
        </div>
        <div>
          <label class="text-xs uppercase text-slate-500">User-Profile-Pfad (innerhalb Share)</label>
          <input data-f="profile_path" value="${esc(srv.profile_path)}" class="w-full px-3 py-2 border rounded-lg" placeholder="Users"/>
        </div>
        <div>
          <label class="text-xs uppercase text-slate-500">Domain</label>
          <input data-f="domain" value="${esc(srv.domain || '')}" class="w-full px-3 py-2 border rounded-lg"/>
        </div>
        <div>
          <label class="text-xs uppercase text-slate-500">Username (Admin) *</label>
          <input data-f="username" value="${esc(srv.username)}" class="w-full px-3 py-2 border rounded-lg"/>
        </div>
        <div class="col-span-2">
          <label class="text-xs uppercase text-slate-500">Passwort ${id ? '(leer lassen = unveraendert)' : '*'}</label>
          <input data-f="password" type="password" autocomplete="new-password" class="w-full px-3 py-2 border rounded-lg" placeholder="${id ? '••••••••' : ''}"/>
        </div>
      </div>
      <label class="flex items-center gap-2"><input type="checkbox" data-f="enabled" ${srv.enabled ? 'checked' : ''}/> Aktiv</label>
      <div class="flex justify-end gap-2 pt-2 border-t">
        <button data-action="save" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold">Speichern</button>
      </div>
    </div>
  `);
  const modal = openModal(id ? `Server: ${srv.name}` : 'Neuen Terminalserver', body);
  body.querySelector('[data-action=save]').onclick = async () => {
    const data = {};
    body.querySelectorAll('[data-f]').forEach(i => data[i.dataset.f] = i.type === 'checkbox' ? i.checked : i.value);
    if (!data.password) delete data.password;
    try {
      if (id) await api.put('/api/servers/' + id, data);
      else await api.post('/api/servers', data);
      toast('Gespeichert', 'success');
      modal.close();
      route();
    } catch (err) { toast(err.message, 'error'); }
  };
}

// ---------- View: Footer ----------
registerRoute('#/footer', async (content) => {
  const f = await api.get('/api/footer');
  content.innerHTML = '';
  content.appendChild(el(`
    <div class="space-y-4 max-w-3xl">
      <h1 class="text-2xl font-bold">Pflicht-Footer / Disclaimer</h1>
      <p class="text-sm text-slate-500">Wird zusaetzlich zur Signatur angehaengt. Optional, normalerweise nur fuer externe Mails.</p>

      <div class="bg-white rounded-xl shadow-sm p-5 space-y-3">
        <label class="flex items-center gap-2"><input type="checkbox" data-f="enabled" ${f.enabled ? 'checked' : ''}/> Footer aktiviert</label>
        <div class="grid grid-cols-3 gap-2">
          <label class="flex items-center gap-2"><input type="checkbox" data-f="apply_to_new" ${f.apply_to_new ? 'checked' : ''}/> Neue Mail</label>
          <label class="flex items-center gap-2"><input type="checkbox" data-f="apply_to_reply" ${f.apply_to_reply ? 'checked' : ''}/> Reply</label>
          <label class="flex items-center gap-2"><input type="checkbox" data-f="apply_to_forward" ${f.apply_to_forward ? 'checked' : ''}/> Forward</label>
        </div>
        <label class="flex items-center gap-2"><input type="checkbox" data-f="external_only" ${f.external_only ? 'checked' : ''}/> Nur fuer externe Empfaenger</label>
        <div>
          <label class="text-xs uppercase text-slate-500">Inhalt</label>
          <textarea id="footer-editor" data-f="html_body">${esc(f.html_body || '')}</textarea>
        </div>
        <button id="save-footer" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold">Speichern</button>
      </div>
    </div>
  `));
  const fed = editorHelpers.create(document.getElementById('footer-editor'), { height: '280px' });
  document.getElementById('save-footer').onclick = async () => {
    const data = { html_body: fed.getContents() };
    document.querySelectorAll('[data-f]').forEach(i => {
      const f = i.dataset.f;
      if (f === 'html_body') return;
      data[f] = i.type === 'checkbox' ? i.checked : i.value;
    });
    try { await api.put('/api/footer', data); toast('Gespeichert', 'success'); }
    catch (err) { toast(err.message, 'error'); }
  };
});

// ---------- View: Assets ----------
registerRoute('#/assets', async (content) => {
  const assets = await api.get('/api/assets');
  content.innerHTML = '';
  content.appendChild(el(`
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <h1 class="text-2xl font-bold">Bilder & Logos (${assets.length})</h1>
        <label class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold cursor-pointer">
          + Bild hochladen
          <input type="file" id="asset-upload" accept="image/png,image/jpeg,image/gif,image/webp" class="hidden" multiple/>
        </label>
      </div>
      <p class="text-sm text-slate-500">Max 5 MB pro Datei. PNG/JPEG/GIF/WEBP. Werden beim Deploy ins User-Profil als <code>imageNNN.&lt;ext&gt;</code> mitgeliefert. Klick aufs Bild oeffnet Detailansicht.</p>

      ${assets.length === 0 ? '<div class="bg-white rounded-xl shadow-sm p-12 text-center text-slate-400">Noch keine Bilder hochgeladen</div>' : `
      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        ${assets.map(a => `
          <div class="bg-white rounded-xl shadow-sm overflow-hidden group">
            <div class="aspect-square bg-slate-50 flex items-center justify-center overflow-hidden">
              <img src="/api/assets/${a.id}/file" alt="${esc(a.name)}" class="max-w-full max-h-full object-contain"/>
            </div>
            <div class="p-3">
              <div class="text-sm font-medium truncate" title="${esc(a.name)}">${esc(a.name)}</div>
              <div class="text-xs text-slate-400 truncate">${formatBytes(a.size_bytes)} · ${esc(a.mime_type.replace('image/', ''))}</div>
              <div class="flex justify-between mt-2">
                <button data-copy-url="${a.id}" class="text-xs text-blue-600 hover:underline">URL kopieren</button>
                <button data-del-asset="${a.id}" class="text-xs text-red-600 hover:underline">Loeschen</button>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
      `}
    </div>
  `));

  document.getElementById('asset-upload').onchange = async (e) => {
    const files = Array.from(e.target.files || []);
    for (const file of files) {
      try {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('name', file.name);
        const r = await fetch('/api/assets', { method: 'POST', body: fd, credentials: 'same-origin' });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j.error || `HTTP ${r.status}`);
        }
        toast(`Hochgeladen: ${file.name}`, 'success');
      } catch (err) { toast(`${file.name}: ${err.message}`, 'error'); }
    }
    route();
  };

  document.querySelectorAll('[data-copy-url]').forEach(b => b.onclick = () => {
    const url = `/api/assets/${b.dataset.copyUrl}/file`;
    navigator.clipboard.writeText(url).then(() => toast(`URL kopiert: ${url}`, 'success'));
  });

  document.querySelectorAll('[data-del-asset]').forEach(b => b.onclick = async () => {
    if (!await confirm('Bild loeschen? Templates die das Bild verwenden zeigen danach nichts mehr.')) return;
    try { await api.del('/api/assets/' + b.dataset.delAsset); toast('Geloescht', 'success'); route(); }
    catch (err) { toast(err.message, 'error'); }
  });
});

function formatBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1024 / 1024).toFixed(1) + ' MB';
}

// ---------- View: Deploy-Matrix ----------
registerRoute('#/matrix', async (content) => {
  const data = await api.get('/api/audit/matrix');
  content.innerHTML = '';
  content.appendChild(el(`
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <h1 class="text-2xl font-bold">Deploy-Status (${data.users.length} User × ${data.servers.length} Server)</h1>
        <div class="flex gap-2">
          <button id="matrix-refresh" class="px-3 py-2 bg-slate-200 hover:bg-slate-300 rounded-lg text-sm">Aktualisieren</button>
          <button id="matrix-deploy-all" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold">Alle deployen</button>
        </div>
      </div>
      <p class="text-sm text-slate-500">Letzter Stand pro User + Server. Klick auf eine Zeile = Mitarbeiter-Deploy. Klick auf Zell-Status = Detail-Tooltip mit Nachricht.</p>

      <div class="bg-white rounded-xl shadow-sm overflow-auto">
        <table class="w-full text-sm">
          <thead class="bg-slate-50 text-slate-600 sticky top-0">
            <tr>
              <th class="text-left px-4 py-2 sticky left-0 bg-slate-50">Mitarbeiter</th>
              <th class="text-left px-4 py-2">Abteilung</th>
              ${data.servers.map(s => `<th class="text-left px-4 py-2 whitespace-nowrap">${esc(s.name)}<br><span class="text-xs text-slate-400 font-normal">${esc(s.hostname)}</span></th>`).join('')}
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${data.users.map(u => `
              <tr class="border-t hover:bg-slate-50">
                <td class="px-4 py-2 font-medium sticky left-0 bg-white">${esc(u.display_name)}<div class="text-xs text-slate-500">${esc(u.windows_username)}${u.enabled ? '' : ' <span class="text-amber-600">[inaktiv]</span>'}</div></td>
                <td class="px-4 py-2 text-slate-500">${esc(u.department || '')}</td>
                ${data.servers.map(s => {
                  const cell = data.matrix[u.id]?.[s.id];
                  if (!cell) return '<td class="px-4 py-2 text-slate-300">—</td>';
                  return `<td class="px-4 py-2" title="${esc(cell.message || '')} (${esc(cell.created_at)})">${statusBadge(cell.status)}<div class="text-xs text-slate-400 mt-0.5">${esc(cell.created_at.split(' ')[1] || cell.created_at)}</div></td>`;
                }).join('')}
                <td class="px-4 py-2 text-right">
                  <button data-deploy-user="${u.id}" class="text-emerald-600 hover:underline text-sm whitespace-nowrap">Re-Deploy</button>
                </td>
              </tr>
            `).join('') || `<tr><td colspan="${data.servers.length + 3}" class="px-5 py-12 text-slate-400 text-center">Keine Daten</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `));

  document.getElementById('matrix-refresh').onclick = () => route();
  document.getElementById('matrix-deploy-all').onclick = async () => {
    if (!await confirm('Alle Mitarbeiter auf alle Server deployen?')) return;
    try {
      const r = await api.post('/api/deploy/all', {});
      toast(`Fertig: ${r.by_status.ok || 0} OK / ${r.by_status.skipped || 0} skipped / ${r.by_status.error || 0} Fehler`, 'success');
      route();
    } catch (err) { toast(err.message, 'error'); }
  };
  document.querySelectorAll('[data-deploy-user]').forEach(b => b.onclick = () => deploySingleUser(b.dataset.deployUser));
});

// ---------- View: Audit ----------
registerRoute('#/audit', async (content) => {
  const [audit, deploys] = await Promise.all([
    api.get('/api/audit?limit=100'),
    api.get('/api/audit/deploys?limit=100'),
  ]);
  content.innerHTML = '';
  content.appendChild(el(`
    <div class="space-y-6">
      <h1 class="text-2xl font-bold">Audit-Log</h1>

      <div class="bg-white rounded-xl shadow-sm overflow-hidden">
        <div class="px-5 py-3 border-b"><h2 class="font-semibold">Deploy-Historie</h2></div>
        <table class="w-full text-sm">
          <thead class="bg-slate-50 text-slate-600">
            <tr>
              <th class="text-left px-5 py-2">Zeit</th>
              <th class="text-left px-5 py-2">User</th>
              <th class="text-left px-5 py-2">Server</th>
              <th class="text-left px-5 py-2">Status</th>
              <th class="text-left px-5 py-2">Dauer</th>
              <th class="text-left px-5 py-2">Bytes</th>
              <th class="text-left px-5 py-2">Nachricht</th>
            </tr>
          </thead>
          <tbody>
            ${deploys.map(d => `
              <tr class="border-t">
                <td class="px-5 py-2 text-slate-500 whitespace-nowrap">${esc(d.created_at)}</td>
                <td class="px-5 py-2">${esc(d.display_name || d.windows_username || '—')}</td>
                <td class="px-5 py-2">${esc(d.server_name || '—')}</td>
                <td class="px-5 py-2">${statusBadge(d.status)}</td>
                <td class="px-5 py-2 text-slate-500">${d.duration_ms || 0} ms</td>
                <td class="px-5 py-2 text-slate-500">${d.bytes_written || 0}</td>
                <td class="px-5 py-2 text-slate-500">${esc(d.message || '')}</td>
              </tr>
            `).join('') || '<tr><td colspan="7" class="px-5 py-6 text-slate-400 text-center">Noch keine Deploys</td></tr>'}
          </tbody>
        </table>
      </div>

      <div class="bg-white rounded-xl shadow-sm overflow-hidden">
        <div class="px-5 py-3 border-b"><h2 class="font-semibold">Aktivitaeten</h2></div>
        <table class="w-full text-sm">
          <thead class="bg-slate-50 text-slate-600">
            <tr>
              <th class="text-left px-5 py-2">Zeit</th>
              <th class="text-left px-5 py-2">Admin</th>
              <th class="text-left px-5 py-2">Aktion</th>
              <th class="text-left px-5 py-2">Ziel</th>
              <th class="text-left px-5 py-2">IP</th>
              <th class="text-left px-5 py-2">Details</th>
            </tr>
          </thead>
          <tbody>
            ${audit.map(a => `
              <tr class="border-t">
                <td class="px-5 py-2 text-slate-500 whitespace-nowrap">${esc(a.created_at)}</td>
                <td class="px-5 py-2">${esc(a.admin || '—')}</td>
                <td class="px-5 py-2"><code class="text-xs bg-slate-100 px-1 rounded">${esc(a.action)}</code></td>
                <td class="px-5 py-2 text-slate-600">${esc(a.target || '')}</td>
                <td class="px-5 py-2 text-slate-500">${esc(a.ip || '')}</td>
                <td class="px-5 py-2 text-xs text-slate-500 max-w-md truncate">${esc(JSON.stringify(a.details || ''))}</td>
              </tr>
            `).join('') || '<tr><td colspan="6" class="px-5 py-6 text-slate-400 text-center">Keine Eintraege</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `));
});

// ---------- View: Settings ----------
registerRoute('#/settings', async (content) => {
  const [me, admins, settings, assets] = await Promise.all([
    api.get('/api/auth/me'),
    api.get('/api/auth/admins'),
    api.get('/api/settings'),
    api.get('/api/assets'),
  ]);
  const logoAsset = settings.company_logo_asset_id
    ? assets.find(a => a.id == settings.company_logo_asset_id) : null;
  const logoWidth = settings.company_logo_width || '150';
  const autoEnabled = settings.auto_deploy_enabled === '1' || settings.auto_deploy_enabled === 'true';
  const autoTime = settings.auto_deploy_time || '03:00';
  const retentionDays = settings.log_retention_days || '90';
  const lastCleanup = settings.log_cleanup_last_run || '—';

  content.innerHTML = '';
  content.appendChild(el(`
    <div class="space-y-6 max-w-3xl">
      <h1 class="text-2xl font-bold">Einstellungen</h1>

      <!-- Firmenlogo -->
      <div class="bg-white rounded-xl shadow-sm overflow-hidden">
        <div class="px-5 py-3 border-b"><h2 class="font-semibold">Firmenlogo (zentral)</h2></div>
        <div class="p-5 space-y-3">
          <p class="text-sm text-slate-500">Wird in Templates als <code class="bg-slate-100 px-1 rounded">{{logo}}</code> referenziert. Aenderung wirkt sofort in allen Templates.</p>
          <div class="flex items-center gap-4">
            <div class="w-32 h-32 bg-slate-50 border rounded flex items-center justify-center overflow-hidden">
              ${logoAsset ? `<img src="/api/assets/${logoAsset.id}/file" class="max-w-full max-h-full object-contain"/>` : '<span class="text-xs text-slate-400">Kein Logo</span>'}
            </div>
            <div class="space-y-2 flex-1">
              <div class="text-sm">${logoAsset ? esc(logoAsset.name) : '<span class="text-slate-400">Noch kein Logo gesetzt</span>'}</div>
              <div class="flex items-center gap-2">
                <label class="text-xs text-slate-500">Anzeigebreite:</label>
                <input id="logo-width" type="number" min="50" max="800" value="${esc(logoWidth)}" class="px-2 py-1 border rounded w-24 text-sm"/>
                <span class="text-xs text-slate-500">px</span>
              </div>
              <div class="flex gap-2">
                <button id="logo-pick" class="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg">Logo waehlen</button>
                ${logoAsset ? '<button id="logo-clear" class="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-sm rounded-lg">Entfernen</button>' : ''}
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Auto-Deploy -->
      <div class="bg-white rounded-xl shadow-sm overflow-hidden">
        <div class="px-5 py-3 border-b"><h2 class="font-semibold">Auto-Deploy (Scheduler)</h2></div>
        <div class="p-5 space-y-3">
          <p class="text-sm text-slate-500">Deployt alle aktiven Mitarbeiter auf alle aktiven Server taeglich zur eingestellten Zeit.</p>
          <label class="flex items-center gap-2">
            <input type="checkbox" id="auto-enabled" ${autoEnabled ? 'checked' : ''}/>
            <span>Auto-Deploy aktiv</span>
          </label>
          <div class="flex items-center gap-2">
            <label class="text-sm text-slate-600">Zeitpunkt:</label>
            <input type="time" id="auto-time" value="${esc(autoTime)}" class="px-2 py-1 border rounded text-sm"/>
            <span class="text-xs text-slate-500">Server-Lokalzeit</span>
          </div>
          <button id="auto-save" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold text-sm">Speichern</button>
        </div>
      </div>

      <!-- Log-Retention -->
      <div class="bg-white rounded-xl shadow-sm overflow-hidden">
        <div class="px-5 py-3 border-b"><h2 class="font-semibold">Log-Retention</h2></div>
        <div class="p-5 space-y-3">
          <p class="text-sm text-slate-500">Loescht Eintraege in <code class="bg-slate-100 px-1 rounded">audit_log</code> und <code class="bg-slate-100 px-1 rounded">deploy_log</code>, die aelter als X Tage sind. Laeuft 1x taeglich automatisch im Scheduler.</p>
          <div class="flex items-center gap-2">
            <label class="text-sm text-slate-600">Aufbewahrungsdauer:</label>
            <input type="number" id="retention-days" min="7" max="3650" value="${esc(retentionDays)}" class="px-2 py-1 border rounded w-20 text-sm"/>
            <span class="text-xs text-slate-500">Tage</span>
          </div>
          <div class="text-xs text-slate-500">Letzter Cleanup-Lauf: ${esc(lastCleanup)}</div>
          <div class="flex gap-2">
            <button id="retention-save" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold text-sm">Speichern</button>
            <button id="retention-run-now" class="px-4 py-2 bg-slate-200 hover:bg-slate-300 rounded-lg text-sm">Cleanup jetzt ausfuehren</button>
          </div>
        </div>
      </div>

      <!-- Eigene Daten -->
      <div class="bg-white rounded-xl shadow-sm overflow-hidden">
        <div class="px-5 py-3 border-b"><h2 class="font-semibold">Mein Account</h2></div>
        <div class="p-5 space-y-4">
          <div>
            <label class="text-xs uppercase text-slate-500">Eingeloggt als</label>
            <div class="font-medium">${esc(me.username)}</div>
          </div>

          <div class="border-t pt-4">
            <label class="text-xs uppercase text-slate-500">Username aendern</label>
            <div class="flex gap-2 mt-1">
              <input id="my-new-username" value="${esc(me.username)}" class="flex-1 px-3 py-2 border rounded-lg"/>
              <button id="change-username" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold">Speichern</button>
            </div>
          </div>

          <div class="border-t pt-4">
            <label class="text-xs uppercase text-slate-500">Passwort aendern</label>
            <div class="flex gap-2 mt-1">
              <input id="my-new-password" type="password" autocomplete="new-password" placeholder="Neues Passwort (min. 6 Zeichen)" class="flex-1 px-3 py-2 border rounded-lg"/>
              <button id="change-password" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold">Speichern</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Andere Admins -->
      <div class="bg-white rounded-xl shadow-sm overflow-hidden">
        <div class="px-5 py-3 border-b flex items-center justify-between">
          <h2 class="font-semibold">Admin-Accounts (${admins.length})</h2>
          <button id="new-admin" class="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg font-semibold">+ Admin</button>
        </div>
        <table class="w-full text-sm">
          <thead class="bg-slate-50 text-slate-600">
            <tr>
              <th class="text-left px-5 py-2">Username</th>
              <th class="text-left px-5 py-2">Erstellt</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${admins.map(a => `
              <tr class="border-t">
                <td class="px-5 py-2 font-medium">
                  ${esc(a.username)}${a.id === me.id ? ' <span class="text-xs text-slate-400">(du)</span>' : ''}
                </td>
                <td class="px-5 py-2 text-slate-500">${esc(a.created_at)}</td>
                <td class="px-5 py-2 text-right whitespace-nowrap">
                  <button data-reset="${a.id}" data-user="${esc(a.username)}" class="text-blue-600 hover:underline mr-3">Passwort zuruecksetzen</button>
                  ${a.id !== me.id ? `<button data-del-admin="${a.id}" data-user="${esc(a.username)}" class="text-red-600 hover:underline">Loeschen</button>` : ''}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `));

  // Logo-Handler
  document.getElementById('logo-pick').onclick = () => {
    openAssetPicker(async (asset) => {
      if (!asset) return;
      const width = document.getElementById('logo-width').value || 150;
      try {
        await api.put('/api/settings/logo', { asset_id: asset.id, width, alt: asset.name });
        toast('Logo gesetzt', 'success');
        route();
      } catch (err) { toast(err.message, 'error'); }
    });
  };
  const logoClearBtn = document.getElementById('logo-clear');
  if (logoClearBtn) logoClearBtn.onclick = async () => {
    try {
      await api.put('/api/settings/logo', { asset_id: null });
      toast('Logo entfernt', 'success');
      route();
    } catch (err) { toast(err.message, 'error'); }
  };

  // Auto-Deploy-Handler
  document.getElementById('auto-save').onclick = async () => {
    const enabled = document.getElementById('auto-enabled').checked ? '1' : '0';
    const time = document.getElementById('auto-time').value || '03:00';
    try {
      await api.put('/api/settings', { auto_deploy_enabled: enabled, auto_deploy_time: time });
      toast('Auto-Deploy gespeichert', 'success');
    } catch (err) { toast(err.message, 'error'); }
  };

  // Retention-Handler
  document.getElementById('retention-save').onclick = async () => {
    const days = document.getElementById('retention-days').value || '90';
    try {
      await api.put('/api/settings', { log_retention_days: String(days) });
      toast('Retention gespeichert', 'success');
    } catch (err) { toast(err.message, 'error'); }
  };
  document.getElementById('retention-run-now').onclick = async () => {
    try {
      const r = await api.post('/api/settings/log-cleanup', {});
      toast(`Geloescht: audit=${r.audit_deleted} deploy=${r.deploy_deleted}`, 'success');
      route();
    } catch (err) { toast(err.message, 'error'); }
  };

  document.getElementById('change-username').onclick = async () => {
    const username = document.getElementById('my-new-username').value.trim();
    if (!username) return toast('Username fehlt', 'error');
    try {
      await api.put(`/api/auth/admins/${me.id}/username`, { username });
      toast('Username geaendert', 'success');
      state.currentUser = await api.get('/api/auth/me');
      document.getElementById('current-user').textContent = state.currentUser.username;
      route();
    } catch (err) { toast(err.message, 'error'); }
  };

  document.getElementById('change-password').onclick = async () => {
    const password = document.getElementById('my-new-password').value;
    if (password.length < 6) return toast('Passwort min. 6 Zeichen', 'error');
    try {
      await api.put(`/api/auth/admins/${me.id}/password`, { password });
      toast('Passwort geaendert', 'success');
      document.getElementById('my-new-password').value = '';
    } catch (err) { toast(err.message, 'error'); }
  };

  document.getElementById('new-admin').onclick = () => {
    const body = el(`
      <div class="space-y-3">
        <div>
          <label class="text-xs uppercase text-slate-500">Username</label>
          <input id="na-username" autocomplete="off" class="w-full px-3 py-2 border rounded-lg"/>
        </div>
        <div>
          <label class="text-xs uppercase text-slate-500">Passwort (min. 6 Zeichen)</label>
          <input id="na-password" type="password" autocomplete="new-password" class="w-full px-3 py-2 border rounded-lg"/>
        </div>
        <div class="flex justify-end gap-2 pt-2 border-t">
          <button data-action="save" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold">Anlegen</button>
        </div>
      </div>`);
    const m = openModal('Neuen Admin anlegen', body);
    body.querySelector('[data-action=save]').onclick = async () => {
      const username = body.querySelector('#na-username').value.trim();
      const password = body.querySelector('#na-password').value;
      try {
        await api.post('/api/auth/admins', { username, password });
        toast('Admin angelegt', 'success');
        m.close();
        route();
      } catch (err) { toast(err.message, 'error'); }
    };
  };

  document.querySelectorAll('[data-reset]').forEach(b => b.onclick = async () => {
    const body = el(`
      <div class="space-y-3">
        <p class="text-slate-700">Neues Passwort fuer <strong>${esc(b.dataset.user)}</strong>:</p>
        <input id="rp-password" type="password" autocomplete="new-password" class="w-full px-3 py-2 border rounded-lg" placeholder="min. 6 Zeichen"/>
        <div class="flex justify-end gap-2 pt-2 border-t">
          <button data-action="save" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold">Setzen</button>
        </div>
      </div>`);
    const m = openModal('Passwort zuruecksetzen', body);
    body.querySelector('[data-action=save]').onclick = async () => {
      const password = body.querySelector('#rp-password').value;
      try {
        await api.put(`/api/auth/admins/${b.dataset.reset}/password`, { password });
        toast('Passwort gesetzt', 'success');
        m.close();
      } catch (err) { toast(err.message, 'error'); }
    };
  });

  document.querySelectorAll('[data-del-admin]').forEach(b => b.onclick = async () => {
    if (!await confirm(`Admin "${b.dataset.user}" wirklich loeschen?`)) return;
    try { await api.del('/api/auth/admins/' + b.dataset.delAdmin); toast('Geloescht', 'success'); route(); }
    catch (err) { toast(err.message, 'error'); }
  });
});

// ---------- Boot ----------
(async () => {
  try {
    state.currentUser = await api.get('/api/auth/me');
    showApp();
  } catch {
    showLogin();
  }
})();
