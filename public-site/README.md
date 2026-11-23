# BILI IMMOBILIÈRE — Site public

Site vitrine et catalogue d'annonces (accueil, acheter, louer, fiches biens avec WhatsApp, services,
contact, dépôt d'annonce). Node.js ≥ 18, **aucune dépendance** à installer.

```bash
node server.js            # http://localhost:3000
```

En production :

```bash
NODE_ENV=production SITE_URL=https://www.bili-immobiliere.tn node server.js
```

Ce dossier ne contient **pas** l'espace de gestion : `/admin` répond « page introuvable ».
Les annonces et les photos sont gérées depuis le **Backstage** (archive séparée).

## Brancher le Backstage sur ce site

Les annonces, les demandes reçues et les photos sont stockées dans `data/` et `public/uploads/`.
Pour que le Backstage les gère, lancez-le **sur le même serveur** en lui indiquant ces dossiers :

```bash
# site public (ce dossier), port 3000
node server.js

# Backstage (autre dossier), port 3001
PORT=3001 DATA_DIR=../bili-site-public/data UPLOADS_DIR=../bili-site-public/public/uploads \
PUBLIC_SITE_URL=https://www.bili-immobiliere.tn node server.js
```

Sous Windows (PowerShell) : `$env:PORT=3001; $env:DATA_DIR='..\bili-site-public\data'; ...; node server.js`

## Données

| Fichier | Contenu |
|---|---|
| `data/listings.json` | annonces (recréé depuis `seed-listings.json` s'il manque) |
| `data/messages.json` | demandes reçues par les formulaires (créé au premier envoi) |
| `public/uploads/` | photos importées depuis le Backstage |

SEO : titres et descriptions par page, Open Graph, données structurées, `/sitemap.xml`, `/robots.txt`.
