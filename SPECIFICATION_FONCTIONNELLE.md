# Spécification fonctionnelle — TD1

## 1. Objet

L'application est un outil SaaS de gestion de projet destiné aux entreprises. Elle reprend le principe général d'outils comme Trello, Notion ou ClickUp.

## 2. Acteurs

### Administrateur
- Administrer les utilisateurs de son entreprise.
- Créer et gérer les projets.
- Affecter les utilisateurs aux projets.
- Créer, modifier et supprimer les tâches.
- Affecter les tâches aux membres d'un projet.

### Membre
- Se connecter.
- Consulter les projets accessibles dans son entreprise.
- Consulter le Kanban.
- Créer des projets et des tâches dans le périmètre de son entreprise.
- Déplacer les tâches entre les statuts.

## 3. Gestion des entreprises

Une entreprise constitue un tenant logiciel.

Une entreprise possède :
- un nom ;
- une liste d'utilisateurs ;
- une liste de projets.

Les données d'une entreprise ne doivent jamais être accessibles à une autre entreprise.

## 4. Gestion des utilisateurs

Un utilisateur possède :
- nom ;
- email ;
- mot de passe ;
- rôle (`admin` ou `member`) ;
- entreprise de rattachement.

Un email est unique dans une entreprise.

## 5. Gestion des projets

Un projet appartient obligatoirement à une entreprise.

Un projet possède :
- nom ;
- description ;
- membres ;
- date de création.

Un utilisateur ne peut être ajouté à un projet que s'il appartient à la même entreprise.

## 6. Gestion des tâches

Une tâche appartient à un seul projet et donc indirectement à une entreprise.

Une tâche possède :
- titre ;
- description ;
- statut ;
- priorité ;
- date d'échéance facultative ;
- utilisateur assigné facultatif ;
- dates de création et modification.

Les statuts sont :
- `todo` : À faire ;
- `doing` : En cours ;
- `done` : Terminé.

L'utilisateur assigné doit :
1. appartenir à la même entreprise ;
2. être membre du projet.

## 7. Kanban

Le tableau Kanban affiche trois colonnes :
- À faire ;
- En cours ;
- Terminé.

Le déplacement d'une tâche dans une colonne met à jour son champ `status`.

## 8. Authentification

L'utilisateur se connecte avec email et mot de passe.

Après connexion, le serveur fournit un JWT contenant :
- identifiant utilisateur ;
- identifiant entreprise ;
- rôle.

Le serveur utilise ces informations pour déterminer le tenant courant.

## 9. Isolation SaaS

L'isolation est une exigence fonctionnelle et technique centrale.

Le client ne choisit jamais le `companyId` utilisé pour les recherches sensibles. Le backend le récupère du JWT.

Toute requête de ressource est donc contrainte par le tenant.

## 10. Démarrage

L'application doit être entièrement démarrable avec :

```bash
docker compose up -d --build
```

Aucune installation manuelle de Node.js, MongoDB ou des dépendances n'est requise.

## 11. Fonctionnalités complémentaires

Le projet ajoute :
- priorité des tâches ;
- échéance ;
- rôles administrateur/membre ;
- suppression en cascade des tâches lors de la suppression d'un projet ;
- désassignation automatique d'un utilisateur supprimé.
