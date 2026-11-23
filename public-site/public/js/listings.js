/* Catalogue : filtres, tri et synchronisation avec l'URL */
document.addEventListener('DOMContentLoaded', () => {
  const { getListings, cardHTML, matchLoc, observeReveal, fmt, TYPE_LABEL, esc } = window.BILI;
  const form = document.getElementById('filter-form');
  const results = document.getElementById('results');
  const countEl = document.getElementById('count');
  const chips = document.getElementById('chips');
  const sortEl = document.getElementById('sort');
  const filtersEl = document.getElementById('filters');
  const preset = document.body.dataset.preset || '';
  let all = [];

  /* ---- État <-> URL ---- */
  function readUrl() {
    const p = new URLSearchParams(location.search);
    const tx = p.get('transaction') ?? preset;
    const txInput = form.querySelector(`[name="transaction"][value="${CSS.escape(tx || '')}"]`);
    if (txInput) txInput.checked = true;
    const types = p.getAll('type').flatMap(t => t.split(','));
    form.querySelectorAll('[name="type"]').forEach(c => { c.checked = types.includes(c.value); });
    form.loc.value = p.get('loc') || '';
    if (form.loc.value !== (p.get('loc') || '') && p.get('loc')) { // localisation libre non listée
      const o = new Option(p.get('loc'), p.get('loc'), true, true); form.loc.add(o);
    }
    form.min.value = p.get('min') || '';
    form.max.value = p.get('max') || '';
    form.smin.value = p.get('smin') || '';
    form.smax.value = p.get('smax') || '';
    const ch = form.querySelector(`[name="ch"][value="${CSS.escape(p.get('ch') || '')}"]`);
    if (ch) ch.checked = true;
    sortEl.value = p.get('tri') || 'recent';
  }
  function state() {
    const fd = new FormData(form);
    return {
      transaction: fd.get('transaction') || '',
      types: fd.getAll('type'),
      loc: fd.get('loc') || '',
      min: +fd.get('min') || 0, max: +fd.get('max') || 0,
      smin: +fd.get('smin') || 0, smax: +fd.get('smax') || 0,
      ch: +fd.get('ch') || 0,
      sort: sortEl.value,
    };
  }
  function writeUrl(s) {
    // La transaction est portée par le chemin (/acheter, /louer, /annonces)
    const p = new URLSearchParams();
    if (s.types.length) p.set('type', s.types.join(','));
    if (s.loc) p.set('loc', s.loc);
    ['min', 'max', 'smin', 'smax', 'ch'].forEach(k => { if (s[k]) p.set(k, s[k]); });
    if (s.sort !== 'recent') p.set('tri', s.sort);
    const base = { vente: '/acheter', location: '/louer' }[s.transaction] || '/annonces';
    const qs = p.toString();
    history.replaceState(null, '', base + (qs ? '?' + qs : ''));
  }

  /* ---- Filtrage ---- */
  const surfaceOf = l => l.surface || l.landSurface || 0;
  function filter(s, ignore) {
    return all.filter(l =>
      (!s.transaction || l.transaction === s.transaction) &&
      (ignore === 'types' || !s.types.length || s.types.includes(l.type)) &&
      matchLoc(l, s.loc) &&
      (!s.min || (l.price && l.price >= s.min)) &&
      (!s.max || (l.price && l.price <= s.max)) &&
      (!s.smin || surfaceOf(l) >= s.smin) &&
      (!s.smax || (surfaceOf(l) && surfaceOf(l) <= s.smax)) &&
      (!s.ch || l.bedrooms >= s.ch));
  }
  const unavailable = l => l.status === 'vendu' || l.status === 'loue';
  function sort(list, how) {
    const by = {
      'recent': (a, b) => (unavailable(a) - unavailable(b)) || String(b.createdAt).localeCompare(String(a.createdAt)),
      'price-asc': (a, b) => (a.price || Infinity) - (b.price || Infinity),
      'price-desc': (a, b) => (b.price || 0) - (a.price || 0),
      'surface-desc': (a, b) => surfaceOf(b) - surfaceOf(a),
    }[how];
    return list.slice().sort(by);
  }

  /* ---- Rendu ---- */
  function render() {
    const s = state();
    writeUrl(s);
    const list = sort(filter(s), s.sort);

    // Titre selon la transaction
    const t = { vente: ['Biens à vendre à Sousse et environs', 'Acheter'], location: ['Biens à louer à Sousse et environs', 'Louer'], '': ['Nos biens à vendre et à louer', 'Annonces'] }[s.transaction];
    document.getElementById('page-title').textContent = t[0];
    document.getElementById('crumb').textContent = t[1];
    document.title = `${t[0]} | BILI IMMOBILIÈRE`;
    document.querySelectorAll('.nav a[data-nav], .rail a[data-nav]').forEach(a => {
      const on = (a.dataset.nav === 'acheter' && s.transaction === 'vente') || (a.dataset.nav === 'louer' && s.transaction === 'location');
      on ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current');
    });

    // Compteurs par type (en tenant compte des autres filtres)
    const base = filter(s, 'types');
    document.querySelectorAll('[data-tc]').forEach(el => { el.textContent = base.filter(l => l.type === el.dataset.tc).length; });

    countEl.innerHTML = `<strong>${list.length}</strong> ${list.length > 1 ? 'biens correspondent' : 'bien correspond'} à votre recherche`;
    document.getElementById('show-results').textContent = `Voir ${list.length} bien${list.length > 1 ? 's' : ''}`;

    results.innerHTML = list.length ? list.map(l => cardHTML(l, { reveal: false })).join('') : `
      <div class="empty" style="grid-column:1/-1">
        <h3>Aucun bien ne correspond pour le moment</h3>
        <p>Élargissez vos critères ou confiez-nous votre recherche : nous vous contacterons dès qu'un bien correspondant sera disponible.</p>
        <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
          <button class="btn btn--ghost" type="button" id="empty-reset">Réinitialiser les filtres</button>
          <a class="btn btn--whatsapp" target="_blank" rel="noopener" href="${window.BILI.waLink('Bonjour BILI IMMOBILIÈRE, je recherche un bien : ')}"><svg aria-hidden="true"><use href="#i-whatsapp"/></svg>Confier ma recherche</a>
        </div>
      </div>`;
    document.getElementById('empty-reset')?.addEventListener('click', () => { form.reset(); render(); });
    observeReveal(results);
    renderChips(s);
  }

  function renderChips(s) {
    const c = [];
    if (s.transaction) c.push(['transaction', s.transaction === 'vente' ? 'Vente' : 'Location']);
    s.types.forEach(t => c.push(['type:' + t, TYPE_LABEL[t]]));
    if (s.loc) c.push(['loc', s.loc]);
    if (s.min) c.push(['min', `Dès ${fmt(s.min)} TND`]);
    if (s.max) c.push(['max', `Jusqu'à ${fmt(s.max)} TND`]);
    if (s.smin) c.push(['smin', `≥ ${fmt(s.smin)} m²`]);
    if (s.smax) c.push(['smax', `≤ ${fmt(s.smax)} m²`]);
    if (s.ch) c.push(['ch', `${s.ch}+ chambres`]);
    chips.innerHTML = c.map(([k, label]) => `<span class="chip">${esc(label)}<button type="button" data-chip="${esc(k)}" aria-label="Retirer le filtre ${esc(label)}"><svg><use href="#i-close"/></svg></button></span>`).join('');
  }
  chips.addEventListener('click', e => {
    const b = e.target.closest('[data-chip]'); if (!b) return;
    const k = b.dataset.chip;
    if (k === 'transaction') form.querySelector('#tx-all').checked = true;
    else if (k.startsWith('type:')) form.querySelector(`[name="type"][value="${k.slice(5)}"]`).checked = false;
    else if (k === 'ch') form.querySelector('#ch-0').checked = true;
    else form[k].value = '';
    render();
  });

  let t;
  form.addEventListener('input', () => { clearTimeout(t); t = setTimeout(render, 180); });
  form.addEventListener('change', render);
  form.addEventListener('reset', () => setTimeout(render));
  sortEl.addEventListener('change', render);

  /* ---- Panneau de filtres mobile ---- */
  const openBtn = document.getElementById('open-filters');
  openBtn.addEventListener('click', () => { filtersEl.classList.add('is-open'); document.body.style.overflow = 'hidden'; });
  document.querySelectorAll('[data-close-filters]').forEach(b => b.addEventListener('click', () => {
    filtersEl.classList.remove('is-open'); document.body.style.overflow = ''; window.scrollTo({ top: 0, behavior: 'smooth' });
  }));

  readUrl();
  getListings().then(list => { all = list; render(); }).catch(() => {
    results.innerHTML = '<div class="empty" style="grid-column:1/-1"><h3>Impossible de charger les annonces</h3><p>Merci de réessayer dans un instant ou de nous appeler au +216 51 294 295.</p></div>';
  });
});
