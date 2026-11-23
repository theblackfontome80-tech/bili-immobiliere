# BILI IMMOBILIÈRE — Backstage

Espace de gestion de l'agence : tableau de bord, boîte de réception des demandes (contact, visites,
biens proposés), ajout et modification des annonces, photos, sécurité du compte.
Node.js ≥ 18, **aucune dépendance** à installer.

```bash
node server.js            # http://localhost:3000  → ouvre /admin
```

Au premier lancement, un compte `admin` est créé et son mot de passe est écrit dans
`data/ADMIN-MOT-DE-PASSE-INITIAL.txt`. **Changez-le** dans l'onglet « Sécurité », puis supprimez ce fichier.
(Ou fixez-le dès le départ : `ADMIN_PASSWORD=... node server.js`.)

## Le relier au site public

Lancé seul, le Backstage utilise son propre dossier `data/` : il ne voit pas les demandes envoyées
depuis le site. Pour gérer le vrai site, installez-le **sur le même serveur** et pointez-le vers les
données du site public :

```bash
PORT=3001 \
DATA_DIR=../bili-site-public/data \
UPLOADS_DIR=../bili-site-public/public/uploads \
PUBLIC_SITE_URL=https://www.bili-immobiliere.tn \
node server.js
```

| Variable | Rôle |
|---|---|
| `DATA_DIR` | dossier `data/` du site public (annonces + demandes) |
| `UPLOADS_DIR` | dossier `public/uploads/` du site public (photos importées) |
| `PUBLIC_SITE_URL` | adresse du site, pour les liens « Voir le site » / « Voir l'annonce » |
| `SITE_URL` | adresse publique du Backstage (en `https://`, le cookie de session devient `Secure`) |

Conseil : mettez le Backstage sur un sous-domaine séparé (ex. `backstage.bili-immobiliere.tn`) derrière HTTPS.

Sécurité : mot de passe haché (scrypt), cookie de session HttpOnly/SameSite, jeton CSRF,
blocage 10 min après 5 échecs de connexion, vérification du format réel des images importées.
