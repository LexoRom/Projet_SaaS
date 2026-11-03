# TD1 — SaaS de gestion de projet

Application web de gestion de projets inspirée de Trello / Notion / ClickUp, réalisée pour le TD1.

## Fonctionnalités

- Création initiale d'une entreprise et de son administrateur.
- Authentification par JWT.
- Gestion des utilisateurs d'une entreprise.
- Création / modification / suppression des projets.
- Affectation de plusieurs utilisateurs à un projet.
- Création / suppression de tâches.
- Affectation d'une tâche à un membre du projet.
- Statuts `todo`, `doing`, `done`.
- Tableau Kanban avec glisser-déposer.
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

Puis ouvrir :

http://localhost:3000

## Première utilisation

1. Ouvrir l'application.
2. Cliquer sur « Première installation ».
3. Créer l'entreprise et le premier compte administrateur.
4. Se connecter.
5. Créer des utilisateurs.
6. Créer un projet et sélectionner ses membres.
7. Créer des tâches et les déplacer dans le Kanban.

## Configuration

Les paramètres sont externalisés dans les variables d'environnement :

- `PORT`
- `MONGO_URI`
- `JWT_SECRET`
- `JWT_EXPIRES_IN`

Un fichier `.env.example` est fourni.

Pour modifier la connexion MongoDB sans modifier le code :

```bash
MONGO_URI=mongodb://mongo:27017/saas_project
docker compose up -d --build
```

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
- `POST /api/auth/login`
- `GET /api/me`

### Entreprise

- `GET /api/company`
- `PATCH /api/company`

### Utilisateurs

- `GET /api/users`
- `POST /api/users`
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

## Arrêt

```bash
docker compose down
```

Pour supprimer également les données MongoDB :

```bash
docker compose down -v
```
