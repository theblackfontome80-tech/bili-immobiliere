/* BILI IMMOBILIÈRE — scripts communs */
(function () {
  'use strict';

  const AGENCY = {
    name: 'BILI IMMOBILIÈRE',
    phone: '+21651294295',
    phoneDisplay: '+216 51 294 295',
    whatsapp: '21651294295',
  };

  const TYPE_LABEL = { appartement: 'Appartement', villa: 'Villa', maison: 'Maison', terrain: 'Terrain', studio: 'Studio', local: 'Local commercial' };
  const TYPE_PLURAL = { appartement: 'Appartements', villa: 'Villas', maison: 'Maisons', terrain: 'Terrains', studio: 'Studios', local: 'Locaux commerciaux' };
  const STATUS_LABEL = { 'sous-offre': 'Sous offre', vendu: 'Vendu', loue: 'Loué' };

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = new Intl.NumberFormat('fr-FR');
  const fmt = n => nf.format(n);

  function priceHTML(l) {
    if (l.priceOnRequest || !l.price) return 'Prix sur demande';
    return `${fmt(l.price)} <small>TND${l.transaction === 'location' ? ' / mois' : ''}</small>`;
  }
  function priceText(l) {
    if (l.priceOnRequest || !l.price) return 'Prix sur demande';
    return `${fmt(l.price)} TND${l.transaction === 'location' ? ' / mois' : ''}`;
  }
  function waLink(text) {
    return `https://wa.me/${AGENCY.whatsapp}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
  }
  function listingUrl(l) { return `/bien/${encodeURIComponent(l.ref)}`; }
  function waListingText(l) {
    return `Bonjour BILI IMMOBILIÈRE, je suis intéressé(e) par le bien « ${l.title} » (réf. ${l.ref}). Pouvez-vous me donner plus d'informations ? ${location.origin}${listingUrl(l)}`;
  }

  function badgesHTML(l) {
    const b = [];
    if (STATUS_LABEL[l.status]) b.push(`<span class="badge badge--status">${STATUS_LABEL[l.status]}</span>`);
    b.push(`<span class="badge badge--dark">${l.transaction === 'vente' ? 'À vendre' : 'À louer'}</span>`);
    if (l.exclusive) b.push('<span class="badge badge--accent">Exclusivité</span>');
    if (l.isNew) b.push('<span class="badge">Nouveau</span>');
    return b.join('');
  }

  function factsHTML(l) {
    const f = [];
    if (l.surface) f.push(`<span class="fact" title="Surface"><svg aria-hidden="true"><use href="#i-area"/></svg>${fmt(l.surface)} m²</span>`);
    else if (l.landSurface) f.push(`<span class="fact" title="Terrain"><svg aria-hidden="true"><use href="#i-area"/></svg>${fmt(l.landSurface)} m²</span>`);
    if (l.bedrooms) f.push(`<span class="fact" title="Chambres"><svg aria-hidden="true"><use href="#i-bed"/></svg>${l.bedrooms} ch.</span>`);
    if (l.bathrooms) f.push(`<span class="fact" title="Salles de bain"><svg aria-hidden="true"><use href="#i-bath"/></svg>${l.bathrooms} sdb</span>`);
    return f.join('');
  }

  /* Vignette 800 px (WebP) : /img/sm/… pour les photos fournies, /uploads/…-sm.webp pour les photos importées */
  function thumb(p) {
    if (/^\/img\/p\d+\.(webp|jpg)$/.test(p)) return p.replace('/img/', '/img/sm/');
    if (/^\/uploads\/[\w-]+\.(jpg|png|webp)$/.test(p)) return p.replace(/\.(jpg|png|webp)$/, '-sm.webp');
    return p;
  }

  function cardHTML(l, opts = {}) {
    const img = l.photos && l.photos[0] ? l.photos[0] : '/img/placeholder.svg';
    const surface = l.surface || l.landSurface;
    const rooms = [l.bedrooms ? `${l.bedrooms} ch.` : '', l.bathrooms ? `${l.bathrooms} sdb` : ''].filter(Boolean).join(' · ');
    return `
    <article class="card${opts.reveal === false ? '' : ' reveal'}">
      <a class="card__link" href="${listingUrl(l)}">
        <div class="card__media">
          <img src="${esc(thumb(img))}" data-full="${esc(img)}" onerror="if(this.src.indexOf(this.dataset.full)<0)this.src=this.dataset.full" alt="${esc(l.title)}" loading="lazy" decoding="async" width="800" height="600">
          <div class="card__top"><div class="card__badges">${badgesHTML(l)}</div><span class="card__ref">Réf. ${esc(l.ref)}</span></div>
          <div class="card__bottom">
            <span class="card__place">${esc(l.district || l.city)}</span>
            ${l.photos && l.photos.length > 1 ? `<span class="card__count"><svg aria-hidden="true"><use href="#i-camera"/></svg>${l.photos.length}</span>` : ''}
          </div>
        </div>
        <div class="card__body">
          <div class="card__meta"><span>${esc(TYPE_LABEL[l.type] || l.type)} · ${l.transaction === 'vente' ? 'Vente' : 'Location'}</span><span>${esc(l.city)}</span></div>
          <h3 class="card__title"><span>${esc(l.title)}</span></h3>
          <dl class="card__facts">
            <div><dt>Prix</dt><dd class="card__price">${priceText(l)}</dd></div>
            <div><dt>Surface</dt><dd>${surface ? `${fmt(surface)} m²` : '—'}</dd></div>
            <div><dt>Pièces</dt><dd>${rooms || '—'}</dd></div>
          </dl>
          ${l.demo ? '<span class="demo-tag card__demo">Annonce de démonstration</span>' : ''}
        </div>
      </a>
    </article>`;
  }

  /* Localisation : une ville correspond exactement (« Sousse » ≠ « Hammam Sousse »),
     un quartier correspond par inclusion (« Khezama » → « Khezama Est »). */
  const CITIES = ['Hammam Sousse', 'Sousse', 'Chott Meriem', 'Akouda', 'Kalâa Kebira', 'Msaken', 'Monastir'];
  function matchLoc(l, loc) {
    if (!loc) return true;
    const q = loc.toLowerCase();
    if (CITIES.some(c => c.toLowerCase() === q)) return (l.city || '').toLowerCase() === q;
    return `${l.city} ${l.district}`.toLowerCase().includes(q);
  }

  let listingsPromise;
  function getListings() {
    if (!listingsPromise) {
      listingsPromise = fetch('/api/listings', { headers: { Accept: 'application/json' } })
        .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .catch(err => { listingsPromise = null; throw err; });
    }
    return listingsPromise;
  }

  /* ---- Révélation au défilement (discrète) ---- */
  let io;
  function observeReveal(root = document) {
    const els = root.querySelectorAll('.reveal:not(.is-visible), .line:not(.is-visible)');
    if (!('IntersectionObserver' in window)) { els.forEach(e => e.classList.add('is-visible')); return; }
    io = io || new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('is-visible'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
    els.forEach(e => io.observe(e));
  }

  /* ---- Formulaires de contact ---- */
  function bindContactForm(form, extra = () => ({})) {
    if (!form) return;
    const status = form.querySelector('.form-status');
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      const btn = form.querySelector('[type="submit"]');
      const label = btn.innerHTML;
      btn.disabled = true; btn.textContent = 'Envoi en cours…';
      status.hidden = true;
      try {
        const res = await fetch('/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...data, ...extra(data) }) });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(out.error || 'Une erreur est survenue.');
        form.reset();
        status.className = 'form-status form-status--ok';
        status.textContent = form.dataset.success || 'Merci, votre message a bien été envoyé. Nous vous recontactons rapidement.';
      } catch (err) {
        status.className = 'form-status form-status--err';
        status.innerHTML = `${esc(err.message)} Vous pouvez aussi nous appeler au <a href="tel:${AGENCY.phone}"><u>${AGENCY.phoneDisplay}</u></a>.`;
      } finally {
        status.hidden = false; btn.disabled = false; btn.innerHTML = label;
      }
    });
  }

  /* ---- Header & menu ---- */
  function initHeader() {
    const header = document.getElementById('header');
    const burger = document.querySelector('.burger');
    const onScroll = () => header && header.classList.toggle('is-scrolled', window.scrollY > 8);
    window.addEventListener('scroll', onScroll, { passive: true }); onScroll();
    if (burger) {
      burger.addEventListener('click', () => {
        const open = document.body.classList.toggle('nav-open');
        burger.setAttribute('aria-expanded', String(open));
        burger.setAttribute('aria-label', open ? 'Fermer le menu' : 'Ouvrir le menu');
      });
      document.querySelectorAll('#nav a').forEach(a => a.addEventListener('click', () => document.body.classList.remove('nav-open')));
      document.addEventListener('keydown', e => { if (e.key === 'Escape') { document.body.classList.remove('nav-open'); burger.setAttribute('aria-expanded', 'false'); } });
    }
    document.querySelectorAll('[data-year]').forEach(el => { el.textContent = new Date().getFullYear(); });
  }

  document.addEventListener('DOMContentLoaded', () => {
    initHeader();
    observeReveal();
    document.querySelectorAll('form[data-contact]').forEach(f => bindContactForm(f));
  });

  window.BILI = { AGENCY, TYPE_LABEL, TYPE_PLURAL, STATUS_LABEL, esc, fmt, priceHTML, priceText, waLink, waListingText, listingUrl, badgesHTML, factsHTML, cardHTML, getListings, matchLoc, observeReveal, bindContactForm };
})();
