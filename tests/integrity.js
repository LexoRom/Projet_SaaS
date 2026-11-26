// Cherche les incohérences directement dans la base (MongoDB n'a pas de clés étrangères).
//   docker compose cp tests/integrity.js mongo:/tmp/integrity.js
//   docker compose exec mongo mongosh --quiet taskflow /tmp/integrity.js
(() => {
  const ids = (docs) => new Set(docs.map((d) => String(d._id)));
  const companies = ids(db.companies.find({}, { _id: 1 }).toArray());
  const users = db.users.find().toArray();
  const projects = db.projects.find().toArray();
  const tasks = db.tasks.find().toArray();
  const userById = new Map(users.map((u) => [String(u._id), u]));
  const projectById = new Map(projects.map((p) => [String(p._id), p]));
  const taskById = new Map(tasks.map((t) => [String(t._id), t]));
  const accounts = db.accounts.find().toArray();
  const same = (a, b) => a && b && String(a.companyId) === String(b.companyId);
  const duplicates = (values) => values.length - new Set(values).size;

  const problems = {
    'documents sans entreprise': ['accounts', 'users', 'projects', 'tasks', 'comments', 'activities']
      .flatMap((name) => db.getCollection(name).find({}, { companyId: 1 }).toArray())
      .filter((d) => !companies.has(String(d.companyId))).length,
    'comptes sans utilisateur cohérent': accounts.filter((a) => {
      const u = userById.get(String(a.userId));
      return !same(a, u) || u.email !== a._id;
    }).length,
    'utilisateurs sans compte unique': users.filter(
      (u) => accounts.filter((a) => String(a.userId) === String(u._id)).length !== 1,
    ).length,
    'entreprises sans exactement un propriétaire': db.companies.find().toArray().filter((c) => {
      const owners = users.filter((u) => String(u.companyId) === String(c._id) && u.role === 'owner');
      return owners.length !== 1 || String(owners[0]._id) !== String(c.ownerId);
    }).length,
    'membres inconnus ou d’une autre entreprise': projects
      .flatMap((p) => p.members.map((m) => [p, userById.get(String(m.userId))]))
      .filter(([p, u]) => !same(p, u)).length,
    'tâches sans projet de la même entreprise': tasks.filter((t) => !same(t, projectById.get(String(t.projectId)))).length,
    // Pas de chaînage `?.` ici : mongosh le réécrit mal lorsqu'il précède un appel de méthode.
    'assignés non membres du projet': tasks.filter((t) => {
      const project = projectById.get(String(t.projectId)) || { members: [] };
      return t.assigneeId && !project.members.some((m) => String(m.userId) === String(t.assigneeId));
    }).length,
    'statuts hors des colonnes': tasks.filter((t) => {
      const project = projectById.get(String(t.projectId)) || { columns: [] };
      return !project.columns.some((c) => c.key === t.status);
    }).length,
    'clés de projet en double': duplicates(projects.map((p) => `${p.companyId}:${p.key}`)),
    'numéros de tâche en double': duplicates(tasks.map((t) => `${t.projectId}:${t.number}`)),
    'commentaires orphelins': db.comments.find().toArray().filter((c) => !same(c, taskById.get(String(c.taskId)))).length,
  };

  printjson({
    volumes: {
      entreprises: companies.size,
      utilisateurs: users.length,
      projets: projects.length,
      taches: tasks.length,
      commentaires: db.comments.countDocuments(),
    },
    problems,
  });
  const total = Object.values(problems).reduce((sum, n) => sum + n, 0);
  print(total === 0 ? 'INTEGRITE OK' : `INCOHERENCES : ${total}`);
})();
