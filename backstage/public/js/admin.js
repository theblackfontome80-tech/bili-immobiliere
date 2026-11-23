/* BILI IMMOBILIÈRE — espace administrateur */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = new Intl.NumberFormat('fr-FR');
  const TYPE = { appartement: 'Appartement', villa: 'Villa', maison: 'Maison', terrain: 'Terrain', studio: 'Studio', local: 'Local commercial' };
  const STATUS = { disponible: ['Disponible', 'tag--ok'], 'sous-offre': ['Sous offre', 'tag--warn'], vendu: ['Vendu', 'tag--off'], loue: ['Loué', 'tag--off'] };

  let csrf = '';
  let listings = [];
  let messages = [];
  let editing = null;      // annonce en cours d'édition
  let photos = [];         // photos de l'annonce en cours
  let dirty = false;
  let prefill = null;      // brouillon pré-rempli (bien proposé par un propriétaire)

  /* ---------- API ---------- */
  async function api(path, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    if (opts.json !== undefined) { headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(opts.json); }
    if (opts.method && opts.method !== 'GET') headers['X-CSRF-Token'] = csrf;
    const res = await fetch(path, { ...opts, headers, credentials: 'same-origin' });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && !path.endsWith('/login')) { showLogin(); throw new Error(data.error || 'Session expirée'); }
    if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
    return data;
  }

  let toastTimer;
  function toast(msg, err) {
    const t = $('#toast'); t.textContent = msg; t.classList.toggle('is-err', !!err); t.classList.add('is-on');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('is-on'), 3200);
  }

  /* ---------- Connexion ---------- */
  function showLogin() { $('#app-view').hidden = true; $('#login-view').hidden = false; $('#l-pass').focus(); }
  async function boot() {
    try {
      const me = await api('/api/admin/me');
      csrf = me.csrf;
      $('#login-view').hidden = true; $('#app-view').hidden = false;
      await Promise.all([loadListings(), loadMessages()]);
      route();
    } catch { showLogin(); }
  }
  $('#login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const err = $('#login-error'); err.hidden = true;
    const btn = e.target.querySelector('button'); btn.disabled = true;
    try {
      await api('/api/admin/login', { method: 'POST', json: { username: $('#l-user').value, password: $('#l-pass').value } });
      $('#l-pass').value = '';
      await boot();
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    finally { btn.disabled = false; }
  });
  $('#logout').addEventListener('click', async () => {
    try { await api('/api/admin/logout', { method: 'POST' }); } catch {}
    csrf = ''; showLogin();
  });

  /* ---------- Navigation ---------- */
  function route() {
    const hash = location.hash.slice(1) || 'tableau';
    let [view, id] = hash.split('/');
    if (view === 'messages') view = 'demandes';
    if (view !== 'edit') prefill = null;
    if (view === 'edit') return openEditor(id);
    if (view === 'demandes') { selectedId = id && messages.some(m => m.id === id) ? id : null; if (selectedId) return openMessage(selectedId).then(() => show('demandes')); }
    show(['tableau', 'demandes', 'annonces', 'securite'].includes(view) ? view : 'tableau');
  }
  function show(view) {
    $$('[data-view]').forEach(s => { s.hidden = s.dataset.view !== view; });
    $$('[data-tab]').forEach(a => a.toggleAttribute('aria-current', a.dataset.tab === view || (view === 'edit' && a.dataset.tab === 'annonces')));
    $$('[data-tab]').forEach(a => a.getAttribute('aria-current') === '' && a.setAttribute('aria-current', 'page'));
    if (view === 'annonces') renderRows();
    if (view === 'demandes') renderInbox();
    if (view === 'tableau') renderDashboard();
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', () => {
    if (dirty && !confirm('Des modifications ne sont pas enregistrées. Quitter quand même ?')) { history.pushState(null, '', `#edit/${editing && editing.id ? editing.id : 'new'}`); return; }
    dirty = false; route();
  });
  window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  /* ---------- Liste des annonces ---------- */
  async function loadListings() { listings = await api('/api/admin/listings'); }
  function priceLabel(l) {
    if (l.priceOnRequest || !l.price) return 'Sur demande';
    return `${nf.format(l.price)} TND${l.transaction === 'location' ? '/mois' : ''}`;
  }
  function renderRows() {
    const q = $('#q').value.trim().toLowerCase();
    const tx = $('#f-tx').value; const st = $('#f-state').value;
    const rows = listings.filter(l =>
      (!q || `${l.title} ${l.ref} ${l.city} ${l.district}`.toLowerCase().includes(q)) &&
      (!tx || l.transaction === tx) &&
      (!st || (st === 'published' ? l.published : st === 'draft' ? !l.published : st === 'demo' ? l.demo : l.status === st)));
    const online = listings.filter(l => l.published).length;
    $('#stats').textContent = `${listings.length} annonce${listings.length > 1 ? 's' : ''} · ${online} en ligne · ${listings.length - online} brouillon${listings.length - online > 1 ? 's' : ''}`;
    $('#rows').innerHTML = rows.length ? rows.map(l => `
      <tr>
        <td><div class="row-bien"><img src="${esc(l.photos[0] || '/img/placeholder.svg')}" alt="" loading="lazy">
          <div><strong>${esc(l.title)}</strong><span>${esc(l.ref)} · ${esc(TYPE[l.type])} · ${esc([l.district, l.city].filter(Boolean).join(', '))}</span>
          ${l.demo ? '<br><span class="tag tag--demo">Démonstration</span>' : ''}</div></div></td>
        <td>${l.transaction === 'vente' ? 'Vente' : 'Location'}</td>
        <td style="white-space:nowrap">${esc(priceLabel(l))}</td>
        <td><span class="tag ${STATUS[l.status][1]}">${STATUS[l.status][0]}</span></td>
        <td><label class="switch" title="${l.published ? 'En ligne' : 'Brouillon'}"><input type="checkbox" data-pub="${l.id}" ${l.published ? 'checked' : ''} aria-label="Publier ${esc(l.title)}"><span></span></label></td>
        <td class="right"><div class="actions">
          <a class="icon-btn" href="#edit/${l.id}" title="Modifier" aria-label="Modifier"><svg><use href="#a-edit"/></svg></a>
          ${l.published ? `<a class="icon-btn" href="${window.SITE_BASE || ''}/bien/${encodeURIComponent(l.ref)}" target="_blank" rel="noopener" title="Voir sur le site" aria-label="Voir sur le site"><svg><use href="#a-ext"/></svg></a>` : ''}
          <button class="icon-btn danger" type="button" data-del="${l.id}" title="Supprimer" aria-label="Supprimer"><svg><use href="#a-trash"/></svg></button>
        </div></td>
      </tr>`).join('') : '<tr class="empty-row"><td colspan="6">Aucune annonce ne correspond.</td></tr>';
    const demos = listings.filter(l => l.demo);
    $('#demo-tools').hidden = !demos.length;
    $('#demo-count').textContent = demos.length;
  }
  ['#q', '#f-tx', '#f-state'].forEach(s => $(s).addEventListener('input', renderRows));
  $('#rows').addEventListener('change', async e => {
    const id = e.target.dataset.pub; if (!id) return;
    const l = listings.find(x => x.id === id);
    try {
      const saved = await api(`/api/admin/listings/${id}`, { method: 'PUT', json: { ...l, published: e.target.checked } });
      Object.assign(l, saved); renderRows();
      toast(saved.published ? 'Annonce mise en ligne' : 'Annonce passée en brouillon');
    } catch (ex) { e.target.checked = !e.target.checked; toast(ex.message, true); }
  });
  $('#rows').addEventListener('click', e => { const b = e.target.closest('[data-del]'); if (b) deleteListing(b.dataset.del); });
  async function deleteListing(id, after) {
    const l = listings.find(x => x.id === id);
    if (!confirm(`Supprimer définitivement l'annonce « ${l.title} » (${l.ref}) ?\nCette action est irréversible.`)) return;
    try {
      await api(`/api/admin/listings/${id}`, { method: 'DELETE' });
      listings = listings.filter(x => x.id !== id);
      toast('Annonce supprimée'); dirty = false;
      after ? after() : renderRows();
    } catch (ex) { toast(ex.message, true); }
  }
  $('#delete-demo').addEventListener('click', async () => {
    const demos = listings.filter(l => l.demo);
    if (!confirm(`Supprimer les ${demos.length} annonces de démonstration ? Vos propres annonces ne seront pas touchées.`)) return;
    for (const l of demos) { try { await api(`/api/admin/listings/${l.id}`, { method: 'DELETE' }); } catch {} }
    await loadListings(); renderRows(); toast('Annonces de démonstration supprimées');
  });
  $('#new-listing').addEventListener('click', () => { location.hash = 'edit/new'; });

  /* ---------- Éditeur ---------- */
  const form = $('#edit-form');
  function openEditor(id) {
    editing = id === 'new' ? null : listings.find(l => l.id === id);
    if (id !== 'new' && !editing) { location.hash = 'annonces'; return; }
    form.reset();
    const base = { transaction: 'vente', type: 'appartement', status: 'disponible', city: 'Hammam Sousse', published: true, photos: [], features: [] };
    const l = editing || (prefill ? { ...base, ...prefill } : base);
    if (editing) prefill = null;
    for (const el of form.elements) {
      if (!el.name || !(el.name in l)) continue;
      if (el.type === 'checkbox') el.checked = !!l[el.name];
      else if (el.name === 'features') el.value = (l.features || []).join('\n');
      else el.value = l[el.name] === 0 && ['price', 'surface', 'landSurface'].includes(el.name) ? '' : (l[el.name] ?? '');
    }
    photos = [...(l.photos || [])];
    renderPhotos();
    $('#edit-title').textContent = editing ? editing.title : prefill ? 'Nouvelle annonce (bien proposé)' : 'Nouvelle annonce';
    $('#e-ref').textContent = editing ? `Référence : ${editing.ref} · modifiée le ${new Date(editing.updatedAt).toLocaleDateString('fr-FR')}` : 'La référence est attribuée automatiquement à l\'enregistrement.';
    $('#delete-listing').hidden = !editing;
    $('#edit-view').hidden = !(editing && editing.published);
    if (editing) $('#edit-view').href = `/bien/${encodeURIComponent(editing.ref)}`;
    updatePriceLabel();
    show('edit');
    dirty = false;
  }
  function updatePriceLabel() { $('#e-price-label').textContent = form.transaction.value === 'location' ? 'Loyer mensuel (TND)' : 'Prix de vente (TND)'; }
  form.transaction.addEventListener('change', updatePriceLabel);
  form.addEventListener('input', () => { dirty = true; });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!form.title.value.trim()) { form.title.focus(); toast('Le titre est obligatoire.', true); return; }
    const data = {};
    for (const el of form.elements) {
      if (!el.name) continue;
      data[el.name] = el.type === 'checkbox' ? el.checked : el.value;
    }
    data.features = form.features.value.split('\n').map(s => s.trim()).filter(Boolean);
    data.photos = photos;
    const fromMessage = !editing && prefill && prefill._fromMessage;
    const btns = $$('[form="edit-form"]'); btns.forEach(b => { b.disabled = true; });
    try {
      const saved = editing
        ? await api(`/api/admin/listings/${editing.id}`, { method: 'PUT', json: data })
        : await api('/api/admin/listings', { method: 'POST', json: data });
      const i = listings.findIndex(x => x.id === saved.id);
      if (i >= 0) listings[i] = saved; else listings.unshift(saved);
      dirty = false;
      toast(editing ? 'Annonce enregistrée' : `Annonce créée — réf. ${saved.ref}`);
      if (fromMessage) {
        prefill = null;
        const m = messages.find(x => x.id === fromMessage);
        if (m) updateMessage(m.id, { status: 'traite', note: [m.note, `Annonce créée : ${saved.ref}`].filter(Boolean).join('\n') }).catch(() => {});
      }
      if (!editing) { history.replaceState(null, '', `#edit/${saved.id}`); }
      openEditor(saved.id);
    } catch (ex) { toast(ex.message, true); }
    finally { btns.forEach(b => { b.disabled = false; }); }
  });
  $('#delete-listing').addEventListener('click', () => deleteListing(editing.id, () => { location.hash = 'annonces'; }));

  /* ---------- Photos ---------- */
  function renderPhotos() {
    $('#photos').innerHTML = photos.map((p, i) => `
      <div class="photo">
        ${i === 0 ? '<span class="badge badge--dark photo__cover">Principale</span>' : ''}
        <img src="${esc(p)}" alt="Photo ${i + 1}">
        <div class="photo__bar">
          <span style="display:flex;gap:4px">
            <button type="button" data-move="${i}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="Déplacer à gauche"><svg><use href="#a-left"/></svg></button>
            <button type="button" data-move="${i}" data-dir="1" ${i === photos.length - 1 ? 'disabled' : ''} aria-label="Déplacer à droite"><svg><use href="#a-right"/></svg></button>
          </span>
          <button type="button" data-remove="${i}" aria-label="Retirer la photo"><svg><use href="#a-close"/></svg></button>
        </div>
      </div>`).join('');
  }
  $('#photos').addEventListener('click', e => {
    const m = e.target.closest('[data-move]'); const r = e.target.closest('[data-remove]');
    if (m) { const i = +m.dataset.move; const j = i + +m.dataset.dir; [photos[i], photos[j]] = [photos[j], photos[i]]; }
    else if (r) { photos.splice(+r.dataset.remove, 1); }
    else return;
    dirty = true; renderPhotos();
  });

  // Redimensionne côté navigateur (max 1920 px) avant envoi : pages plus rapides
  // + une vignette 800×600 recadrée pour les cartes d'annonces
  function optimise(file) {
    return new Promise(resolve => {
      if (!/image\/(jpeg|png|webp)/.test(file.type)) return resolve(null);
      const img = new Image(); const url = URL.createObjectURL(file);
      // WebP (plus léger) ; JPEG si le navigateur ne sait pas encoder le WebP (anciens Safari)
      const toJpeg = (c, q) => new Promise(r => c.toBlob(b => {
        if (b && b.type === 'image/webp') return r(b);
        c.toBlob(r, 'image/jpeg', q);
      }, 'image/webp', q));
      img.onload = async () => {
        const max = 1920; const ratio = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.round(img.width * ratio); c.height = Math.round(img.height * ratio);
        const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
        const t = document.createElement('canvas'); t.width = 800; t.height = 600;
        const s = Math.max(800 / img.width, 600 / img.height); const w = 800 / s; const h = 600 / s;
        const tc = t.getContext('2d'); tc.fillStyle = '#fff'; tc.fillRect(0, 0, 800, 600);
        tc.drawImage(img, (img.width - w) / 2, (img.height - h) / 2, w, h, 0, 0, 800, 600);
        URL.revokeObjectURL(url);
        resolve({ full: await toJpeg(c, 0.84), small: await toJpeg(t, 0.78) });
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve({ full: file }); };
      img.src = url;
    });
  }
  async function upload(files) {
    const list = Array.from(files).slice(0, 30 - photos.length);
    const status = $('#upload-status');
    for (let i = 0; i < list.length; i++) {
      status.textContent = `Envoi de la photo ${i + 1} sur ${list.length}…`;
      try {
        const out = await optimise(list[i]);
        if (!out) { toast(`${list[i].name} : format non pris en charge`, true); continue; }
        const res = await api('/api/admin/upload', { method: 'POST', body: out.full, headers: { 'Content-Type': out.full.type || list[i].type } });
        if (out.small) {
          await api('/api/admin/upload', { method: 'POST', body: out.small, headers: { 'Content-Type': out.small.type, 'X-Thumb-For': res.url.split('/').pop() } }).catch(() => {});
        }
        photos.push(res.url); dirty = true; renderPhotos();
      } catch (ex) { toast(`${list[i].name} : ${ex.message}`, true); }
    }
    status.textContent = list.length ? 'Photos ajoutées. Pensez à enregistrer l\'annonce.' : '';
    $('#photo-input').value = '';
  }
  $('#photo-input').addEventListener('change', e => upload(e.target.files));
  const dz = $('#dropzone');
  ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('is-over'); }));
  dz.addEventListener('drop', e => upload(e.dataTransfer.files));

  /* ---------- Demandes ---------- */
  const KIND = { contact: 'Contact', visite: 'Demande de visite', depot: 'Bien proposé' };
  const MSTATUS = { nouveau: ['Nouvelle', 'tag--new'], 'en-cours': ['En cours', 'tag--warn'], traite: ['Traitée', 'tag--ok'], archive: ['Archivée', 'tag--off'] };
  const TABS = [['actives', 'À traiter'], ['nouveau', 'Nouvelles'], ['en-cours', 'En cours'], ['traite', 'Traitées'], ['archive', 'Archivées'], ['toutes', 'Toutes']];
  const kindOf = m => m.kind === 'depot' ? 'depot' : m.ref ? 'visite' : 'contact';
  const statusOf = m => m.status || (m.read ? 'en-cours' : 'nouveau');
  const inTab = (m, tab) => tab === 'toutes' || (tab === 'actives' ? ['nouveau', 'en-cours'].includes(statusOf(m)) : statusOf(m) === tab);
  let inboxTab = 'actives';
  let selectedId = null;
  let lastNewIds = null;

  function waNumber(phone) {
    let d = String(phone || '').replace(/\D/g, '').replace(/^00/, '');
    if (d.length === 8) d = '216' + d;
    return d;
  }
  function waReply(m) {
    const first = (m.name || '').split(/\s+/)[0];
    const about = m.ref ? ` concernant le bien réf. ${m.ref}` : m.kind === 'depot' ? ' concernant votre bien' : '';
    return `https://wa.me/${waNumber(m.phone)}?text=${encodeURIComponent(`Bonjour ${first}, ici BILI IMMOBILIÈRE. Nous avons bien reçu votre demande${about}. `)}`;
  }
  function ago(iso) {
    const s = (Date.now() - new Date(iso)) / 1000;
    if (s < 60) return 'à l\'instant';
    if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
    if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
    if (s < 86400 * 7) return `il y a ${Math.floor(s / 86400)} j`;
    return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  }
  const statusTag = m => `<span class="tag ${MSTATUS[statusOf(m)][1]}">${MSTATUS[statusOf(m)][0]}</span>`;

  async function loadMessages(silent) {
    messages = await api('/api/admin/messages');
    const fresh = messages.filter(m => statusOf(m) === 'nouveau').map(m => m.id);
    if (silent && lastNewIds && fresh.some(id => !lastNewIds.includes(id))) toast('Nouvelle demande reçue');
    lastNewIds = fresh;
    updateUnread();
  }
  function updateUnread() {
    const n = messages.filter(m => statusOf(m) === 'nouveau').length;
    $('#unread').hidden = !n; $('#unread').textContent = n;
    document.title = `${n ? `(${n}) ` : ''}Backstage | BILI IMMOBILIÈRE`;
  }
  // Vérifie régulièrement l'arrivée de nouvelles demandes
  setInterval(async () => {
    if (!csrf || document.hidden) return;
    try {
      await loadMessages(true);
      const view = $$('[data-view]').find(s => !s.hidden);
      if (view && view.dataset.view === 'tableau') renderDashboard();
      if (view && view.dataset.view === 'demandes') renderInbox(document.activeElement && document.activeElement.id === 'm-note');
    } catch {}
  }, 45000);

  function renderInbox(keepDetail) {
    $('#inbox-tabs').innerHTML = TABS.map(([k, label]) => {
      const n = messages.filter(m => inTab(m, k)).length;
      return `<button type="button" role="tab" data-itab="${k}" aria-selected="${k === inboxTab}">${label}<span>${n}</span></button>`;
    }).join('');
    const q = $('#m-q').value.trim().toLowerCase(); const kind = $('#m-kind').value;
    const list = messages.filter(m => inTab(m, inboxTab) && (!kind || kindOf(m) === kind) &&
      (!q || [m.name, m.phone, m.email, m.ref, m.subject, m.message, m.note].join(' ').toLowerCase().includes(q)));
    $('#inbox-list').innerHTML = list.length ? list.map(m => `
      <button type="button" class="mrow ${statusOf(m) === 'nouveau' ? 'is-new' : ''} ${m.id === selectedId ? 'is-active' : ''}" data-mid="${m.id}">
        <span class="mrow__top"><strong>${esc(m.name)}</strong><time>${ago(m.createdAt)}</time></span>
        <span class="mrow__kind">${KIND[kindOf(m)]}${m.ref ? ` · ${esc(m.ref)}` : ''}</span>
        <span class="mrow__text">${esc(m.message || m.subject || '—')}</span>
        <span class="mrow__tags">${statusTag(m)}${m.note ? '<span class="tag">Note</span>' : ''}</span>
      </button>`).join('') : '<div class="inbox__empty">Aucune demande dans cette catégorie.</div>';
    if (!keepDetail) renderDetail();
    $('#inbox').classList.toggle('has-detail', !!selectedId);
  }

  function renderDetail() {
    const m = messages.find(x => x.id === selectedId);
    const box = $('#inbox-detail');
    if (!m) { box.innerHTML = '<div class="inbox__placeholder"><svg><use href="#a-mail"/></svg><p>Sélectionnez une demande pour l\'afficher.</p></div>'; return; }
    const l = m.ref ? listings.find(x => x.ref === m.ref) : null;
    const details = m.details ? Object.entries(m.details).filter(([, v]) => v) : [];
    box.innerHTML = `
      <button type="button" class="back inbox__back" data-close>← Toutes les demandes</button>
      <header class="detail__head">
        <div>
          <span class="detail__kind">${KIND[kindOf(m)]}</span>
          <h2>${esc(m.name)}</h2>
          <p class="muted small">Reçue le ${new Date(m.createdAt).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' })}${m.updatedAt ? ` · mise à jour ${ago(m.updatedAt)}` : ''}</p>
        </div>
        ${statusTag(m)}
      </header>
      <div class="detail__contact">
        ${m.phone ? `<a class="btn btn--ghost btn--sm" href="tel:${esc(m.phone)}"><svg><use href="#a-phone"/></svg>${esc(m.phone)}</a>
        <a class="btn btn--whatsapp btn--sm" href="${esc(waReply(m))}" target="_blank" rel="noopener"><svg><use href="#a-wa"/></svg>Répondre sur WhatsApp</a>` : ''}
        ${m.email ? `<a class="btn btn--ghost btn--sm" href="mailto:${esc(m.email)}?subject=${encodeURIComponent('BILI IMMOBILIÈRE — votre demande')}"><svg><use href="#a-at"/></svg>${esc(m.email)}</a>` : ''}
      </div>
      ${l ? `<a class="detail__listing" href="#edit/${l.id}"><img src="${esc(l.photos[0] || '/img/placeholder.svg')}" alt=""><span><strong>${esc(l.title)}</strong><small>${esc(l.ref)} · ${esc(priceLabel(l))}</small></span><svg><use href="#a-edit"/></svg></a>`
        : m.ref ? `<p class="muted small">Bien réf. ${esc(m.ref)} (annonce supprimée ou introuvable).</p>` : ''}
      ${m.subject ? `<p class="detail__subject">${esc(m.subject)}</p>` : ''}
      ${details.length ? `<dl class="detail__specs">${details.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : ''}
      ${m.message ? `<div class="detail__msg">${esc(m.message)}</div>` : ''}
      ${m.kind === 'depot' ? `<div class="detail__convert"><p><strong>Bien proposé par un propriétaire.</strong> Créez un brouillon d'annonce pré-rempli avec ces informations, puis ajoutez les photos.</p><button class="btn btn--sm" type="button" data-convert><svg><use href="#a-plus"/></svg>Créer l'annonce</button></div>` : ''}
      <div class="detail__block">
        <span class="label">Suivi</span>
        <div class="seg-status" role="group" aria-label="Statut de la demande">
          ${Object.entries(MSTATUS).map(([k, [label]]) => `<button type="button" data-setstatus="${k}" aria-pressed="${statusOf(m) === k}">${label}</button>`).join('')}
        </div>
      </div>
      <div class="detail__block">
        <label class="label" for="m-note">Note interne</label>
        <textarea class="textarea" id="m-note" rows="3" placeholder="Rappelé le…, visite prévue le…, budget confirmé…">${esc(m.note || '')}</textarea>
        <div class="detail__foot">
          <button class="btn btn--sm" type="button" data-savenote>Enregistrer la note</button>
          <button class="btn btn--ghost btn--sm danger" type="button" data-mdel>Supprimer</button>
        </div>
      </div>`;
  }

  async function updateMessage(id, data, msg) {
    const saved = await api(`/api/admin/messages/${id}`, { method: 'PUT', json: data });
    Object.assign(messages.find(m => m.id === id), saved);
    updateUnread();
    if (msg) toast(msg);
    return saved;
  }
  async function openMessage(id) {
    selectedId = id;
    const m = messages.find(x => x.id === id);
    if (m && statusOf(m) === 'nouveau') { try { await updateMessage(id, { status: 'en-cours' }); } catch {} }
    renderInbox();
    if (window.matchMedia('(max-width: 900px)').matches) window.scrollTo(0, 0);
  }

  $('#inbox-tabs').addEventListener('click', e => {
    const b = e.target.closest('[data-itab]'); if (!b) return;
    inboxTab = b.dataset.itab; renderInbox(true);
  });
  ['#m-q', '#m-kind'].forEach(s => $(s).addEventListener('input', () => renderInbox(true)));
  $('#inbox-list').addEventListener('click', e => {
    const b = e.target.closest('[data-mid]'); if (b) history.replaceState(null, '', `#demandes/${b.dataset.mid}`), openMessage(b.dataset.mid);
  });
  $('#inbox-detail').addEventListener('click', async e => {
    const m = messages.find(x => x.id === selectedId); if (!m) return;
    try {
      if (e.target.closest('[data-close]')) { selectedId = null; history.replaceState(null, '', '#demandes'); renderInbox(); }
      else if (e.target.closest('[data-setstatus]')) {
        const st = e.target.closest('[data-setstatus]').dataset.setstatus;
        await updateMessage(m.id, { status: st }, `Demande marquée « ${MSTATUS[st][0]} »`); renderInbox();
      } else if (e.target.closest('[data-savenote]')) {
        await updateMessage(m.id, { note: $('#m-note').value }, 'Note enregistrée'); renderInbox(true);
      } else if (e.target.closest('[data-mdel]')) {
        if (!confirm(`Supprimer définitivement la demande de ${m.name} ?\nCette action est irréversible.`)) return;
        await api(`/api/admin/messages/${m.id}`, { method: 'DELETE' });
        messages = messages.filter(x => x.id !== m.id); selectedId = null; updateUnread();
        history.replaceState(null, '', '#demandes'); renderInbox(); toast('Demande supprimée');
      } else if (e.target.closest('[data-convert]')) {
        prefill = listingFromDepot(m); location.hash = 'edit/new';
      }
    } catch (ex) { toast(ex.message, true); }
  });

  // Transforme un « bien proposé » en brouillon d'annonce
  const CITIES = ['Hammam Sousse', 'Sousse', 'Chott Meriem', 'Akouda', 'Kalâa Kebira', 'Msaken', 'Monastir'];
  const toNum = v => { const n = parseInt(String(v || '').replace(/[^\d]/g, ''), 10); return Number.isFinite(n) ? n : ''; };
  function listingFromDepot(m) {
    const d = m.details || {};
    const type = Object.keys(TYPE).find(k => TYPE[k] === d.Type) || 'appartement';
    const parts = String(d.Localisation || '').split(',').map(s => s.trim()).filter(Boolean);
    const city = parts.find(p => CITIES.some(c => c.toLowerCase() === p.toLowerCase())) || '';
    const district = parts.filter(p => p !== city).join(', ');
    const rooms = toNum(d.Chambres);
    const title = `${TYPE[type]}${rooms && ['appartement', 'maison', 'villa'].includes(type) ? ` S+${rooms}` : ''}${district || city ? ` à ${district || city}` : ''}`;
    return {
      title, type, transaction: /louer/i.test(d.Transaction || '') ? 'location' : 'vente', status: 'disponible',
      city: city || 'Hammam Sousse', district, surface: toNum(d.Surface), bedrooms: rooms, price: toNum(d['Prix souhaité']),
      description: m.message || '', published: false,
      notes: `Propriétaire : ${m.name}${m.phone ? ` — ${m.phone}` : ''}${m.email ? ` — ${m.email}` : ''}\nProposé via le site le ${new Date(m.createdAt).toLocaleDateString('fr-FR')}.`,
      _fromMessage: m.id,
    };
  }

  // Export CSV (séparateur « ; » pour Excel en français)
  $('#export-csv').addEventListener('click', () => {
    const cell = v => `"${String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
    const head = ['Date', 'Statut', 'Type', 'Nom', 'Téléphone', 'E-mail', 'Référence', 'Objet', 'Message', 'Détails', 'Note interne'];
    const rows = messages.map(m => [new Date(m.createdAt).toLocaleString('fr-FR'), MSTATUS[statusOf(m)][0], KIND[kindOf(m)], m.name, m.phone, m.email, m.ref, m.subject, m.message,
      m.details ? Object.entries(m.details).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(' | ') : '', m.note]);
    const csv = '﻿' + [head, ...rows].map(r => r.map(cell).join(';')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `demandes-bili-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  /* ---------- Tableau de bord ---------- */
  function renderDashboard() {
    $('#today').textContent = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const count = s => messages.filter(m => statusOf(m) === s).length;
    const month = messages.filter(m => Date.now() - new Date(m.createdAt) < 30 * 864e5).length;
    const online = listings.filter(l => l.published).length;
    const kpi = (n, label, href, accent) => `<a class="kpi${accent ? ' kpi--accent' : ''}" href="${href}"><strong>${n}</strong><span>${label}</span></a>`;
    $('#kpis').innerHTML = [
      kpi(count('nouveau'), 'Nouvelles demandes', '#demandes', count('nouveau') > 0),
      kpi(count('en-cours'), 'Demandes en cours', '#demandes'),
      kpi(month, 'Demandes sur 30 jours', '#demandes'),
      kpi(online, 'Annonces en ligne', '#annonces'),
      kpi(listings.length - online, 'Brouillons', '#annonces'),
    ].join('');
    const recent = messages.filter(m => statusOf(m) !== 'archive').slice(0, 6);
    $('#dash-msgs').innerHTML = recent.length ? recent.map(m => `
      <a class="dash-row" href="#demandes/${m.id}">
        <span><strong>${esc(m.name)}</strong><small>${KIND[kindOf(m)]}${m.ref ? ` · ${esc(m.ref)}` : ''} · ${ago(m.createdAt)}</small></span>
        ${statusTag(m)}
      </a>`).join('') : '<p class="muted small">Aucune demande pour le moment. Les messages envoyés depuis le site apparaîtront ici.</p>';
    const byRef = {};
    messages.forEach(m => { if (m.ref) byRef[m.ref] = (byRef[m.ref] || 0) + 1; });
    const top = Object.entries(byRef).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([ref, n]) => [listings.find(l => l.ref === ref), ref, n]);
    $('#dash-top').innerHTML = top.length ? top.map(([l, ref, n]) => `
      <a class="dash-row" href="${l ? `#edit/${l.id}` : '#demandes'}">
        ${l ? `<img src="${esc(l.photos[0] || '/img/placeholder.svg')}" alt="">` : ''}
        <span><strong>${esc(l ? l.title : ref)}</strong><small>${esc(ref)}${l ? ` · ${esc(priceLabel(l))}` : ''}</small></span>
        <span class="tag">${n} demande${n > 1 ? 's' : ''}</span>
      </a>`).join('') : '<p class="muted small">Aucune demande de visite pour l\'instant.</p>';
  }

  /* ---------- Mot de passe ---------- */
  $('#pw-form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target; const st = $('#pw-status');
    st.hidden = false;
    if (f.next.value !== f.next2.value) { st.className = 'form-status form-status--err'; st.textContent = 'Les deux mots de passe ne correspondent pas.'; return; }
    try {
      await api('/api/admin/password', { method: 'POST', json: { current: f.current.value, next: f.next.value } });
      f.reset(); st.className = 'form-status form-status--ok'; st.textContent = 'Mot de passe mis à jour. Vous pouvez supprimer le fichier data/ADMIN-MOT-DE-PASSE-INITIAL.txt.';
    } catch (ex) { st.className = 'form-status form-status--err'; st.textContent = ex.message; }
  });

  boot();
})();
