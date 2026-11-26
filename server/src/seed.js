// Prépare la base (collections, validateurs, index) puis insère les données de démonstration.
// Idempotent : le document `meta` marque la fin du seed, et chaque entreprise est insérée dans
// sa propre transaction, ce qui permet de reprendre après une interruption.
import { ObjectId } from 'mongodb';
import { hashPassword } from './auth.js';
import { config } from './config.js';
import { client, connect, withTx } from './db.js';
import { ensureSchema } from './schema.js';
import { scoped } from './scoped.js';
import { buildCompany, DEFAULT_COLUMNS, insertUser } from './services/creation.js';
import { fields } from './validation.js';

const DAY = 24 * 60 * 60 * 1000;
const GENERATED_COMPANIES = 28;

// Générateur pseudo-aléatoire à graine fixe : les mêmes données à chaque installation.
function randomGenerator(seed) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}
const random = randomGenerator(2026);
const between = (min, max) => min + Math.floor(random() * (max - min + 1));
const pick = (list) => list[Math.floor(random() * list.length)];

const FIRST_NAMES = ['Lina', 'Hugo', 'Sofia', 'Noah', 'Jade', 'Adam', 'Emma', 'Yanis', 'Léa', 'Karim', 'Inès', 'Paul'];
const LAST_NAMES = ['Durand', 'Leroy', 'Moreau', 'Simon', 'Laurent', 'Michel', 'Garcia', 'David', 'Bertrand', 'Roux'];
const COMPANY_PREFIXES = ['Nova', 'Atlas', 'Lumen', 'Orion', 'Pixel', 'Vertex', 'Cobalt'];
const COMPANY_SUFFIXES = ['Studio', 'Labs', 'Conseil', 'Digital'];
const PROJECTS = [
  { name: 'Site web', key: 'WEB', color: '#10b981', description: 'Refonte du site vitrine' },
  { name: 'Application mobile', key: 'MOB', color: '#2563eb', description: 'Première version iOS et Android' },
  { name: 'Campagne marketing', key: 'MKT', color: '#db2777', description: 'Lancement du printemps' },
  { name: 'Infrastructure', key: 'OPS', color: '#8b5cf6', description: 'Supervision et sauvegardes' },
];
const TASK_TITLES = [
  'Rédiger le cahier des charges',
  'Maquetter la page d’accueil',
  'Mettre en place l’authentification',
  'Corriger le formulaire de contact',
  'Préparer la démonstration client',
  'Écrire les tests de bout en bout',
  'Optimiser le temps de chargement',
  'Documenter l’API',
  'Planifier la mise en production',
  'Relire les mentions légales',
  'Configurer les sauvegardes',
  'Analyser les retours utilisateurs',
];
const LABELS = ['design', 'front', 'back', 'bug', 'client', 'doc'];
const COMMENTS = ['Je m’en occupe cette semaine.', 'Première version prête, avis bienvenus.', 'Bloqué en attente du client.'];

const asciiName = (value) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

function demoCompanies() {
  const fixed = [
    {
      name: 'Acme',
      users: [
        { name: 'Alice Martin', email: 'alice@acme.test', role: 'owner' },
        { name: 'Bob Petit', email: 'bob@acme.test', role: 'admin' },
        { name: 'Chloé Bernard', email: 'chloe@acme.test', role: 'member' },
        { name: 'David Nguyen', email: 'david@acme.test', role: 'member' },
      ],
      projectCount: 3,
      tasksPerProject: [10, 16],
    },
    {
      name: 'Globex',
      users: [
        { name: 'Gina Lopez', email: 'gina@globex.test', role: 'owner' },
        { name: 'Hector Blanc', email: 'hector@globex.test', role: 'member' },
      ],
      projectCount: 2,
      tasksPerProject: [6, 10],
    },
  ];

  const generated = Array.from({ length: GENERATED_COMPANIES }, (_, i) => {
    const name = `${COMPANY_PREFIXES[i % COMPANY_PREFIXES.length]} ${COMPANY_SUFFIXES[Math.floor(i / COMPANY_PREFIXES.length)]}`;
    const domain = `${asciiName(name).replace(/\s+/g, '-')}.test`;
    const users = Array.from({ length: between(2, 8) }, (_, index) => {
      const first = pick(FIRST_NAMES);
      return {
        name: `${first} ${pick(LAST_NAMES)}`,
        email: `${asciiName(first)}.${index + 1}@${domain}`,
        role: index === 0 ? 'owner' : index === 1 ? 'admin' : 'member',
      };
    });
    return { name, users, projectCount: between(1, 4), tasksPerProject: [4, 20] };
  });

  return [...fixed, ...generated];
}

async function insertCompany(db, definition, passwordHash) {
  // L'e-mail du propriétaire identifie une entreprise déjà insérée.
  if (await db.collection('accounts').findOne({ _id: definition.users[0].email })) return false;

  // Les données sont préparées hors transaction : une relance réinsère exactement les mêmes.
  const companyId = new ObjectId();
  const tenant = scoped(db, companyId);
  const now = Date.now();
  const users = definition.users.map((user) => ({
    ...user,
    email: fields.email.parse(user.email),
    _id: new ObjectId(),
    passwordHash,
  }));
  const projects = [];
  const tasks = [];
  const comments = [];
  const activities = [];

  for (const template of PROJECTS.slice(0, definition.projectCount)) {
    const projectId = new ObjectId();
    const createdAt = new Date(now - between(30, 90) * DAY);
    const taskCount = between(...definition.tasksPerProject);
    const positions = {};

    for (let number = 1; number <= taskCount; number += 1) {
      const taskId = new ObjectId();
      const column = pick(DEFAULT_COLUMNS);
      const author = pick(users);
      const taskDate = new Date(now - between(1, 29) * DAY);
      const title = pick(TASK_TITLES);
      positions[column.key] = (positions[column.key] ?? 0) + 1024;
      tasks.push({
        _id: taskId,
        projectId,
        number,
        title,
        description: random() < 0.5 ? 'Détails à préciser avec l’équipe.' : '',
        status: column.key,
        position: positions[column.key],
        priority: pick(['low', 'medium', 'medium', 'high', 'urgent']),
        assigneeId: random() < 0.8 ? pick(users)._id : null,
        dueDate: random() < 0.6 ? new Date(Math.floor(now / DAY + between(-10, 30)) * DAY) : null,
        labels: random() < 0.6 ? [pick(LABELS)] : [],
        checklist:
          random() < 0.3
            ? [
                { id: 'c1', text: 'Préparer', done: true },
                { id: 'c2', text: 'Valider', done: column.isDone },
              ]
            : [],
        createdBy: author._id,
        createdAt: taskDate,
        updatedAt: taskDate,
        completedAt: column.isDone ? new Date() : null,
      });
      activities.push({
        projectId,
        taskId,
        actorId: author._id,
        type: 'task.created',
        data: { number, title },
        createdAt: taskDate,
      });
      if (random() < 0.25) {
        comments.push({
          projectId,
          taskId,
          authorId: pick(users)._id,
          body: pick(COMMENTS),
          createdAt: new Date(taskDate.getTime() + DAY / 2),
          editedAt: null,
        });
      }
    }

    projects.push({
      _id: projectId,
      ...template,
      archived: false,
      // Tous les utilisateurs de l'entreprise sont membres, sauf David chez Acme sur « OPS » et « MKT ».
      members: users
        .filter((user) => !(user.email === 'david@acme.test' && template.key !== 'WEB'))
        .map((user) => ({ userId: user._id, addedAt: createdAt })),
      columns: DEFAULT_COLUMNS,
      taskCounter: taskCount,
      rev: 0,
      createdBy: users[0]._id,
      createdAt,
      updatedAt: createdAt,
    });
  }

  // Un assigné doit être membre de son projet (RG-05).
  for (const task of tasks) {
    const project = projects.find((p) => p._id.equals(task.projectId));
    if (task.assigneeId && !project.members.some((m) => m.userId.equals(task.assigneeId))) task.assigneeId = null;
  }

  await withTx(async (session) => {
    for (const user of users) await insertUser(tenant, user, session);
    await db
      .collection('companies')
      .insertOne(buildCompany({ _id: companyId, name: definition.name, ownerId: users[0]._id }), { session });
    await tenant.projects.insertMany(projects, { session });
    await tenant.tasks.insertMany(tasks, { session });
    await tenant.activities.insertMany(activities, { session });
    if (comments.length) await tenant.comments.insertMany(comments, { session });
  });
  return true;
}

const db = await connect();
try {
  await ensureSchema(db);
  console.log('Collections, validateurs et index en place');

  if (!config.seedEnabled) {
    console.log('SEED_ENABLED ne vaut pas "true" : aucune donnée de démonstration');
  } else if (await db.collection('meta').findOne({ _id: 'seed' })) {
    console.log('Données de démonstration déjà présentes : rien à faire');
  } else {
    // Un seul hachage pour tous les comptes de démonstration : le seed reste rapide.
    const passwordHash = await hashPassword(fields.password.parse(config.seedPassword));
    let inserted = 0;
    for (const definition of demoCompanies()) {
      if (await insertCompany(db, definition, passwordHash)) inserted += 1;
    }
    await db.collection('meta').insertOne({ _id: 'seed', version: 1, insertedAt: new Date() });
    console.log(`Données de démonstration insérées : ${inserted} entreprises`);
  }
} finally {
  await client.close();
}
