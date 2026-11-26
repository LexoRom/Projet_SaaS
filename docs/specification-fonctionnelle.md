# Regestion : spécification fonctionnelle

> Partie I · Outil de gestion de projet SaaS multi-entreprises
> Version 1.0 (conforme à l'implémentation de la partie I) · 26/11/2026

## 1. Objet

Regestion est une application web de gestion de projet en mode SaaS, inspirée de Trello, Notion et ClickUp. Une même instance héberge plusieurs **entreprises clientes** (les *tenants*). Chaque entreprise gère ses utilisateurs, ses projets et ses tâches, et ne voit jamais les données d'une autre entreprise.

## 2. Acteurs et rôles

Chaque utilisateur appartient à **une seule** entreprise et y possède un rôle.

| Rôle | Description |
|---|---|
| Propriétaire (`owner`) | Crée l'entreprise à l'inscription. A tous les droits, dont la suppression de l'entreprise. |
| Administrateur (`admin`) | Gère les utilisateurs et tous les projets de l'entreprise. |
| Membre (`member`) | Travaille sur les projets auxquels il est affecté. |

### Matrice des droits

| Action | owner | admin | member |
|---|:-:|:-:|:-:|
| Modifier les informations de l'entreprise | ✅ | ✅ | ❌ |
| Supprimer l'entreprise | ✅ | ❌ | ❌ |
| Créer, modifier, supprimer un utilisateur | ✅ | ✅ ¹ | ❌ |
| Consulter l'annuaire de l'entreprise | ✅ | ✅ | ✅ |
| Créer un projet | ✅ | ✅ | ❌ |
| Modifier, archiver, supprimer un projet ; gérer ses membres et ses colonnes | ✅ | ✅ | ❌ |
| Voir un projet et son Kanban | tous | tous | s'il en est membre |
| Créer, modifier, déplacer une tâche | ✅ | ✅ | s'il est membre du projet |
| Supprimer une tâche | ✅ | ✅ | s'il en est l'auteur |
| Commenter une tâche | ✅ | ✅ | s'il est membre du projet |
| Modifier son profil et son mot de passe | ✅ | ✅ | ✅ |

¹ Un administrateur ne peut ni modifier ni supprimer le propriétaire, ni promouvoir quelqu'un propriétaire.

## 3. Fonctionnalités

### 3.1 Inscription et authentification

| Id | Fonctionnalité |
|---|---|
| F-01 | **Inscription** : un visiteur saisit le nom de son entreprise, son nom, son e-mail et un mot de passe. L'application crée l'entreprise et son compte propriétaire. |
| F-02 | **Connexion** par e-mail et mot de passe ; **déconnexion**. |
| F-03 | **Profil** : modifier son nom, son e-mail et son mot de passe (l'ancien mot de passe est demandé). |

### 3.2 Entreprise

| Id | Fonctionnalité |
|---|---|
| F-10 | Consulter et modifier l'entreprise : nom, couleur, fuseau horaire. |
| F-11 | **Supprimer l'entreprise** (propriétaire uniquement). L'utilisateur doit retaper le nom de l'entreprise pour confirmer. Toutes les données de l'entreprise sont supprimées définitivement. |

### 3.3 Utilisateurs

| Id | Fonctionnalité |
|---|---|
| F-20 | Lister les utilisateurs de l'entreprise, avec recherche par nom ou e-mail. |
| F-21 | **Créer un utilisateur** : nom, e-mail, rôle et mot de passe initial. Il n'y a pas d'envoi d'e-mail ; l'administrateur communique le mot de passe. |
| F-22 | Modifier le nom, l'e-mail ou le rôle d'un utilisateur. |
| F-23 | **Supprimer un utilisateur** : il est retiré de ses projets et ses tâches deviennent « non assignées ». |

### 3.4 Projets

| Id | Fonctionnalité |
|---|---|
| F-30 | Lister les projets : tous pour les owner et admin, ceux dont il est membre pour un member. |
| F-31 | **Créer un projet** : nom, clé courte (ex. `WEB`), description, couleur. La clé n'est plus modifiable ensuite. Le créateur devient membre. Le projet reçoit des colonnes par défaut : *À faire*, *En cours*, *En revue*, *Terminé*. |
| F-32 | Modifier un projet ; l'**archiver** (lecture seule, masqué par défaut) ou le restaurer. |
| F-33 | **Supprimer un projet**, avec ses tâches, commentaires et historique. |
| F-34 | **Gérer les membres** : ajouter ou retirer des utilisateurs de l'entreprise. |
| F-35 | **Personnaliser les colonnes** du Kanban : ajouter, renommer, réordonner, supprimer, et désigner la colonne « terminé ». |

### 3.5 Tâches

| Id | Fonctionnalité |
|---|---|
| F-40 | **Créer une tâche** dans un projet. Elle reçoit un identifiant lisible (`WEB-12`). |
| F-41 | Champs : titre, description, **statut** (une colonne du projet), **assigné**, priorité (basse, moyenne, haute, urgente), date d'échéance, étiquettes, checklist. |
| F-42 | **Assigner** une tâche à un membre du projet ou la désassigner. |
| F-43 | Modifier une tâche ; la supprimer. |
| F-44 | Cocher les éléments de la checklist ; la progression s'affiche sur la carte. |

### 3.6 Tableau Kanban

| Id | Fonctionnalité |
|---|---|
| F-50 | Afficher les tâches d'un projet en colonnes, une colonne par statut. |
| F-51 | **Glisser-déposer** une carte pour changer son statut ou son ordre dans la colonne. |
| F-52 | Filtrer par assigné, priorité ou étiquette ; filtre « mes tâches » ; recherche dans le titre. |
| F-53 | Chaque carte montre l'identifiant, le titre, l'assigné, la priorité, l'échéance (en rouge si dépassée) et la checklist. |

### 3.7 Collaboration (fonctionnalités ajoutées)

| Id | Fonctionnalité |
|---|---|
| F-60 | **Commentaires** sur une tâche ; l'auteur peut modifier ou supprimer les siens. |
| F-61 | **Historique d'activité** par tâche et par projet : création, changement de statut, assignation, commentaire. |
| F-62 | **Tableau de bord** : mes tâches ouvertes, tâches en retard, répartition des tâches par statut pour chaque projet. |

## 4. Isolation entre entreprises

L'isolation est l'exigence centrale du produit.

- Un utilisateur ne voit et ne modifie que les données de **son** entreprise.
- L'entreprise courante est toujours déduite de la **session** de l'utilisateur, jamais d'un paramètre qu'il envoie.
- Une ressource d'une autre entreprise se comporte comme si elle **n'existait pas** : l'API répond 404, sans révéler son existence.
- On ne peut pas lier deux objets de deux entreprises différentes, par exemple ajouter à un projet un utilisateur d'une autre entreprise.

## 5. Règles de gestion

| Id | Règle |
|---|---|
| RG-01 | Une adresse e-mail est unique sur toute la plateforme, sans tenir compte de la casse. |
| RG-02 | Un utilisateur appartient à une seule entreprise. |
| RG-03 | Une entreprise a toujours exactement un propriétaire. Il ne peut pas être supprimé ; il peut transférer ce rôle à un administrateur. |
| RG-04 | Une tâche appartient à un seul projet et ne change pas de projet. |
| RG-05 | L'assigné d'une tâche est un membre du projet, ou personne. |
| RG-06 | Le statut d'une tâche est l'une des colonnes de son projet. |
| RG-07 | Une colonne qui contient des tâches ne peut être supprimée qu'en choisissant une colonne de destination pour ces tâches. |
| RG-08 | Retirer un membre d'un projet désassigne ses tâches dans ce projet. |
| RG-09 | La clé d'un projet (2 à 6 lettres majuscules) est unique dans l'entreprise. Les numéros de tâche sont uniques dans le projet et jamais réutilisés. |
| RG-10 | Un projet archivé est en lecture seule. |
| RG-11 | Un mot de passe contient au moins 8 caractères. Il est stocké haché, jamais en clair. |
| RG-12 | Les suppressions sont définitives. L'application demande une confirmation avant chacune. |

## 6. Parcours type

1. Alice inscrit l'entreprise **Acme** ; elle en devient propriétaire.
2. Elle crée deux utilisateurs, Bob (admin) et Chloé (member).
3. Bob crée le projet **Site web** (clé `WEB`) et y ajoute Chloé.
4. Bob crée la tâche `WEB-1` « Maquette de l'accueil » et l'assigne à Chloé.
5. Chloé se connecte et voit la tâche dans son tableau de bord. Elle la glisse dans *En cours*, puis la commente.
6. Un utilisateur de l'entreprise **Globex** ne voit ni Acme, ni ses projets, ni ses tâches.

## 7. Hors périmètre

- Envoi d'e-mails (invitations, réinitialisation de mot de passe).
- Utilisateur membre de plusieurs entreprises.
- Mise à jour en temps réel entre navigateurs : il faut rafraîchir la page.
- Pièces jointes et facturation.

## 8. Données de démonstration

Au premier démarrage, l'application insère automatiquement des données de test : plusieurs entreprises avec leurs utilisateurs, projets, tâches et commentaires. Le README donne les comptes de démonstration. Leur mot de passe est défini dans le fichier de configuration (`SEED_DEMO_PASSWORD`).
