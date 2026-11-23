/* Page d'accueil */
document.addEventListener('DOMContentLoaded', () => {
  const { getListings, cardHTML, observeReveal, matchLoc } = window.BILI;

  const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
  const isAvailable = l => l.status !== 'vendu' && l.status !== 'loue';

  // Moteur de recherche : onglets Acheter / Louer + nombre de résultats en direct
  const form = document.getElementById('hero-search');
  const txInput = form.querySelector('[name="transaction"]');
  const countEl = document.getElementById('search-count');
  let all = null;

  function updateCount() {
    if (!all) return;
    const d = Object.fromEntries(new FormData(form).entries());
    const min = Number(d.min) || 0, max = Number(d.max) || Infinity;
    const n = all.filter(l =>
      l.transaction === d.transaction &&
      (!d.type || l.type === d.type) &&
      matchLoc(l, d.loc) &&
      (!(min || max < Infinity) || (l.price && l.price >= min && l.price <= max))
    ).length;
    countEl.textContent = ` · ${plural(n, 'bien', 'biens')}`;
  }

  form.querySelectorAll('.search__tab').forEach(tab => tab.addEventListener('click', () => {
    form.querySelectorAll('.search__tab').forEach(t => t.setAttribute('aria-selected', String(t === tab)));
    txInput.value = tab.dataset.tx;
    updateCount();
  }));
  form.addEventListener('input', updateCount);
  form.addEventListener('change', updateCount);

  // N'envoie pas les champs vides dans l'URL
  form.addEventListener('submit', e => {
    e.preventDefault();
    const params = new URLSearchParams();
    new FormData(form).forEach((v, k) => { if (String(v).trim()) params.set(k, String(v).trim()); });
    location.href = '/annonces' + (params.toString() ? '?' + params : '');
  });

  // Texte qui défile le long de la courbe du hero
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.querySelectorAll('textPath[data-marquee]').forEach(tp => {
    const svg = tp.ownerSVGElement;
    const unitText = tp.textContent;
    const start = () => {
      if (!svg.getBoundingClientRect().width) return false;         // SVG masqué (autre format d'écran)
      const unit = tp.getComputedTextLength();
      if (!unit) return false;
      const path = svg.querySelector(tp.getAttribute('href'));
      const reps = Math.ceil(path.getTotalLength() / unit) + 2;
      tp.textContent = unitText.repeat(reps);
      if (reduce) return true;
      const speed = 38; // unités SVG par seconde
      let t0;
      const step = t => {
        t0 = t0 || t;
        tp.setAttribute('startOffset', -(((t - t0) / 1000 * speed) % unit));
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
      return true;
    };
    const tryStart = () => { if (!start()) window.addEventListener('resize', tryStart, { once: true }); };
    (document.fonts ? document.fonts.ready : Promise.resolve()).then(tryStart);
  });

  // Catalogue défilant : flèches précédent / suivant
  const track = document.getElementById('featured');
  const navBtns = document.querySelectorAll('[data-slide]');
  const updateNav = () => {
    const max = track.scrollWidth - track.clientWidth - 2;
    navBtns.forEach(b => { b.disabled = b.dataset.slide === '-1' ? track.scrollLeft <= 2 : track.scrollLeft >= max; });
  };
  navBtns.forEach(b => b.addEventListener('click', () => {
    const card = track.querySelector('.card');
    const step = card ? card.getBoundingClientRect().width + 24 : track.clientWidth / 2;
    track.scrollBy({ left: step * Number(b.dataset.slide), behavior: reduce ? 'auto' : 'smooth' });
  }));
  track.addEventListener('scroll', updateNav, { passive: true });
  window.addEventListener('resize', updateNav);

  getListings().then(list => {
    all = list.filter(isAvailable);
    updateCount();

    // Sélection : les biens « À la une », complétés si besoin (6 cartes défilantes)
    let featured = all.filter(l => l.featured);
    if (featured.length < 6) featured = featured.concat(all.filter(l => !l.featured));
    featured = featured.slice(0, 6);
    const box = document.getElementById('featured');
    box.innerHTML = featured.length
      ? featured.map(l => cardHTML(l)).join('')
      : '<div class="empty" style="grid-column:1/-1"><h3>Nos prochaines annonces arrivent</h3><p>Contactez-nous pour connaître les biens disponibles.</p><a class="btn" href="/contact">Nous contacter</a></div>';
    observeReveal(box);
    updateNav();

    document.querySelectorAll('[data-count]').forEach(el => {
      const n = all.filter(l => l.type === el.dataset.count).length;
      el.textContent = n ? plural(n, 'bien disponible', 'biens disponibles') : 'Sur demande';
    });
    document.querySelectorAll('[data-zone]').forEach(el => {
      const n = all.filter(l => matchLoc(l, el.dataset.zone)).length;
      el.textContent = n ? plural(n, 'bien', 'biens') : 'Sur demande';
    });
  }).catch(() => {
    document.getElementById('featured').innerHTML = '<div class="empty" style="grid-column:1/-1"><h3>Impossible de charger les annonces</h3><p>Merci de réessayer dans un instant ou de nous appeler au +216 51 294 295.</p></div>';
  });
});
