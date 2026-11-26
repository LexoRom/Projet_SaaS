# Regestion : gestion de projet SaaS multi-entreprises (partie I)

Application web de gestion de projet inspirée de Trello : entreprises isolées les unes des autres, utilisateurs, projets, tâches et tableau Kanban. Node.js 22, Express, React et MongoDB 8.0.

## Prérequis

Docker et Docker Compose uniquement. Au premier lancement, une connexion Internet est nécessaire pour télécharger les images et les dépendances.

## Démarrage

À la racine du projet :

```powershell
docker compose up -d --build
```

Puis ouvrir <http://localhost:8080>.

La commande démarre trois services dans cet ordre :

| Service | Rôle |
|---|---|
| `mongo` | MongoDB 8.0 en replica set à un nœud (`rs0`), initialisé automatiquement |
| `seed` | Crée les collections, les validateurs et les index, insère les données de démonstration, puis **s'arrête** (état `Exited (0)` normal) |
| `app` | API REST et interface web |

Relancer la commande ne crée pas de doublons.

## Comptes de démonstration

Le mot de passe de tous les comptes est la valeur de `SEED_DEMO_PASSWORD` dans le fichier `.env`.

| Entreprise | E-mail | Rôle |
|---|---|---|
| Acme | `alice@acme.test` | Propriétaire |
| Acme | `bob@acme.test` | Administrateur |
| Acme | `chloe@acme.test` | Membre de tous les projets |
| Acme | `david@acme.test` | Membre du seul projet « Site web » |
| Globex | `gina@globex.test` | Propriétaire |
| Globex | `hector@globex.test` | Membre |

Le seed crée 30 entreprises au total, pour que la répartition entre shards soit visible en partie II.

On peut aussi inscrire une nouvelle entreprise depuis l'écran de connexion.

## Utilisation

1. **Tableau de bord** : mes tâches ouvertes, tâches en retard, répartition par statut.
2. **Projets** : ouvrir un projet affiche son Kanban.
   - Glisser une carte change son statut ou son ordre. Au clavier : sélectionner la carte avec `Tab`, la saisir avec `Espace`, la déplacer avec les flèches, la déposer avec `Espace`. `Entrée` ouvre la fiche.
   - Un clic ouvre la fiche : description, assigné, priorité, échéance, étiquettes, checklist, commentaires et historique.
   - **Gérer le projet** (propriétaire et administrateurs) : membres, colonnes, archivage, suppression.
3. **Utilisateurs** : annuaire de l'entreprise ; création, modification et suppression par le propriétaire et les administrateurs.
4. **Paramètres** : profil et mot de passe ; entreprise ; transfert de propriété et suppression de l'entreprise (propriétaire).

Seul un membre d'un projet peut se voir assigner une de ses tâches. Les changements faits par d'autres utilisateurs apparaissent après un rafraîchissement.

### Vérifier l'isolation

Se connecter avec `alice@acme.test`, ouvrir un projet et copier son adresse. Se déconnecter, se connecter avec `gina@globex.test`, puis coller l'adresse : l'application répond « Projet introuvable ».

## Configuration

Tout se règle dans le fichier `.env`, sans modifier le code.

| Variable | Rôle |
|---|---|
| `MONGO_URI` | Chaîne de connexion MongoDB complète |
| `MONGO_DB` | Nom de la base |
| `MONGO_WRITE_CONCERN` | Acquittement des écritures (`majority`) |
| `PORT` | Port de l'application dans le conteneur |
| `APP_PORT` | Port publié sur la machine |
| `JWT_SECRET` | Clé de signature des sessions, 32 caractères minimum |
| `SEED_ENABLED` | `true` pour insérer les données de démonstration |
| `SEED_DEMO_PASSWORD` | Mot de passe des comptes de démonstration |

Le fichier `.env` fourni contient des valeurs de démonstration, pour que l'application démarre sans configuration. En production, remplacer ces valeurs, ne pas versionner ce fichier, et servir l'application en HTTPS avec `COOKIE_SECURE=true`.

L'application n'est publiée que sur `127.0.0.1`. MongoDB n'est pas publié sur la machine.

## Commandes utiles

État des services :

```powershell
docker compose ps -a
```

Journaux de l'application :

```powershell
docker compose logs app
```

Console MongoDB :

```powershell
docker compose exec mongo mongosh taskflow
```

Arrêt, en conservant les données :

```powershell
docker compose down
```

Arrêt et **suppression des données** de Regestion :

```powershell
docker compose down -v
```

Le projet Compose est nommé `taskflow` et ses volumes commencent par `taskflow_` : il n'utilise ni ne supprime les données d'autres projets.

## Dépannage

| Symptôme | Solution |
|---|---|
| `port is already allocated` | Changer `APP_PORT` dans `.env`, puis relancer |
| Connexion refusée avec les comptes de démonstration | Le mot de passe est fixé au premier seed. Après l'avoir changé dans `.env`, réinitialiser avec `docker compose down -v` |
| Réponse 503 | La base est indisponible. L'application se reconnecte seule quand elle revient |

## Tests

Les tests ne font pas partie des prérequis : ils demandent Node.js 20 ou plus sur la machine. La pile doit être démarrée.

Tests de bout en bout (isolation, droits, règles de gestion, requêtes simultanées) :

```powershell
node --test tests/api.test.mjs
```

Ils créent leurs propres entreprises et les suppriment à la fin. Après plusieurs exécutions rapprochées, la limite d'essais de connexion peut s'activer ; `docker compose restart app` la réinitialise.

Contrôle d'intégrité de la base, à copier puis exécuter dans le conteneur :

```powershell
docker compose cp tests/integrity.js mongo:/tmp/integrity.js
```

```powershell
docker compose exec mongo mongosh --quiet taskflow /tmp/integrity.js
```

## Organisation du code

```text
compose.yml, Dockerfile, .env
server/src/
  config.js       variables d'environnement
  db.js           connexion et transactions
  scoped.js       dépôt lié à une entreprise (isolation)
  access.js       droits sur les projets et verrous des transactions
  schema.js       validateurs et index
  seed.js         données de démonstration
  routes/         API REST
  services/       règles métier partagées
client/src/       interface React
tests/            tests de bout en bout et contrôle d'intégrité
```
