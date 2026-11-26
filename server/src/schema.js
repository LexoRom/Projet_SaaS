// Collections, validateurs $jsonSchema et index.
// Aucun index unique en dehors de `_id` : un tel index empêcherait le sharding de la partie II.

const string = (minLength = 0, maxLength) => ({ bsonType: 'string', minLength, ...(maxLength && { maxLength }) });
const objectId = { bsonType: 'objectId' };
const date = { bsonType: 'date' };
const bool = { bsonType: 'bool' };
const int = { bsonType: 'int' };
const nullable = (type) => ({ bsonType: [type, 'null'] });

const object = (properties, optional = []) => ({
  $jsonSchema: {
    bsonType: 'object',
    required: Object.keys(properties).filter((key) => !optional.includes(key)),
    properties,
  },
});

const validators = {
  companies: object({
    name: string(1, 80),
    slug: string(1),
    color: string(7, 7),
    timezone: string(1),
    ownerId: objectId,
    rev: int,
    createdAt: date,
    updatedAt: date,
  }),
  accounts: object({
    _id: string(3, 254),
    companyId: objectId,
    userId: objectId,
    passwordHash: string(20),
    lastLoginAt: nullable('date'),
    createdAt: date,
  }),
  users: object({
    companyId: objectId,
    email: string(3, 254),
    name: string(1, 80),
    role: { enum: ['owner', 'admin', 'member'] },
    avatarColor: string(7, 7),
    createdAt: date,
    updatedAt: date,
  }),
  projects: object({
    companyId: objectId,
    name: string(1, 80),
    key: { bsonType: 'string', pattern: '^[A-Z]{2,6}$' },
    description: string(0, 2000),
    color: string(7, 7),
    archived: bool,
    members: {
      bsonType: 'array',
      items: { bsonType: 'object', required: ['userId', 'addedAt'], properties: { userId: objectId, addedAt: date } },
    },
    columns: {
      bsonType: 'array',
      minItems: 2,
      maxItems: 10,
      items: {
        bsonType: 'object',
        required: ['key', 'name', 'order', 'isDone'],
        properties: { key: string(1, 30), name: string(1, 40), order: int, isDone: bool },
      },
    },
    taskCounter: int,
    rev: int,
    createdBy: objectId,
    createdAt: date,
    updatedAt: date,
  }),
  tasks: object({
    companyId: objectId,
    projectId: objectId,
    number: { bsonType: 'int', minimum: 1 },
    title: string(1, 200),
    description: string(0, 10000),
    status: string(1, 30),
    position: { bsonType: ['double', 'int', 'long'] },
    priority: { enum: ['low', 'medium', 'high', 'urgent'] },
    assigneeId: nullable('objectId'),
    dueDate: nullable('date'),
    labels: { bsonType: 'array', maxItems: 10, items: string(1, 30) },
    checklist: {
      bsonType: 'array',
      maxItems: 50,
      items: {
        bsonType: 'object',
        required: ['id', 'text', 'done'],
        properties: { id: string(1, 40), text: string(1, 200), done: bool },
      },
    },
    createdBy: objectId,
    createdAt: date,
    updatedAt: date,
    completedAt: nullable('date'),
  }),
  comments: object({
    companyId: objectId,
    projectId: objectId,
    taskId: objectId,
    authorId: objectId,
    body: string(1, 5000),
    createdAt: date,
    editedAt: nullable('date'),
  }),
  activities: object({
    companyId: objectId,
    projectId: objectId,
    taskId: nullable('objectId'),
    actorId: objectId,
    type: {
      enum: [
        'task.created',
        'task.updated',
        'task.status_changed',
        'task.assigned',
        'task.deleted',
        'comment.created',
        'project.member_added',
        'project.member_removed',
      ],
    },
    data: { bsonType: 'object' },
    createdAt: date,
  }),
  meta: object({ version: int, insertedAt: date }),
};

const indexes = {
  accounts: [{ key: { companyId: 1, userId: 1 } }],
  users: [{ key: { companyId: 1, name: 1 } }],
  projects: [{ key: { companyId: 1, archived: 1, name: 1 } }, { key: { companyId: 1, 'members.userId': 1 } }],
  tasks: [
    { key: { companyId: 1, projectId: 1, status: 1, position: 1 } },
    { key: { companyId: 1, assigneeId: 1, completedAt: 1, dueDate: 1 } },
  ],
  comments: [{ key: { companyId: 1, taskId: 1, createdAt: 1 } }],
  activities: [
    { key: { companyId: 1, projectId: 1, createdAt: -1 } },
    { key: { createdAt: 1 }, expireAfterSeconds: 180 * 24 * 60 * 60 },
  ],
};

export async function ensureSchema(db) {
  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
  for (const [name, validator] of Object.entries(validators)) {
    if (existing.has(name)) await db.command({ collMod: name, validator });
    else await db.createCollection(name, { validator });
  }
  for (const [name, specs] of Object.entries(indexes)) {
    await db.collection(name).createIndexes(specs);
  }
}
