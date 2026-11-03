# Tests manuels — TD1

## Test 1 — Démarrage

```bash
docker compose up -d --build
```

Attendu : les deux conteneurs démarrent.

## Test 2 — Santé

```text
GET http://localhost:3000/api/health
```

Attendu :

```json
{"status":"ok","mongo":true}
```

## Test 3 — Première entreprise

Créer une entreprise depuis l'onglet « Première installation ».

Attendu :
- création de l'entreprise ;
- création de son administrateur ;
- impossibilité de refaire le bootstrap.

## Test 4 — Connexion

Se connecter avec le compte créé.

Attendu :
- réception d'un JWT ;
- accès au tableau de bord.

## Test 5 — Utilisateur

Créer un utilisateur depuis « Utilisateurs ».

Attendu :
- utilisateur visible ;
- email unique dans l'entreprise.

## Test 6 — Projet

Créer un projet et lui affecter un ou plusieurs utilisateurs.

Attendu :
- projet visible ;
- membres enregistrés.

## Test 7 — Tâche

Créer une tâche et l'affecter à un membre du projet.

Attendu :
- tâche visible dans « À faire ».

## Test 8 — Kanban

Glisser la tâche de « À faire » vers « En cours », puis « Terminé ».

Attendu :
- le champ `status` est mis à jour.

## Test 9 — Isolation

Créer une seconde entreprise dans une nouvelle base ou après remise à zéro du volume, puis vérifier que les requêtes d'un tenant ne renvoient jamais les ressources d'un autre.

Le backend protège notamment les accès par :

```text
{ _id: resourceId, companyId: req.auth.companyId }
```

## Test 10 — Assignation interdite

Tenter d'affecter à une tâche un utilisateur qui n'est pas membre du projet.

Attendu :

```text
400 — Assignation interdite
```

## Test 11 — Suppression d'un projet

Supprimer un projet.

Attendu :
- projet supprimé ;
- tâches du projet supprimées.

## Test 12 — Arrêt

```bash
docker compose down
```

Puis :

```bash
docker compose up -d
```

Attendu : les données MongoDB sont conservées grâce au volume.
