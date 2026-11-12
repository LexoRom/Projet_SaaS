# Tests manuels — TD1

## Test 1 — Démarrage

```bash
docker compose up -d --build
```

Attendu : les deux conteneurs démarrent et passent à l'état `healthy`.

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
- après création d'une seconde entreprise avec les mêmes identifiants, choisir le bon nom d'entreprise à la connexion.

## Test 4b — Entreprise supplémentaire

Depuis une session administrateur, cliquer « Nouvelle entreprise », créer son compte administrateur puis se déconnecter/reconnecter.

Attendu : la nouvelle entreprise et l'entreprise initiale existent toujours; l'email et le mot de passe permettent d'entrer dans le bon tenant avec son nom.

## Test 5 — Utilisateur

Créer un utilisateur depuis « Utilisateurs ».

Attendu :
- utilisateur visible ;
- email unique dans l'entreprise.
- modifier son nom, son email, son rôle ou son mot de passe ;
- supprimer l'utilisateur et vérifier qu'il est retiré des projets et désassigné des tâches.

## Test 6 — Projet

Créer un projet et lui affecter un ou plusieurs utilisateurs.

Attendu :
- projet visible ;
- membres enregistrés.
- modifier le nom, la description et la liste des membres.

## Test 7 — Tâche

Créer une tâche et l'affecter à plusieurs membres du projet en maintenant `Ctrl` pendant les clics.

Attendu :
- tâche visible dans « À faire » avec tous ses assignés ;
- modifier son titre, sa description, son membre assigné, sa priorité, son échéance et son statut.

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

## Test 13 — Entreprise

Modifier le nom de l'entreprise depuis le bouton « Entreprise ».

Attendu : le nouveau nom apparaît dans l'en-tête. Pour vérifier la suppression en fin de session, utiliser « Supprimer l'entreprise » et saisir son nom complet.

Attendu : les données du tenant sont supprimées et l'écran de première installation réapparaît.

## Test 14 — Recherche et assignation multiple

Dans le tableau, rechercher une tâche, filtrer par priorité/échéance, activer « Mes tâches », puis effacer les filtres. Créer une tâche avec le bouton `+` d'une colonne et choisir plusieurs assignés en cochant leurs noms.

Attendu : les filtres se combinent, l'ajout rapide reprend le statut de la colonne, et toutes les personnes assignées apparaissent sur la carte.
