// Dépôt lié à une entreprise : point de passage unique des routes vers les données métier.
// `companyId` vient de la session et est imposé à tous les filtres et à toutes les insertions.

const TENANT_COLLECTIONS = ['accounts', 'users', 'projects', 'tasks', 'comments', 'activities'];
const FORBIDDEN_STAGES = ['$lookup', '$graphLookup', '$unionWith', '$out', '$merge'];

function assertSafeUpdate(update) {
  if (Array.isArray(update) || Object.keys(update).some((key) => !key.startsWith('$'))) {
    throw new Error('Seules les mises à jour par opérateurs sont autorisées');
  }
  for (const [operator, fields] of Object.entries(update)) {
    const names = Object.keys(fields);
    if (operator === '$rename') names.push(...Object.values(fields));
    if (names.some((name) => name === 'companyId' || name.startsWith('companyId.'))) {
      throw new Error('companyId ne peut pas être modifié');
    }
  }
}

function assertSafeOptions(options) {
  if (options?.upsert) throw new Error('Upsert interdit sur un dépôt lié à une entreprise');
}

function scopedCollection(collection, companyId) {
  // `companyId` est ajouté en dernier : une valeur présente dans le filtre est écrasée.
  const only = (filter = {}) => ({ ...filter, companyId });
  const own = (doc) => ({ ...doc, companyId });
  const update = (method) => (filter, changes, options) => {
    assertSafeUpdate(changes);
    assertSafeOptions(options);
    return collection[method](only(filter), changes, options);
  };

  return Object.freeze({
    find: (filter, options) => collection.find(only(filter), options),
    findOne: (filter, options) => collection.findOne(only(filter), options),
    countDocuments: (filter, options) => collection.countDocuments(only(filter), options),
    insertOne: (doc, options) => collection.insertOne(own(doc), options),
    insertMany: (docs, options) => collection.insertMany(docs.map(own), options),
    updateOne: update('updateOne'),
    updateMany: update('updateMany'),
    findOneAndUpdate: update('findOneAndUpdate'),
    deleteOne: (filter, options) => collection.deleteOne(only(filter), options),
    deleteMany: (filter, options) => collection.deleteMany(only(filter), options),
    aggregate: (pipeline, options) => {
      if (pipeline.some((stage) => FORBIDDEN_STAGES.some((name) => name in stage))) {
        throw new Error('Étape d’agrégation interdite : elle pourrait lire une autre entreprise');
      }
      return collection.aggregate([{ $match: { companyId } }, ...pipeline], options);
    },
  });
}

/** La collection `companies` n'a pas de `companyId` : son `_id` joue ce rôle. */
function scopedCompany(collection, companyId) {
  const filter = { _id: companyId };
  return Object.freeze({
    get: (options) => collection.findOne(filter, options),
    update: (changes, options) => {
      assertSafeOptions(options);
      return collection.findOneAndUpdate(filter, changes, { returnDocument: 'after', ...options });
    },
    remove: (options) => collection.deleteOne(filter, options),
  });
}

export function scoped(db, companyId) {
  if (!companyId) throw new Error('companyId obligatoire');
  const repository = { companyId, company: scopedCompany(db.collection('companies'), companyId) };
  for (const name of TENANT_COLLECTIONS) {
    repository[name] = scopedCollection(db.collection(name), companyId);
  }
  return Object.freeze(repository);
}

export { TENANT_COLLECTIONS };
