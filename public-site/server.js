/**
 * BILI IMMOBILIÈRE — serveur du site
 * Node.js >= 18, aucune dépendance externe.
 *
 *   node server.js            (port 3000 par défaut, ou PORT=8080 node server.js)
 *
 * - Sert les pages publiques (dossier /public) avec header/footer partagés.
 * - API JSON des annonces, formulaire de contact, dépôt d'annonce.
 * - Espace administrateur sécurisé (/admin) : mot de passe haché (scrypt),
 *   session par cookie HttpOnly, limitation des tentatives de connexion.
 * - Données stockées dans /data (fichiers JSON) et photos dans /public/uploads.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
// DATA_DIR / UPLOADS_DIR : permettent au site public et au Backstage installés séparément
// de partager les mêmes annonces, demandes et photos.
const DATA = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const UPLOADS = process.env.UPLOADS_DIR ? path.resolve(process.env.UPLOADS_DIR) : path.join(PUBLIC, 'uploads');
const PARTIALS = path.join(ROOT, 'partials');
const PORT = Number(process.env.PORT) || 3000;
// Parties présentes dans ce dossier : site public, Backstage, ou les deux
const HAS_SITE = fs.existsSync(path.join(PUBLIC, 'index.html'));
const HAS_ADMIN = fs.existsSync(path.join(PUBLIC, 'admin', 'index.html'));
// Adresse du site public, pour les liens « Voir le site » d'un Backstage installé à part
const PUBLIC_SITE_URL = (process.env.PUBLIC_SITE_URL || '').replace(/\/$/, '');
const SITE_URL = (process.env.SITE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const IS_PROD = process.env.NODE_ENV === 'production';

const FILES = {
  listings: path.join(DATA, 'listings.json'),
  messages: path.join(DATA, 'messages.json'),
  admin: path.join(DATA, 'admin.json'),
  seed: path.join(DATA, 'seed-listings.json'),
  meta: path.join(DATA, 'meta.json'),
};

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8', '.woff2': 'font/woff2',
};

/* ------------------------------------------------------------------ */
/* Stockage JSON                                                       */
/* ------------------------------------------------------------------ */
function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
let writeQueue = Promise.resolve();
function writeJSON(file, value) {
  writeQueue = writeQueue.then(async () => {
    const tmp = file + '.tmp';
    await fsp.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
    await fsp.rename(tmp, file);
  });
  return writeQueue;
}

function ensureData() {
  fs.mkdirSync(DATA, { recursive: true });
  fs.mkdirSync(UPLOADS, { recursive: true });
  if (!fs.existsSync(FILES.listings)) {
    const seed = readJSON(FILES.seed, []);
    fs.writeFileSync(FILES.listings, JSON.stringify(seed, null, 2));
  }
  if (!fs.existsSync(FILES.messages)) fs.writeFileSync(FILES.messages, '[]');
  if (HAS_ADMIN && !fs.existsSync(FILES.admin)) {
    const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
    fs.writeFileSync(FILES.admin, JSON.stringify({ username: 'admin', ...hashPassword(password) }, null, 2));
    const note = path.join(DATA, 'ADMIN-MOT-DE-PASSE-INITIAL.txt');
    fs.writeFileSync(note,
      `Espace administrateur BILI IMMOBILIÈRE\n\nAdresse : ${SITE_URL}/admin\nIdentifiant : admin\nMot de passe initial : ${password}\n\n` +
      `Changez ce mot de passe depuis l'espace administrateur (onglet « Sécurité »),\npuis supprimez ce fichier.\n`);
    console.log(`\n  Compte administrateur créé. Identifiants dans : ${note}\n`);
  }
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}
function checkPassword(password, { salt, hash }) {
  const test = crypto.scryptSync(String(password), salt, 64);
  const ref = Buffer.from(hash, 'hex');
  return test.length === ref.length && crypto.timingSafeEqual(test, ref);
}

/* ------------------------------------------------------------------ */
/* Sessions & sécurité                                                 */
/* ------------------------------------------------------------------ */
const sessions = new Map(); // token -> { user, expires, csrf }
const SESSION_TTL = 1000 * 60 * 60 * 8; // 8 h
const loginAttempts = new Map(); // ip -> { count, until }

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function getSession(req) {
  const token = parseCookies(req).bili_session;
  if (!token) return null;
  const s = sessions.get(token);
  if (!s || s.expires < Date.now()) { sessions.delete(token); return null; }
  s.expires = Date.now() + SESSION_TTL;
  return { token, ...s };
}
function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?';
}

/* ------------------------------------------------------------------ */
/* Utilitaires HTTP                                                    */
/* ------------------------------------------------------------------ */
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN',
};
function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}
function json(res, status, value, headers = {}) {
  send(res, status, JSON.stringify(value), { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store', ...headers });
}
function readBody(req, limit = 1e6) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('Requête trop volumineuse'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJsonBody(req, limit) {
  const buf = await readBody(req, limit);
  try { return JSON.parse(buf.toString('utf8') || '{}'); }
  catch { throw Object.assign(new Error('JSON invalide'), { status: 400 }); }
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const num = v => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : 0; };

/* ------------------------------------------------------------------ */
/* Annonces                                                            */
/* ------------------------------------------------------------------ */
const TYPES = ['appartement', 'villa', 'maison', 'terrain', 'studio', 'local'];
const TRANSACTIONS = ['vente', 'location'];
const STATUSES = ['disponible', 'sous-offre', 'vendu', 'loue'];

function getListings() { return readJSON(FILES.listings, []); }
function publicListing(l) {
  const { notes, ...rest } = l; // les notes internes ne sortent pas
  return rest;
}
function sanitizeListing(input, existing = {}) {
  const l = { ...existing };
  l.title = str(input.title, 140) || 'Bien sans titre';
  l.transaction = TRANSACTIONS.includes(input.transaction) ? input.transaction : 'vente';
  l.type = TYPES.includes(input.type) ? input.type : 'appartement';
  l.city = str(input.city, 80) || 'Hammam Sousse';
  l.district = str(input.district, 120);
  l.price = num(input.price);
  l.priceOnRequest = !!input.priceOnRequest;
  l.surface = num(input.surface);
  l.landSurface = num(input.landSurface);
  l.bedrooms = Math.round(num(input.bedrooms));
  l.bathrooms = Math.round(num(input.bathrooms));
  l.floor = str(input.floor, 40);
  l.description = str(input.description, 6000);
  l.features = (Array.isArray(input.features) ? input.features : String(input.features || '').split('\n'))
    .map(f => str(f, 80)).filter(Boolean).slice(0, 40);
  l.photos = (Array.isArray(input.photos) ? input.photos : [])
    .map(p => str(p, 300)).filter(p => /^\/(img|uploads)\/[\w.\-]+$/.test(p)).slice(0, 30);
  l.status = STATUSES.includes(input.status) ? input.status : 'disponible';
  l.featured = !!input.featured;
  l.isNew = !!input.isNew;
  l.exclusive = !!input.exclusive;
  l.published = input.published !== false;
  l.demo = !!input.demo;
  l.notes = str(input.notes, 2000);
  l.updatedAt = new Date().toISOString();
  return l;
}
function nextRef(listings, l) {
  const prefix = { appartement: 'AP', villa: 'VI', maison: 'MA', terrain: 'TE', studio: 'ST', local: 'LC' }[l.type] || 'BI';
  const tx = l.transaction === 'location' ? 'L' : 'V';
  // Compteur persistant : une référence supprimée n'est jamais réattribuée
  const meta = readJSON(FILES.meta, { lastRef: 0 });
  let max = meta.lastRef || 0;
  listings.forEach(x => { const m = /(\d+)$/.exec(x.ref || ''); if (m) max = Math.max(max, +m[1]); });
  meta.lastRef = max + 1;
  fs.writeFileSync(FILES.meta, JSON.stringify(meta));
  return `BILI-${tx}${prefix}-${String(meta.lastRef).padStart(3, '0')}`;
}

/* ------------------------------------------------------------------ */
/* Pages HTML (includes + SEO)                                         */
/* ------------------------------------------------------------------ */
const partialCache = {};
function partial(name) {
  if (!IS_PROD || !partialCache[name]) partialCache[name] = fs.readFileSync(path.join(PARTIALS, name), 'utf8');
  return partialCache[name];
}
function renderPage(file, vars = {}) {
  let html = fs.readFileSync(file, 'utf8');
  html = html.replace(/<!--#head\s+title="([^"]*)"\s+desc="([^"]*)"\s*-->/, (m, title, desc) =>
    partial('head.html').split('{{PAGE_TITLE}}').join(title).split('{{PAGE_DESC}}').join(desc));
  html = html.replace('<!--#header-->', () => partial('header.html')).replace('<!--#footer-->', () => partial('footer.html'));
  const page = vars.page || '';
  html = html.replace(/data-nav="([\w-]+)"/g, (m, k) => k === page ? `${m} aria-current="page"` : m);
  for (const [k, v] of Object.entries(vars)) html = html.split(`{{${k}}}`).join(v);
  html = html.replace(/\{\{CANONICAL\}\}/g, SITE_URL + '/').replace(/\{\{SITE_URL\}\}/g, SITE_URL);
  return html;
}
const PAGES = {
  '/': ['index.html', 'accueil'],
  '/annonces': ['annonces.html', 'annonces'],
  '/acheter': ['annonces.html', 'acheter'],
  '/louer': ['annonces.html', 'louer'],
  '/services': ['services.html', 'services'],
  '/a-propos': ['a-propos.html', 'a-propos'],
  '/contact': ['contact.html', 'contact'],
  '/deposer-une-annonce': ['deposer.html', 'deposer'],
  '/mentions-legales': ['mentions-legales.html', ''],
};
const LISTING_META = {
  annonces: ['Annonces immobilières à Sousse et Hammam Sousse', 'Appartements, villas, maisons, studios et terrains à vendre et à louer à Hammam Sousse, Sousse, Sahloul et Khezama.'],
  acheter: ['Acheter un bien immobilier à Sousse — Biens à vendre', 'Achat d\'appartements, villas, maisons et terrains à Hammam Sousse, Sousse, Sahloul et Khezama avec BILI IMMOBILIÈRE.'],
  louer: ['Louer un appartement ou une villa à Sousse — Locations', 'Locations d\'appartements, studios, villas et maisons à Hammam Sousse, Sousse, Sahloul et Khezama.'],
};

const TYPE_LABEL = { appartement: 'Appartement', villa: 'Villa', maison: 'Maison', terrain: 'Terrain', studio: 'Studio', local: 'Local commercial' };
function fmtPrice(l) {
  if (l.priceOnRequest || !l.price) return 'Prix sur demande';
  return new Intl.NumberFormat('fr-FR').format(l.price) + ' TND' + (l.transaction === 'location' ? ' / mois' : '');
}

function renderListingPage(res, ref) {
  const l = getListings().find(x => x.published && (x.ref === ref || x.ref.toLowerCase() === ref.toLowerCase()));
  if (!l) return notFound(res);
  const title = `${l.title} — ${fmtPrice(l)} | ${l.city}`;
  const desc = `${TYPE_LABEL[l.type]} ${l.transaction === 'vente' ? 'à vendre' : 'à louer'} à ${l.district ? l.district + ', ' : ''}${l.city}` +
    `${l.surface ? ` · ${l.surface} m²` : ''}${l.bedrooms ? ` · ${l.bedrooms} ch.` : ''}. Réf. ${l.ref}. ${l.description.slice(0, 110)}`;
  const img = l.photos[0] ? SITE_URL + l.photos[0] : `${SITE_URL}/img/og-cover.jpg`;
  const ld = {
    '@context': 'https://schema.org', '@type': 'RealEstateListing', name: l.title, description: l.description,
    url: `${SITE_URL}/bien/${l.ref}`, image: l.photos.map(p => SITE_URL + p), datePosted: l.createdAt,
    offers: l.priceOnRequest ? undefined : { '@type': 'Offer', price: l.price, priceCurrency: 'TND',
      businessFunction: l.transaction === 'vente' ? 'http://purl.org/goodrelations/v1#Sell' : 'http://purl.org/goodrelations/v1#LeaseOut' },
    address: { '@type': 'PostalAddress', addressLocality: l.city, addressRegion: 'Sousse', addressCountry: 'TN' },
  };
  const html = renderPage(path.join(PUBLIC, 'bien.html'), {
    page: l.transaction === 'vente' ? 'acheter' : 'louer',
    TITLE: esc(title), DESC: esc(desc), OG_IMAGE: esc(img), CANONICAL: `${SITE_URL}/bien/${esc(l.ref)}`,
    REF: esc(l.ref), JSONLD: JSON.stringify(ld).replace(/</g, '\\u003c'),
    INITIAL: JSON.stringify(publicListing(l)).replace(/</g, '\\u003c'),
  });
  send(res, 200, html, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
}

function notFound(res) {
  if (!HAS_SITE) return send(res, 404, 'Page introuvable', { 'Content-Type': MIME['.txt'] });
  const html = renderPage(path.join(PUBLIC, '404.html'), { page: '' });
  send(res, 404, html, { 'Content-Type': MIME['.html'] });
}

function sitemap(res) {
  const urls = Object.keys(PAGES).filter(p => p !== '/mentions-legales').map(p => ({ loc: SITE_URL + p, pr: p === '/' ? '1.0' : '0.8' }));
  getListings().filter(l => l.published).forEach(l => urls.push({ loc: `${SITE_URL}/bien/${l.ref}`, pr: '0.7', mod: l.updatedAt }));
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map(u => `  <url><loc>${esc(u.loc)}</loc>${u.mod ? `<lastmod>${u.mod.slice(0, 10)}</lastmod>` : ''}<priority>${u.pr}</priority></url>`).join('\n') +
    `\n</urlset>\n`;
  send(res, 200, xml, { 'Content-Type': MIME['.xml'] });
}

/* ------------------------------------------------------------------ */
/* Fichiers statiques                                                  */
/* ------------------------------------------------------------------ */
async function serveStatic(req, res, pathname) {
  const isUpload = pathname.startsWith('/uploads/');
  const base = isUpload ? UPLOADS : PUBLIC;
  const file = path.normalize(path.join(base, decodeURIComponent(isUpload ? pathname.slice(8) : pathname)));
  if (!file.startsWith(base + path.sep)) return notFound(res);
  if (/\.html$/.test(file) || /[\\/]\./.test(file)) return notFound(res); // pages servies via routes
  let stat;
  try { stat = await fsp.stat(file); } catch {
    // Vignette WebP absente (photo importée depuis un navigateur sans WebP) : vignette JPEG
    if (isUpload && file.endsWith('-sm.webp')) return serveStatic(req, res, pathname.replace(/\.webp$/, '.jpg'));
    return notFound(res);
  }
  if (!stat.isFile()) return notFound(res);
  const ext = path.extname(file).toLowerCase();
  const etag = `"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`;
  if (req.headers['if-none-match'] === etag) return send(res, 304, '');
  // Images : cache long. CSS/JS : revalidation par ETag (mises à jour visibles immédiatement).
  const cache = /^\/(img|uploads|fonts)\//.test(pathname) ? 'public, max-age=604800' : 'no-cache';
  res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': stat.size, 'Cache-Control': cache, ETag: etag });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */
async function api(req, res, pathname, url) {
  const method = req.method;
  const isAdminApi = pathname.startsWith('/api/admin/');
  if ((isAdminApi && !HAS_ADMIN) || (!isAdminApi && !HAS_SITE)) return json(res, 404, { error: 'Introuvable' });

  // --- Public ---
  if (pathname === '/api/listings' && method === 'GET') {
    return json(res, 200, getListings().filter(l => l.published).map(publicListing), { 'Cache-Control': 'no-cache' });
  }
  let m = /^\/api\/listings\/([\w-]+)$/.exec(pathname);
  if (m && method === 'GET') {
    const l = getListings().find(x => x.published && x.ref === m[1]);
    return l ? json(res, 200, publicListing(l)) : json(res, 404, { error: 'Annonce introuvable' });
  }
  if (pathname === '/api/contact' && method === 'POST') {
    const b = await readJsonBody(req, 20000);
    if (b.website) return json(res, 200, { ok: true }); // pot de miel anti-spam
    const msg = {
      id: crypto.randomUUID(), kind: b.kind === 'depot' ? 'depot' : 'contact',
      name: str(b.name, 100), phone: str(b.phone, 40), email: str(b.email, 120),
      subject: str(b.subject, 120), message: str(b.message, 4000), ref: str(b.ref, 40),
      details: b.details && typeof b.details === 'object'
        ? Object.fromEntries(Object.entries(b.details).slice(0, 15).map(([k, v]) => [str(k, 40), str(v, 300)])) : undefined,
      createdAt: new Date().toISOString(), read: false, status: 'nouveau', note: '',
    };
    if (!msg.name || (!msg.phone && !msg.email)) return json(res, 400, { error: 'Merci d\'indiquer votre nom et un téléphone ou un e-mail.' });
    const all = readJSON(FILES.messages, []); all.unshift(msg); await writeJSON(FILES.messages, all.slice(0, 2000));
    return json(res, 200, { ok: true });
  }

  // --- Authentification ---
  if (pathname === '/api/admin/login' && method === 'POST') {
    const ip = clientIp(req);
    const a = loginAttempts.get(ip) || { count: 0, until: 0 };
    if (a.until > Date.now()) return json(res, 429, { error: 'Trop de tentatives. Réessayez dans quelques minutes.' });
    const b = await readJsonBody(req, 5000);
    const admin = readJSON(FILES.admin, null);
    const ok = admin && str(b.username) === admin.username && checkPassword(b.password || '', admin);
    if (!ok) {
      a.count += 1; if (a.count >= 5) { a.until = Date.now() + 10 * 60 * 1000; a.count = 0; }
      loginAttempts.set(ip, a);
      return json(res, 401, { error: 'Identifiant ou mot de passe incorrect.' });
    }
    loginAttempts.delete(ip);
    const token = crypto.randomBytes(32).toString('hex');
    const csrf = crypto.randomBytes(16).toString('hex');
    sessions.set(token, { user: admin.username, expires: Date.now() + SESSION_TTL, csrf });
    const secure = SITE_URL.startsWith('https') ? '; Secure' : '';
    return json(res, 200, { ok: true, csrf }, { 'Set-Cookie': `bili_session=${token}; HttpOnly; SameSite=Strict; Path=/${secure}; Max-Age=${SESSION_TTL / 1000}` });
  }

  if (!pathname.startsWith('/api/admin/')) return json(res, 404, { error: 'Introuvable' });

  // --- Zone protégée ---
  const session = getSession(req);
  if (!session) return json(res, 401, { error: 'Session expirée, reconnectez-vous.' });
  if (pathname === '/api/admin/me' && method === 'GET') return json(res, 200, { user: session.user, csrf: session.csrf });
  if (method !== 'GET' && req.headers['x-csrf-token'] !== session.csrf) return json(res, 403, { error: 'Jeton de sécurité invalide.' });

  if (pathname === '/api/admin/logout' && method === 'POST') {
    sessions.delete(session.token);
    return json(res, 200, { ok: true }, { 'Set-Cookie': 'bili_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }
  if (pathname === '/api/admin/password' && method === 'POST') {
    const b = await readJsonBody(req, 5000);
    const admin = readJSON(FILES.admin, null);
    if (!checkPassword(b.current || '', admin)) return json(res, 400, { error: 'Mot de passe actuel incorrect.' });
    if (String(b.next || '').length < 10) return json(res, 400, { error: 'Le nouveau mot de passe doit comporter au moins 10 caractères.' });
    await writeJSON(FILES.admin, { username: admin.username, ...hashPassword(String(b.next)) });
    for (const [t, s] of sessions) if (t !== session.token) sessions.delete(t);
    return json(res, 200, { ok: true });
  }
  if (pathname === '/api/admin/listings' && method === 'GET') return json(res, 200, getListings());
  if (pathname === '/api/admin/listings' && method === 'POST') {
    const b = await readJsonBody(req, 200000);
    const listings = getListings();
    const l = sanitizeListing(b, { id: crypto.randomUUID(), createdAt: new Date().toISOString() });
    l.ref = nextRef(listings, l);
    listings.unshift(l); await writeJSON(FILES.listings, listings);
    return json(res, 201, l);
  }
  m = /^\/api\/admin\/listings\/([\w-]+)$/.exec(pathname);
  if (m) {
    const listings = getListings();
    const i = listings.findIndex(x => x.id === m[1]);
    if (i < 0) return json(res, 404, { error: 'Annonce introuvable' });
    if (method === 'PUT') {
      const b = await readJsonBody(req, 200000);
      listings[i] = sanitizeListing(b, listings[i]);
      await writeJSON(FILES.listings, listings);
      return json(res, 200, listings[i]);
    }
    if (method === 'DELETE') {
      const [removed] = listings.splice(i, 1);
      await writeJSON(FILES.listings, listings);
      // Supprime les photos importées qui ne servent plus à aucune annonce
      const used = new Set(listings.flatMap(x => x.photos));
      for (const p of removed.photos) {
        if (!p.startsWith('/uploads/') || used.has(p)) continue;
        const base = path.join(UPLOADS, path.basename(p));
        fsp.unlink(base).catch(() => {});
        for (const e of ['webp', 'jpg']) fsp.unlink(base.replace(/\.(jpg|png|webp)$/, `-sm.${e}`)).catch(() => {});
      }
      return json(res, 200, { ok: true });
    }
  }
  if (pathname === '/api/admin/upload' && method === 'POST') {
    const type = (req.headers['content-type'] || '').split(';')[0];
    const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[type];
    if (!ext) return json(res, 415, { error: 'Format accepté : JPG, PNG ou WebP.' });
    const buf = await readBody(req, 8 * 1024 * 1024);
    const sig = buf.subarray(0, 12).toString('hex');
    const valid = (ext === '.jpg' && sig.startsWith('ffd8ff')) || (ext === '.png' && sig.startsWith('89504e47')) ||
      (ext === '.webp' && buf.subarray(8, 12).toString() === 'WEBP');
    if (!valid) return json(res, 400, { error: 'Fichier image invalide.' });
    // Vignette d'une photo déjà importée (générée par le navigateur de l'administrateur)
    const thumbFor = str(req.headers['x-thumb-for'], 80);
    if (thumbFor) {
      const m = /^([\w-]+)\.(jpg|png|webp)$/.exec(thumbFor);
      if (!m || ext === '.png' || !fs.existsSync(path.join(UPLOADS, thumbFor))) return json(res, 400, { error: 'Vignette invalide.' });
      await fsp.writeFile(path.join(UPLOADS, `${m[1]}-sm${ext}`), buf);
      return json(res, 201, { url: `/uploads/${m[1]}-sm${ext}` });
    }
    const name = `${Date.now().toString(36)}-${crypto.randomBytes(5).toString('hex')}${ext}`;
    await fsp.writeFile(path.join(UPLOADS, name), buf);
    return json(res, 201, { url: `/uploads/${name}` });
  }
  if (pathname === '/api/admin/messages' && method === 'GET') return json(res, 200, readJSON(FILES.messages, []));
  m = /^\/api\/admin\/messages\/([\w-]+)$/.exec(pathname);
  if (m) {
    const all = readJSON(FILES.messages, []);
    const i = all.findIndex(x => x.id === m[1]);
    if (i < 0) return json(res, 404, { error: 'Message introuvable' });
    if (method === 'PUT') {
      // Suivi d'une demande : statut + note interne (sans corps : simple « marquer comme lu »)
      const b = await readJsonBody(req, 10000).catch(() => ({}));
      const STATUSES = ['nouveau', 'en-cours', 'traite', 'archive'];
      if (STATUSES.includes(b.status)) all[i].status = b.status;
      else if (!b.status && (!all[i].status || all[i].status === 'nouveau') && b.note === undefined) all[i].status = 'en-cours';
      if (typeof b.note === 'string') all[i].note = str(b.note, 4000);
      all[i].read = all[i].status !== 'nouveau';
      all[i].updatedAt = new Date().toISOString();
      await writeJSON(FILES.messages, all); return json(res, 200, all[i]);
    }
    if (method === 'DELETE') { all.splice(i, 1); await writeJSON(FILES.messages, all); return json(res, 200, { ok: true }); }
  }
  return json(res, 404, { error: 'Introuvable' });
}

/* ------------------------------------------------------------------ */
/* Routeur                                                             */
/* ------------------------------------------------------------------ */
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    let pathname = url.pathname;
    if (pathname.length > 1 && pathname.endsWith('/')) pathname = pathname.slice(0, -1);

    if (pathname.startsWith('/api/')) return await api(req, res, pathname, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Méthode non autorisée');

    if (!HAS_SITE) {
      if (pathname === '/') return send(res, 302, '', { Location: '/admin' });
      if (PAGES[pathname] || pathname.startsWith('/bien/') || pathname === '/sitemap.xml') return notFound(res);
    }
    if (PAGES[pathname]) {
      const [file, page] = PAGES[pathname];
      const meta = LISTING_META[page] || [];
      const html = renderPage(path.join(PUBLIC, file), {
        page, TITLE: meta[0] || '', DESC: meta[1] || '', PRESET: page === 'acheter' ? 'vente' : page === 'louer' ? 'location' : '',
        CANONICAL: SITE_URL + (pathname === '/' ? '/' : pathname),
      });
      return send(res, 200, html, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
    }
    const bien = /^\/bien\/([\w-]+)(?:\/[\w-]*)?$/.exec(pathname);
    if (bien) return renderListingPage(res, bien[1]);
    if (pathname === '/admin' && HAS_ADMIN) {
      let page = fs.readFileSync(path.join(PUBLIC, 'admin', 'index.html'), 'utf8');
      if (PUBLIC_SITE_URL) {
        page = page.split('href="/"').join(`href="${PUBLIC_SITE_URL}/"`)
          .replace('</head>', `<script>window.SITE_BASE = ${JSON.stringify(PUBLIC_SITE_URL)};</script></head>`);
      }
      return send(res, 200, page, {
        'Content-Type': MIME['.html'], 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow',
      });
    }
    if (pathname === '/sitemap.xml') return sitemap(res);
    if (pathname === '/robots.txt') {
      return send(res, 200, `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\n\nSitemap: ${SITE_URL}/sitemap.xml\n`, { 'Content-Type': MIME['.txt'] });
    }
    return await serveStatic(req, res, pathname);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) json(res, err.status || 500, { error: err.status ? err.message : 'Erreur serveur' });
  }
});

ensureData();
server.listen(PORT, () => console.log(`BILI IMMOBILIÈRE — site en ligne sur ${SITE_URL}`));

