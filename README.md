# TD1 — SaaS de gestion de projet

Application web de gestion de projets inspirée de Trello / Notion / ClickUp, réalisée pour le TD1.

## Fonctionnalités

- Création initiale d'une entreprise et de son administrateur.
- Authentification par JWT.
- Gestion des utilisateurs d'une entreprise.
- Création / modification / suppression de l'entreprise et des projets.
- Création / modification / suppression des utilisateurs.
- Affectation de plusieurs utilisateurs à un projet.
- Création / modification / suppression de tâches.
- Affectation d'une tâche à plusieurs membres du projet.
- Statuts `todo`, `doing`, `done`.
- Tableau Kanban avec glisser-déposer.
- Recherche instantanée, filtres par priorité/échéance et vue « Mes tâches ».
- Sélection d'assignés par cases à cocher et recherche, sans raccourci clavier.
- Priorité et date d'échéance.
- Isolation stricte par `companyId` sur toutes les ressources.
- MongoDB configurable avec `MONGO_URI`.
- Démarrage complet avec Docker Compose.

## Prérequis

Uniquement Docker et Docker Compose.

## Lancement

À la racine du projet :

```bash
docker compose up -d --build
```

Vérifier l'état des services :

```bash
docker compose ps
docker compose logs -f app
```

L'état `healthy` de `app` signifie que l'API répond et que MongoDB est joignable. Puis ouvrir :

http://localhost:3000

Le contrôle de santé peut aussi se faire dans PowerShell :

```powershell
Invoke-RestMethod http://localhost:3000/api/health
```

## Première utilisation

1. Ouvrir l'application.
2. Cliquer sur « Première installation ».
3. Créer l'entreprise et le premier compte administrateur.
4. Se connecter avec l'email et le mot de passe; si plusieurs entreprises partagent ce compte, renseigner aussi le nom de l'entreprise.
5. Créer des utilisateurs.
6. Créer un projet et sélectionner ses membres.
7. Créer des tâches, sélectionner plusieurs personnes avec `Ctrl` + clic, puis les déplacer dans le Kanban.
8. Un administrateur peut créer une autre entreprise avec le bouton « Nouvelle entreprise ».

## Configuration

Les paramètres sont externalisés dans les variables d'environnement :

- `PORT`
- `MONGO_URI`
- `JWT_SECRET`
- `JWT_EXPIRES_IN`

Un fichier `.env.example` est fourni.

Le fichier `.env` est facultatif pour le démarrage local. Pour personnaliser la configuration, lancez `Copy-Item .env.example .env` dans PowerShell puis adaptez les valeurs. Compose lit automatiquement ce fichier. Définissez une valeur longue et aléatoire pour `JWT_SECRET` avant tout partage ou déploiement. Pour utiliser le port `3001`, par exemple, définissez `PORT=3001` dans `.env`; l'adresse devient `http://localhost:3001`.

Pour modifier la connexion MongoDB sans modifier le code :

```powershell
$env:MONGO_URI = "mongodb://mongo:27017/saas_project"
docker compose up -d --build
```

`mongo` est le nom du service Docker. Depuis l'application conteneurisée, `localhost` désignerait le conteneur de l'application et non celui de MongoDB.

Dans un futur environnement répliqué/shardé, il suffira de remplacer `MONGO_URI` par la chaîne de connexion MongoDB appropriée.

## Architecture

```text
Navigateur
    |
    v
Express / Node.js
    |
    | Mongoose
    v
MongoDB
```

Le navigateur consomme une API REST. Le backend porte toutes les règles d'isolation tenant.

## Sécurité multi-tenant

Le JWT contient `userId`, `companyId` et `role`.

Toutes les requêtes de lecture/écriture importantes filtrent sur `companyId` issu du token côté serveur. L'identifiant de société n'est donc jamais accepté depuis le navigateur pour choisir arbitrairement un tenant.

Exemples :

```js
User.find({ companyId: req.auth.companyId })
Project.findOne({ _id: projectId, companyId: req.auth.companyId })
Task.findOne({ _id: taskId, companyId: req.auth.companyId })
```

Lorsqu'une tâche est assignée, le backend vérifie à la fois que l'utilisateur appartient à l'entreprise et qu'il est membre du projet.

## API principale

### Authentification

- `POST /api/bootstrap`
- `POST /api/auth/login` (champ facultatif `companyName` si le compte existe dans plusieurs entreprises)
- `GET /api/me`

### Création d'une entreprise supplémentaire

- `POST /api/companies` (réservé à l'administrateur connecté; crée un nouvel administrateur et ouvre ensuite ce nouvel espace)

### Entreprise

- `GET /api/company`
- `PATCH /api/company`
- `DELETE /api/company` (suppression de toutes les données du tenant)

### Utilisateurs

- `GET /api/users`
- `POST /api/users`
- `PATCH /api/users/:id`
- `DELETE /api/users/:id`

### Projets

- `GET /api/projects`
- `POST /api/projects`
- `PATCH /api/projects/:id`
- `DELETE /api/projects/:id`

### Tâches

- `GET /api/projects/:projectId/tasks`
- `POST /api/projects/:projectId/tasks`
- `PATCH /api/tasks/:id`
- `DELETE /api/tasks/:id`

Les requêtes de tâches utilisent `assigneeIds`, un tableau d'identifiants membres du projet. Au démarrage, les anciennes tâches assignées à une seule personne sont migrées automatiquement.

## Arrêt

```bash
docker compose down
```

Pour supprimer également les données MongoDB :

```bash
docker compose down -v
```
