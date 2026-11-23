/* Fiche d'un bien */
document.addEventListener('DOMContentLoaded', () => {
  const B = window.BILI;
  const { esc, fmt } = B;
  const l = JSON.parse(document.getElementById('listing-data').textContent);
  const $ = id => document.getElementById(id);
  const photos = l.photos && l.photos.length ? l.photos : ['/img/placeholder.svg'];
  const txLabel = l.transaction === 'vente' ? 'Acheter' : 'Louer';
  const txHref = l.transaction === 'vente' ? '/acheter' : '/louer';
  const locText = [l.district, l.city].filter(Boolean).join(', ');

  /* En-tête */
  $('crumbs').innerHTML = `<a href="/">Accueil</a><span aria-hidden="true">/</span><a href="${txHref}">${txLabel}</a><span aria-hidden="true">/</span><a href="/annonces?type=${l.type}">${esc(B.TYPE_PLURAL[l.type])}</a>`;
  $('p-badges').innerHTML = B.badgesHTML(l) + `<span class="badge">${esc(B.TYPE_LABEL[l.type])}</span>`;
  $('p-title').textContent = l.title;
  $('p-loc').textContent = locText + ', Tunisie';
  $('p-price').innerHTML = B.priceHTML(l);
  $('p-ref').textContent = `Référence ${l.ref}`;
  $('c-price').innerHTML = B.priceHTML(l);
  $('c-ref').textContent = `Réf. ${l.ref} · ${B.TYPE_LABEL[l.type]} ${l.transaction === 'vente' ? 'à vendre' : 'à louer'}`;
  const wa = B.waLink(B.waListingText(l));
  $('c-wa').href = wa; $('m-wa').href = wa;

  /* Galerie */
  const shown = photos.slice(0, 5);
  const g = $('gallery');
  g.classList.add(`gallery--${Math.min(shown.length, 5)}`);
  g.innerHTML = shown.map((p, i) => `
    <button type="button" data-i="${i}" aria-label="Agrandir la photo ${i + 1}">
      <img src="${esc(p)}" alt="${esc(l.title)} — photo ${i + 1}" ${i ? 'loading="lazy"' : 'fetchpriority="high"'} decoding="async">
      ${i === 0 && photos.length > 1 ? `<span class="gallery__more"><svg aria-hidden="true"><use href="#i-grid"/></svg>${photos.length} photos</span>` : ''}
    </button>`).join('');
  if (shown.length === 5) g.classList.remove('gallery--5');
  if (shown.length === 3) { g.style.gridTemplateColumns = '2fr 1fr'; }
  if (shown.length === 5) g.style.gridTemplateColumns = '2fr 1fr 1fr';

  /* Visionneuse */
  const lb = $('lightbox'); const lbImg = $('lb-img'); let cur = 0; let lastFocus;
  const show = i => { cur = (i + photos.length) % photos.length; lbImg.src = photos[cur]; lbImg.alt = `${l.title} — photo ${cur + 1}`; $('lb-count').textContent = `${cur + 1} / ${photos.length}`; };
  const open = i => { lastFocus = document.activeElement; show(i); lb.classList.add('is-open'); document.body.style.overflow = 'hidden'; $('lb-close').focus(); };
  const close = () => { lb.classList.remove('is-open'); document.body.style.overflow = ''; lastFocus && lastFocus.focus(); };
  g.addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) open(+b.dataset.i); });
  $('lb-close').addEventListener('click', close);
  $('lb-prev').addEventListener('click', () => show(cur - 1));
  $('lb-next').addEventListener('click', () => show(cur + 1));
  lb.addEventListener('click', e => { if (e.target.classList.contains('lightbox__stage')) close(); });
  document.addEventListener('keydown', e => {
    if (!lb.classList.contains('is-open')) return;
    if (e.key === 'Escape') close(); if (e.key === 'ArrowLeft') show(cur - 1); if (e.key === 'ArrowRight') show(cur + 1);
  });
  let sx = null;
  lb.addEventListener('touchstart', e => { sx = e.touches[0].clientX; }, { passive: true });
  lb.addEventListener('touchend', e => { if (sx === null) return; const dx = e.changedTouches[0].clientX - sx; if (Math.abs(dx) > 40) show(cur + (dx < 0 ? 1 : -1)); sx = null; });
  if (photos.length < 2) { $('lb-prev').hidden = true; $('lb-next').hidden = true; }

  /* Chiffres clés */
  const facts = [];
  if (l.surface) facts.push(['i-area', `${fmt(l.surface)} m²`, 'Surface habitable']);
  if (l.landSurface) facts.push(['i-t-terrain', `${fmt(l.landSurface)} m²`, 'Terrain']);
  if (l.type !== 'terrain') facts.push(['i-bed', l.bedrooms || (l.type === 'studio' ? 'Studio' : '—'), l.bedrooms > 1 ? 'Chambres' : 'Chambre']);
  if (l.bathrooms) facts.push(['i-bath', l.bathrooms, l.bathrooms > 1 ? 'Salles de bain' : 'Salle de bain']);
  facts.push([`i-t-${l.type}`, B.TYPE_LABEL[l.type], l.transaction === 'vente' ? 'À vendre' : 'À louer']);
  $('key-facts').innerHTML = facts.slice(0, 4).map(([ic, v, lab]) => `<div class="key-fact"><svg aria-hidden="true"><use href="#${ic}"/></svg><strong>${esc(v)}</strong><span>${esc(lab)}</span></div>`).join('');
  if (facts.length < 4) $('key-facts').style.gridTemplateColumns = `repeat(${facts.length}, 1fr)`;

  /* Description & prestations */
  $('p-desc').textContent = l.description || 'Description à venir. Contactez l\'agence pour plus d\'informations.';
  $('p-demo').hidden = !l.demo;
  if (l.features && l.features.length) $('p-features').innerHTML = l.features.map(f => `<li><svg aria-hidden="true"><use href="#i-check"/></svg>${esc(f)}</li>`).join('');
  else $('features-block').hidden = true;

  /* Tableau des caractéristiques */
  const STATUS = { disponible: 'Disponible', 'sous-offre': 'Sous offre', vendu: 'Vendu', loue: 'Loué' };
  const rows = [
    ['Référence', l.ref],
    ['Type de bien', B.TYPE_LABEL[l.type]],
    ['Transaction', l.transaction === 'vente' ? 'Vente' : 'Location'],
    ['Prix', B.priceText(l)],
    ['Localisation', locText],
    l.surface && ['Surface habitable', `${fmt(l.surface)} m²`],
    l.landSurface && ['Surface du terrain', `${fmt(l.landSurface)} m²`],
    l.type !== 'terrain' && ['Chambres', l.bedrooms || (l.type === 'studio' ? 'Studio' : '—')],
    l.bathrooms && ['Salles de bain', l.bathrooms],
    l.floor && ['Étage / niveaux', l.floor],
    ['Disponibilité', STATUS[l.status] || 'Disponible'],
  ].filter(Boolean);
  $('p-specs').innerHTML = rows.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`).join('');

  /* Carte (chargée à l'approche pour ne pas ralentir la page) */
  const mapBox = $('p-map');
  const loadMap = () => {
    if (mapBox.dataset.loaded) return; mapBox.dataset.loaded = 1;
    const q = encodeURIComponent(`${locText}, Sousse, Tunisie`);
    mapBox.innerHTML = `<iframe title="Carte du secteur : ${esc(locText)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="https://maps.google.com/maps?q=${q}&z=14&output=embed"></iframe>`;
  };
  if ('IntersectionObserver' in window) new IntersectionObserver((e, o) => { if (e[0].isIntersecting) { loadMap(); o.disconnect(); } }, { rootMargin: '400px' }).observe(mapBox);
  else loadMap();

  /* Formulaire de visite */
  B.bindContactForm($('visit-form'), () => ({ ref: l.ref, subject: `Demande de visite — ${l.title}` }));
  $('v-msg').placeholder = `Bonjour, je souhaite visiter ce bien (réf. ${l.ref}).`;

  /* Partage */
  $('share').addEventListener('click', async () => {
    const data = { title: l.title, text: `${l.title} — ${B.priceText(l)}`, url: location.href };
    if (navigator.share) { try { await navigator.share(data); } catch {} return; }
    try { await navigator.clipboard.writeText(location.href); $('share').setAttribute('aria-label', 'Lien copié'); $('share').title = 'Lien copié'; } catch {}
  });

  /* Biens similaires */
  B.getListings().then(all => {
    const score = x => (x.type === l.type ? 2 : 0) + (x.transaction === l.transaction ? 3 : 0) + (x.city === l.city ? 1 : 0);
    const sim = all.filter(x => x.ref !== l.ref && x.transaction === l.transaction && x.status !== 'vendu' && x.status !== 'loue')
      .sort((a, b) => score(b) - score(a)).slice(0, 3);
    if (!sim.length) return;
    $('similar').innerHTML = sim.map(x => B.cardHTML(x)).join('');
    $('similar-section').hidden = false;
    B.observeReveal($('similar'));
  }).catch(() => {});
});
