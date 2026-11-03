# Spécification technique — MongoDB

## 1. Choix d'architecture

Le modèle retenu est un modèle multi-tenant dans une base MongoDB unique.

Chaque collection métier contient un champ `companyId`.

Cette stratégie permet :
- une séparation logique claire ;
- des requêtes simples ;
- une évolution ultérieure vers réplication et sharding ;
- l'ajout d'index commençant par `companyId`.

## 2. Collections

### 2.1 companies

```json
{
  "_id": "ObjectId",
  "name": "Acme",
  "createdAt": "ISODate"
}
```

### 2.2 users

```json
{
  "_id": "ObjectId",
  "companyId": "ObjectId",
  "name": "Alice",
  "email": "alice@acme.fr",
  "passwordHash": "bcrypt hash",
  "role": "admin",
  "createdAt": "ISODate"
}
```

Contrainte :
- index unique `{ companyId: 1, email: 1 }`.

### 2.3 projects

```json
{
  "_id": "ObjectId",
  "companyId": "ObjectId",
  "name": "Projet CRM",
  "description": "Refonte du CRM",
  "userIds": ["ObjectId"],
  "createdAt": "ISODate"
}
```

### 2.4 tasks

```json
{
  "_id": "ObjectId",
  "companyId": "ObjectId",
  "projectId": "ObjectId",
  "title": "Créer la page login",
  "description": "Formulaire de connexion",
  "assigneeId": "ObjectId",
  "status": "doing",
  "priority": "high",
  "dueDate": "ISODate",
  "createdAt": "ISODate",
  "updatedAt": "ISODate"
}
```

## 3. Relations

```text
Company 1 ─── N User
Company 1 ─── N Project
Project N ─── N User
Project 1 ─── N Task
User 1 ─── N Task
```

Les relations sont représentées par des `ObjectId`.

## 4. Règles d'intégrité applicative

### User → Company

Un utilisateur est toujours créé avec le `companyId` provenant du contexte d'authentification.

### Project → Company

Un projet est créé dans le tenant du token.

### Project → User

Avant d'ajouter des membres, le backend vérifie que chaque utilisateur possède le même `companyId`.

### Task → Project

Avant toute opération sur une tâche, le backend vérifie simultanément :

```text
task.companyId == token.companyId
```

et, lorsque le projet est recherché :

```text
project.companyId == token.companyId
```

### Task → User

Avant une assignation :
- l'utilisateur doit appartenir au tenant ;
- l'utilisateur doit être membre du projet.

## 5. Index

Index définis :

```text
users:
  { companyId: 1, email: 1 } UNIQUE

projects:
  { companyId: 1, createdAt: -1 }

tasks:
  { companyId: 1, projectId: 1, status: 1 }
```

Ces index facilitent les recherches tenant-scoped et les requêtes Kanban.

## 6. Configuration MongoDB

La connexion est fournie par :

```text
MONGO_URI
```

Exemple :

```text
mongodb://mongo:27017/saas_project
```

Le code applicatif ne dépend donc pas d'une adresse MongoDB codée en dur.

Pour une future architecture distribuée, la valeur peut devenir une chaîne de connexion de replica set ou de cluster/sharded MongoDB sans modifier la logique métier.

## 7. Architecture logicielle

```text
+---------------------------+
|       Navigateur          |
| HTML / CSS / JavaScript   |
+-------------+-------------+
              |
              | HTTP / JSON
              v
+---------------------------+
|       Express API         |
| Auth JWT                  |
| Règles multi-tenant       |
| Validation métier         |
+-------------+-------------+
              |
              | Mongoose
              v
+---------------------------+
|         MongoDB           |
| companies                 |
| users                     |
| projects                  |
| tasks                     |
+---------------------------+
```

## 8. Docker

Deux services sont définis :
- `app` : Node.js + Express ;
- `mongo` : MongoDB 7.

Un volume Docker persistant est associé à MongoDB.

L'application attend que MongoDB soit healthy avant de démarrer.

## 9. Préparation à la partie II

La contrainte importante de la partie II est anticipée grâce à :
- `MONGO_URI` externalisé ;
- absence d'adresse MongoDB imposée dans le code ;
- index tenant-scoped ;
- modèle de données compatible avec une distribution future ;
- conteneur Mongo indépendant du conteneur applicatif.

Le choix exact du shard key et de la topologie de réplication relève de la partie II et n'est donc pas imposé dans ce TD1.
