// Tests de bout en bout contre la pile démarrée.
//   node --test tests/api.test.mjs
// Ils créent leurs propres entreprises et les suppriment à la fin.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, test } from 'node:test';

const BASE = process.env.BASE_URL ?? 'http://localhost:8080';
const run = randomBytes(4).toString('hex');
const password = `Test-${randomBytes(9).toString('hex')}`;
const email = (name) => `${name}-${run}@tests.test`;

/** Un client conserve son propre cookie de session. */
function createClient() {
  let cookie = '';
  const call = async (method, path, body) => {
    const response = await fetch(`${BASE}/api${path}`, {
      method,
      headers: { ...(body && { 'Content-Type': 'application/json' }), ...(cookie && { Cookie: cookie }) },
      body: body && JSON.stringify(body),
    });
    const set = response.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null, setCookie: set };
  };
  /** Appelle l'API et vérifie le code HTTP ; renvoie le corps. */
  call.expect = async (status, method, path, body) => {
    const result = await call(method, path, body);
    assert.equal(result.status, status, `${method} ${path} -> ${result.status} ${JSON.stringify(result.body)}`);
    return result.body;
  };
  return call;
}

async function register(label) {
  const api = createClient();
  const created = await api.expect(201, 'POST', '/auth/register', {
    companyName: `Société ${label} ${run}`,
    name: `Propriétaire ${label}`,
    email: email(`owner-${label}`),
    password,
  });
  return { api, ...created };
}

async function addUser(company, label, role = 'member') {
  const user = await company.api.expect(201, 'POST', '/users', {
    name: `Utilisateur ${label}`,
    email: email(label),
    role,
    password,
  });
  const api = createClient();
  await api.expect(200, 'POST', '/auth/login', { email: user.email, password });
  return { ...user, api };
}

const columnTasks = async (api, projectId, status) =>
  (await api.expect(200, 'GET', `/projects/${projectId}/tasks`))
    .filter((task) => task.status === status)
    .sort((a, b) => a.position - b.position);

let A;
let B;
let bUser;
let bProject;
let bTask;
let bComment;
const cleanup = [];

before(async () => {
  A = await register('a');
  B = await register('b');
  cleanup.push(A, B);
  bUser = await addUser(B, 'membre-b');
  bProject = await B.api.expect(201, 'POST', '/projects', { name: 'Secret B', key: 'SEC' });
  bTask = await B.api.expect(201, 'POST', `/projects/${bProject._id}/tasks`, { title: 'Confidentiel B' });
  bComment = await B.api.expect(201, 'POST', `/tasks/${bTask._id}/comments`, { body: 'Note interne B' });
});

after(async () => {
  for (const company of cleanup) {
    await company.api('DELETE', '/company', { confirmName: company.company.name });
  }
});

describe('authentification', () => {
  test('le cookie de session est httpOnly et SameSite=Strict', async () => {
    const result = await createClient()('POST', '/auth/login', { email: A.user.email, password });
    assert.equal(result.status, 200);
    assert.match(result.setCookie, /HttpOnly/i);
    assert.match(result.setCookie, /SameSite=Strict/i);
    assert.equal(JSON.stringify(result.body).includes('passwordHash'), false);
  });

  test('refuse les accès anonymes, mauvais mots de passe et injections d’opérateurs', async () => {
    const anonymous = createClient();
    for (const path of ['/auth/me', '/projects', '/users', '/company', '/dashboard', `/tasks/${bTask._id}`]) {
      await anonymous.expect(401, 'GET', path);
    }
    await anonymous.expect(401, 'POST', '/auth/login', { email: A.user.email, password: 'mauvais-mot-de-passe' });
    await anonymous.expect(400, 'POST', '/auth/login', { email: { $ne: null }, password: { $ne: null } });
  });

  test('l’e-mail est unique sur la plateforme, sans tenir compte de la casse (RG-01)', async () => {
    await createClient().expect(409, 'POST', '/auth/register', {
      companyName: 'Doublon',
      name: 'Doublon',
      email: B.user.email.toUpperCase(),
      password,
    });
    await A.api.expect(409, 'POST', '/users', { name: 'X', email: bUser.email, role: 'member', password });
  });
});

describe('isolation entre entreprises', () => {
  test('toute ressource d’une autre entreprise répond 404', async () => {
    const p = bProject._id;
    const t = bTask._id;
    const attempts = [
      ['GET', `/projects/${p}`],
      ['PATCH', `/projects/${p}`, { name: 'Piraté' }],
      ['DELETE', `/projects/${p}`],
      ['GET', `/projects/${p}/tasks`],
      ['POST', `/projects/${p}/tasks`, { title: 'Intrusion' }],
      ['GET', `/projects/${p}/activity`],
      ['POST', `/projects/${p}/members`, { userId: A.user._id }],
      ['DELETE', `/projects/${p}/members/${B.user._id}`],
      ['PUT', `/projects/${p}/columns`, { columns: [{ name: 'a', isDone: false }, { name: 'b', isDone: true }] }],
      ['GET', `/tasks/${t}`],
      ['PATCH', `/tasks/${t}`, { title: 'Piraté' }],
      ['POST', `/tasks/${t}/move`, { status: 'done', afterId: null }],
      ['DELETE', `/tasks/${t}`],
      ['POST', `/tasks/${t}/comments`, { body: 'Intrusion' }],
      ['PATCH', `/comments/${bComment._id}`, { body: 'Piraté' }],
      ['DELETE', `/comments/${bComment._id}`],
      ['PATCH', `/users/${bUser._id}`, { name: 'Piraté' }],
      ['DELETE', `/users/${bUser._id}`],
      ['POST', '/company/transfer', { userId: bUser._id }],
    ];
    for (const [method, path, body] of attempts) await A.api.expect(404, method, path, body);

    // Rien n'a changé du côté de B.
    const untouched = await B.api.expect(200, 'GET', `/tasks/${t}`);
    assert.equal(untouched.task.title, 'Confidentiel B');
    assert.equal(untouched.task.status, 'todo');
    assert.equal(untouched.comments[0].body, 'Note interne B');
    assert.equal((await B.api.expect(200, 'GET', `/projects/${p}`)).name, 'Secret B');
  });

  test('les listes et le tableau de bord ne montrent que sa propre entreprise', async () => {
    const users = await A.api.expect(200, 'GET', '/users');
    assert.equal(users.some((u) => u.email.includes('membre-b') || u._id === B.user._id), false);
    const searched = await A.api.expect(200, 'GET', `/users?q=${encodeURIComponent(bUser.email)}`);
    assert.deepEqual(searched, []);
    assert.deepEqual(await A.api.expect(200, 'GET', '/projects'), []);
    const dashboard = await A.api.expect(200, 'GET', '/dashboard');
    assert.deepEqual(dashboard.projects, []);
    assert.deepEqual(dashboard.overdue, []);
  });

  test('on ne peut pas relier des objets de deux entreprises', async () => {
    const project = await A.api.expect(201, 'POST', '/projects', { name: 'Liens', key: 'LIE' });
    await A.api.expect(404, 'POST', `/projects/${project._id}/members`, { userId: bUser._id });
    await A.api.expect(404, 'POST', `/projects/${project._id}/tasks`, { title: 'x', assigneeId: bUser._id });
    const task = await A.api.expect(201, 'POST', `/projects/${project._id}/tasks`, { title: 'x' });
    await A.api.expect(404, 'PATCH', `/tasks/${task._id}`, { assigneeId: bUser._id });
  });

  test('un companyId envoyé par le client est ignoré', async () => {
    const project = await A.api.expect(201, 'POST', '/projects', {
      name: 'Injection',
      key: 'INJ',
      companyId: B.company._id,
    });
    await B.api.expect(404, 'GET', `/projects/${project._id}`);
    await A.api.expect(200, 'PATCH', `/projects/${project._id}`, { name: 'Injection 2', companyId: B.company._id });
    await B.api.expect(404, 'GET', `/projects/${project._id}`);
    await A.api.expect(200, 'GET', `/projects/${project._id}`);
  });

  test('deux entreprises peuvent utiliser la même clé de projet', async () => {
    await A.api.expect(201, 'POST', '/projects', { name: 'Même clé', key: 'SEC' });
  });
});

describe('rôles', () => {
  let member;
  let admin;
  let visible;
  let hidden;

  before(async () => {
    member = await addUser(A, 'membre-roles');
    admin = await addUser(A, 'admin-roles', 'admin');
    visible = await A.api.expect(201, 'POST', '/projects', { name: 'Visible', key: 'VIS' });
    hidden = await A.api.expect(201, 'POST', '/projects', { name: 'Caché', key: 'CAC' });
    await A.api.expect(201, 'POST', `/projects/${visible._id}/members`, { userId: member._id });
  });

  test('un membre ne voit que ses projets et ne les administre pas', async () => {
    const projects = await member.api.expect(200, 'GET', '/projects');
    assert.deepEqual(projects.map((p) => p._id), [visible._id]);
    await member.api.expect(404, 'GET', `/projects/${hidden._id}`);
    const secret = await A.api.expect(201, 'POST', `/projects/${hidden._id}/tasks`, { title: 'caché' });
    await member.api.expect(404, 'GET', `/tasks/${secret._id}`);

    await member.api.expect(403, 'POST', '/projects', { name: 'x', key: 'XX' });
    await member.api.expect(403, 'PATCH', `/projects/${visible._id}`, { name: 'x' });
    await member.api.expect(403, 'DELETE', `/projects/${visible._id}`);
    await member.api.expect(403, 'POST', `/projects/${visible._id}/members`, { userId: admin._id });
    await member.api.expect(403, 'POST', '/users', { name: 'x', email: email('x'), role: 'member', password });
    await member.api.expect(403, 'DELETE', `/users/${admin._id}`);
    await member.api.expect(403, 'PATCH', '/company', { name: 'x' });
    await member.api.expect(403, 'DELETE', '/company', { confirmName: A.company.name });
  });

  test('un membre supprime ses tâches, pas celles des autres, et ne modifie que ses commentaires', async () => {
    const own = await member.api.expect(201, 'POST', `/projects/${visible._id}/tasks`, { title: 'à moi' });
    const other = await A.api.expect(201, 'POST', `/projects/${visible._id}/tasks`, { title: 'pas à moi' });
    await member.api.expect(403, 'DELETE', `/tasks/${other._id}`);
    await member.api.expect(204, 'DELETE', `/tasks/${own._id}`);
    const comment = await A.api.expect(201, 'POST', `/tasks/${other._id}/comments`, { body: 'owner' });
    await member.api.expect(403, 'PATCH', `/comments/${comment._id}`, { body: 'x' });
    await admin.api.expect(403, 'DELETE', `/comments/${comment._id}`);
    await A.api.expect(200, 'PATCH', `/comments/${comment._id}`, { body: 'corrigé' });
  });

  test('le propriétaire est protégé (RG-03)', async () => {
    await admin.api.expect(403, 'PATCH', `/users/${A.user._id}`, { name: 'x' });
    await admin.api.expect(403, 'DELETE', `/users/${A.user._id}`);
    await admin.api.expect(403, 'DELETE', '/company', { confirmName: A.company.name });
    await admin.api.expect(403, 'POST', '/company/transfer', { userId: admin._id });
    await admin.api.expect(400, 'PATCH', `/users/${member._id}`, { role: 'owner' });
    await admin.api.expect(400, 'DELETE', `/users/${admin._id}`);
    await A.api.expect(400, 'PATCH', `/users/${A.user._id}`, { role: 'member' });
    await A.api.expect(400, 'POST', '/company/transfer', { userId: member._id });
  });

  test('un changement de rôle et le transfert de propriété prennent effet immédiatement', async () => {
    await A.api.expect(204, 'POST', '/company/transfer', { userId: admin._id });
    assert.equal((await admin.api.expect(200, 'GET', '/auth/me')).user.role, 'owner');
    assert.equal((await A.api.expect(200, 'GET', '/auth/me')).user.role, 'admin');
    await admin.api.expect(204, 'POST', '/company/transfer', { userId: A.user._id });
    const users = await A.api.expect(200, 'GET', '/users');
    assert.equal(users.filter((u) => u.role === 'owner').length, 1);
  });

  test('changement d’e-mail : l’ancien ne fonctionne plus, le nouveau oui', async () => {
    const user = await addUser(A, 'avant-changement');
    const next = email('apres-changement');
    await user.api.expect(400, 'PATCH', '/auth/profile', { email: next });
    await user.api.expect(409, 'PATCH', '/auth/profile', { email: bUser.email, currentPassword: password });
    await user.api.expect(200, 'PATCH', '/auth/profile', { email: next, currentPassword: password });
    await createClient().expect(401, 'POST', '/auth/login', { email: user.email, password });
    await createClient().expect(200, 'POST', '/auth/login', { email: next, password });
  });

  test('un utilisateur supprimé perd sa session ; ses tâches sont désassignées (F-23)', async () => {
    const leaving = await addUser(A, 'partant');
    await A.api.expect(201, 'POST', `/projects/${visible._id}/members`, { userId: leaving._id });
    const task = await A.api.expect(201, 'POST', `/projects/${visible._id}/tasks`, {
      title: 'à réassigner',
      assigneeId: leaving._id,
    });
    await A.api.expect(204, 'DELETE', `/users/${leaving._id}`);
    await leaving.api.expect(401, 'GET', '/auth/me');
    await createClient().expect(401, 'POST', '/auth/login', { email: leaving.email, password });
    assert.equal((await A.api.expect(200, 'GET', `/tasks/${task._id}`)).task.assigneeId, null);
    const project = await A.api.expect(200, 'GET', `/projects/${visible._id}`);
    assert.equal(project.members.some((m) => m.userId === leaving._id), false);
  });
});

describe('projets, tâches et Kanban', () => {
  let project;
  before(async () => {
    project = await A.api.expect(201, 'POST', '/projects', { name: 'Kanban', key: 'KAN' });
  });

  test('numéros jamais réutilisés (RG-09) et statut contrôlé (RG-06)', async () => {
    const first = await A.api.expect(201, 'POST', `/projects/${project._id}/tasks`, { title: 'un' });
    await A.api.expect(204, 'DELETE', `/tasks/${first._id}`);
    const second = await A.api.expect(201, 'POST', `/projects/${project._id}/tasks`, { title: 'deux' });
    assert.equal(second.number, first.number + 1);
    await A.api.expect(400, 'PATCH', `/tasks/${second._id}`, { status: 'inconnu' });
    await A.api.expect(400, 'POST', `/projects/${project._id}/tasks`, { title: '' });
    await A.api.expect(400, 'PATCH', `/tasks/${second._id}`, { dueDate: '2026-13-45' });
  });

  test('déplacement, ordre, renumérotation et date de fin', async () => {
    const created = [];
    for (const title of ['a', 'b', 'c']) {
      created.push(await A.api.expect(201, 'POST', `/projects/${project._id}/tasks`, { title, status: 'review' }));
    }
    const [a, b, c] = created;
    const order = async () => (await columnTasks(A.api, project._id, 'review')).map((t) => t.title).join('');

    await A.api.expect(200, 'POST', `/tasks/${c._id}/move`, { status: 'review', afterId: a._id });
    assert.equal(await order(), 'acb');
    await A.api.expect(200, 'POST', `/tasks/${b._id}/move`, { status: 'review', afterId: null });
    assert.equal(await order(), 'bac');

    // Insertions répétées au même endroit : l'écart s'épuise et force une renumérotation.
    for (let i = 0; i < 40; i += 1) {
      const moving = i % 2 === 0 ? c : a;
      await A.api.expect(200, 'POST', `/tasks/${moving._id}/move`, { status: 'review', afterId: b._id });
    }
    assert.equal(await order(), 'bac');
    const positions = (await columnTasks(A.api, project._id, 'review')).map((t) => t.position);
    assert.equal(new Set(positions).size, 3);

    const done = await A.api.expect(200, 'POST', `/tasks/${a._id}/move`, { status: 'done', afterId: null });
    assert.ok(done.completedAt);
    const reopened = await A.api.expect(200, 'PATCH', `/tasks/${a._id}`, { status: 'todo' });
    assert.equal(reopened.completedAt, null);
  });

  test('suppression d’une colonne non vide : destination obligatoire (RG-07)', async () => {
    await A.api.expect(201, 'POST', `/projects/${project._id}/tasks`, { title: 'en cours', status: 'in_progress' });
    const columns = [
      { key: 'todo', name: 'À faire', isDone: false },
      { key: 'review', name: 'Revue', isDone: false },
      { key: 'done', name: 'Fini', isDone: true },
      { name: 'Idées', isDone: false },
    ];
    await A.api.expect(409, 'PUT', `/projects/${project._id}/columns`, { columns });
    await A.api.expect(400, 'PUT', `/projects/${project._id}/columns`, {
      columns: columns.map((c) => ({ ...c, isDone: false })),
    });
    const updated = await A.api.expect(200, 'PUT', `/projects/${project._id}/columns`, {
      columns,
      moves: { in_progress: 'todo' },
    });
    assert.equal(updated.columns.length, 4);
    const tasks = await A.api.expect(200, 'GET', `/projects/${project._id}/tasks`);
    assert.equal(tasks.some((t) => t.status === 'in_progress'), false);
    assert.ok(tasks.some((t) => t.title === 'en cours' && t.status === 'todo'));
  });

  test('retirer un membre désassigne ses tâches (RG-08)', async () => {
    const user = await addUser(A, 'retire');
    await A.api.expect(201, 'POST', `/projects/${project._id}/members`, { userId: user._id });
    const task = await A.api.expect(201, 'POST', `/projects/${project._id}/tasks`, { title: 't', assigneeId: user._id });
    await A.api.expect(204, 'DELETE', `/projects/${project._id}/members/${user._id}`);
    assert.equal((await A.api.expect(200, 'GET', `/tasks/${task._id}`)).task.assigneeId, null);
  });

  test('un projet archivé est en lecture seule (RG-10)', async () => {
    const task = await A.api.expect(201, 'POST', `/projects/${project._id}/tasks`, { title: 'figée' });
    await A.api.expect(200, 'PATCH', `/projects/${project._id}`, { archived: true });
    await A.api.expect(409, 'POST', `/projects/${project._id}/tasks`, { title: 'x' });
    await A.api.expect(409, 'PATCH', `/tasks/${task._id}`, { title: 'x' });
    await A.api.expect(409, 'POST', `/tasks/${task._id}/move`, { status: 'done', afterId: null });
    await A.api.expect(409, 'DELETE', `/tasks/${task._id}`);
    await A.api.expect(409, 'POST', `/tasks/${task._id}/comments`, { body: 'x' });
    await A.api.expect(409, 'PATCH', `/projects/${project._id}`, { name: 'x' });
    await A.api.expect(200, 'GET', `/tasks/${task._id}`);
    await A.api.expect(200, 'PATCH', `/projects/${project._id}`, { archived: false });
    await A.api.expect(200, 'PATCH', `/tasks/${task._id}`, { title: 'modifiable' });
  });

  test('supprimer un projet supprime ses tâches et commentaires (F-33)', async () => {
    const doomed = await A.api.expect(201, 'POST', '/projects', { name: 'Éphémère', key: 'EPH' });
    const task = await A.api.expect(201, 'POST', `/projects/${doomed._id}/tasks`, { title: 't' });
    await A.api.expect(201, 'POST', `/tasks/${task._id}/comments`, { body: 'c' });
    await A.api.expect(204, 'DELETE', `/projects/${doomed._id}`);
    await A.api.expect(404, 'GET', `/tasks/${task._id}`);
  });
});

describe('requêtes simultanées', () => {
  const statuses = (results) => results.map((r) => r.status).sort();

  // Une course ne se produit pas à chaque essai : on répète, avec des connexions déjà
  // ouvertes et des décalages variables entre les deux requêtes.
  const ROUNDS = 25;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const together = (first, second, round) => {
    const offset = (round % 9) - 4;
    return Promise.all([sleep(Math.max(0, offset)).then(first), sleep(Math.max(0, -offset)).then(second)]);
  };

  before(async () => {
    await Promise.all(Array.from({ length: 30 }, () => A.api('GET', '/dashboard')));
  });

  test('une seule création réussit pour une même clé de projet', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const key = `RC${String.fromCharCode(65 + round)}`;
      const results = await Promise.all(
        Array.from({ length: 6 }, (_, i) => A.api('POST', '/projects', { name: `Course ${i}`, key })),
      );
      assert.deepEqual(statuses(results), [201, 409, 409, 409, 409, 409], `tour ${round}`);
    }
  });

  test('les numéros de tâche restent uniques', async () => {
    const project = await A.api.expect(201, 'POST', '/projects', { name: 'Numéros', key: 'NUM' });
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) => A.api('POST', `/projects/${project._id}/tasks`, { title: `t${i}` })),
    );
    assert.ok(results.every((r) => r.status === 201), JSON.stringify(statuses(results)));
    assert.deepEqual(
      results.map((r) => r.body.number).sort((x, y) => x - y),
      Array.from({ length: 12 }, (_, i) => i + 1),
    );
    const positions = results.map((r) => r.body.position);
    assert.equal(new Set(positions).size, 12);
  });

  test('assigner pendant un retrait ne laisse jamais un assigné non membre (RG-05)', async () => {
    const project = await A.api.expect(201, 'POST', '/projects', { name: 'Retrait', key: 'RET' });
    const user = await addUser(A, 'course-retrait');
    for (let i = 0; i < ROUNDS; i += 1) {
      await A.api.expect(201, 'POST', `/projects/${project._id}/members`, { userId: user._id });
      const task = await A.api.expect(201, 'POST', `/projects/${project._id}/tasks`, { title: `t${i}` });
      await together(
        () => A.api('PATCH', `/tasks/${task._id}`, { assigneeId: user._id }),
        () => A.api('DELETE', `/projects/${project._id}/members/${user._id}`),
        i,
      );
      assert.equal((await A.api.expect(200, 'GET', `/tasks/${task._id}`)).task.assigneeId, null);
    }
  });

  test('ajouter au projet un utilisateur qu’on supprime ne laisse pas de membre fantôme', async () => {
    const project = await A.api.expect(201, 'POST', '/projects', { name: 'Fantôme', key: 'FAN' });
    for (let i = 0; i < 12; i += 1) {
      const user = await addUser(A, `fantome-${i}`);
      await together(
        () => A.api('POST', `/projects/${project._id}/members`, { userId: user._id }),
        () => A.api('DELETE', `/users/${user._id}`),
        i,
      );
      const current = await A.api.expect(200, 'GET', `/projects/${project._id}`);
      assert.equal(current.members.some((m) => m.userId === user._id), false);
    }
  });

  test('deux créations avec le même e-mail : une seule réussit', async () => {
    const body = { name: 'Jumeau', email: email('jumeau'), role: 'member', password };
    const results = await Promise.all([A.api('POST', '/users', body), B.api('POST', '/users', body)]);
    assert.deepEqual(statuses(results), [201, 409]);
  });
});

describe('suppression d’une entreprise', () => {
  test('exige le nom exact puis ferme tous les accès (F-11)', async () => {
    const doomed = await register('ephemere');
    const user = await addUser(doomed, 'membre-ephemere');
    await doomed.api.expect(400, 'DELETE', '/company', { confirmName: 'mauvais nom' });
    await doomed.api.expect(204, 'DELETE', '/company', { confirmName: doomed.company.name });
    await user.api.expect(401, 'GET', '/auth/me');
    await createClient().expect(401, 'POST', '/auth/login', { email: doomed.user.email, password });
    await createClient().expect(401, 'POST', '/auth/login', { email: user.email, password });
  });
});
