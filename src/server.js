const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function registerRoute(method, ...args) {
  const handler = args.pop();
  app[method](...args, (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next));
}

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/saas_project";
const JWT_SECRET = process.env.JWT_SECRET || "change-me-in-production";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "8h";

const companySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  createdAt: { type: Date, default: Date.now }
});

const userSchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, trim: true, lowercase: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ["admin", "member"], default: "member" },
  createdAt: { type: Date, default: Date.now }
});
userSchema.index({ companyId: 1, email: 1 }, { unique: true });
userSchema.index({ email: 1 });

const projectSchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
  name: { type: String, required: true, trim: true },
  description: { type: String, default: "" },
  userIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  createdAt: { type: Date, default: Date.now }
});
projectSchema.index({ companyId: 1, createdAt: -1 });

const taskSchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true, index: true },
  title: { type: String, required: true, trim: true },
  description: { type: String, default: "" },
  assigneeIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  // Legacy field migrated to assigneeIds at startup.
  assigneeId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  status: { type: String, enum: ["todo", "doing", "done"], default: "todo" },
  priority: { type: String, enum: ["low", "medium", "high"], default: "medium" },
  dueDate: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});
taskSchema.index({ companyId: 1, projectId: 1, status: 1 });

const Company = mongoose.model("Company", companySchema);
const User = mongoose.model("User", userSchema);
const Project = mongoose.model("Project", projectSchema);
const Task = mongoose.model("Task", taskSchema);

function signToken(user) {
  return jwt.sign(
    { userId: user._id.toString(), companyId: user.companyId.toString(), role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Authentification requise." });
  try {
    const claims = jwt.verify(token, JWT_SECRET);
    User.findOne({ _id: claims.userId, companyId: claims.companyId }).select("role").then(user => {
      if (!user) return res.status(401).json({ error: "Session invalide." });
      req.auth = { ...claims, role: user.role };
      next();
    }).catch(next);
  } catch {
    return res.status(401).json({ error: "Token invalide ou expiré." });
  }
}

function adminOnly(req, res, next) {
  if (req.auth.role !== "admin") return res.status(403).json({ error: "Droits administrateur requis." });
  next();
}

function validId(id) {
  return mongoose.isValidObjectId(id);
}

async function userInTenant(userId, companyId) {
  return User.findOne({ _id: userId, companyId });
}

async function projectInTenant(projectId, companyId) {
  return Project.findOne({ _id: projectId, companyId });
}

// Health
registerRoute("get", "/api/health", async (req, res) => {
  res.json({ status: "ok", mongo: mongoose.connection.readyState === 1 });
});

// Bootstrap: creates the first company and admin only if no companies exist.
registerRoute("post", "/api/bootstrap", async (req, res) => {
  if (await Company.exists({})) {
    return res.status(409).json({ error: "Le bootstrap est déjà effectué." });
  }
  const { companyName, name, email, password } = req.body || {};
  if (typeof companyName !== "string" || typeof name !== "string" || typeof email !== "string" || typeof password !== "string" || password.length < 6) {
    return res.status(400).json({ error: "companyName, name, email et un mot de passe d'au moins 6 caractères sont requis." });
  }
  const company = await Company.create({ name: companyName });
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await User.create({ companyId: company._id, name, email, passwordHash, role: "admin" });
  res.status(201).json({ company: { id: company._id, name: company.name }, user: { id: user._id, name: user.name, email: user.email, role: user.role } });
});

registerRoute("post", "/api/companies", auth, adminOnly, async (req, res) => {
  const { companyName, name, email, password } = req.body || {};
  if ([companyName, name, email, password].some(value => typeof value !== "string" || !value.trim()) || password.length < 6) {
    return res.status(400).json({ error: "Le nom de l'entreprise, le nom du compte, l'email et un mot de passe d'au moins 6 caractères sont requis." });
  }
  const company = await Company.create({ name: companyName.trim() });
  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({ companyId: company._id, name, email, passwordHash, role: "admin" });
    res.status(201).json({ token: signToken(user), company: { id: company._id, name: company.name }, user: { id: user._id, name: user.name, email: user.email, role: user.role } });
  } catch (error) {
    await Company.deleteOne({ _id: company._id });
    throw error;
  }
});

// Auth
registerRoute("post", "/api/auth/login", async (req, res) => {
  const { password } = req.body || {};
  const email = String(req.body?.email || "").trim().toLowerCase();
  const companyName = String(req.body?.companyName || "").trim().toLowerCase();
  const candidates = await User.find({ email }).limit(20);
  const matches = [];
  for (const candidate of candidates) {
    if (await bcrypt.compare(password || "", candidate.passwordHash)) {
      const company = await Company.findById(candidate.companyId).select("name");
      if (company && (!companyName || company.name.trim().toLowerCase() === companyName)) matches.push({ user: candidate, company });
    }
  }
  if (!matches.length) {
    return res.status(401).json({ error: "Email ou mot de passe incorrect." });
  }
  if (matches.length > 1) {
    return res.status(409).json({ error: "Plusieurs comptes correspondent. Renseignez le nom de l'entreprise pour choisir le bon espace." });
  }
  const { user, company } = matches[0];
  res.json({
    token: signToken(user),
    user: { id: user._id, name: user.name, email: user.email, role: user.role },
    company: { id: company._id, name: company.name }
  });
});

registerRoute("get", "/api/me", auth, async (req, res) => {
  const user = await User.findOne({ _id: req.auth.userId, companyId: req.auth.companyId }).select("-passwordHash");
  const company = await Company.findById(req.auth.companyId);
  if (!user || !company) return res.status(401).json({ error: "Session invalide." });
  res.json({ user, company });
});

// Companies: tenant-scoped except creation/deletion, which are admin operations.
registerRoute("get", "/api/company", auth, async (req, res) => {
  const company = await Company.findById(req.auth.companyId);
  res.json(company);
});

registerRoute("patch", "/api/company", auth, adminOnly, async (req, res) => {
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "Le nom de l'entreprise est requis." });
  const company = await Company.findByIdAndUpdate(
    req.auth.companyId,
    { name },
    { new: true, runValidators: true }
  );
  if (!company) return res.status(404).json({ error: "Entreprise introuvable." });
  res.json(company);
});

registerRoute("delete", "/api/company", auth, adminOnly, async (req, res) => {
  const companyId = req.auth.companyId;
  await Task.deleteMany({ companyId });
  await Project.deleteMany({ companyId });
  await User.deleteMany({ companyId });
  await Company.deleteOne({ _id: companyId });
  res.status(204).end();
});

// Users
registerRoute("get", "/api/users", auth, async (req, res) => {
  const users = await User.find({ companyId: req.auth.companyId }).select("-passwordHash").sort({ name: 1 });
  res.json(users);
});

registerRoute("post", "/api/users", auth, adminOnly, async (req, res) => {
  const { name, email, password, role = "member" } = req.body || {};
  if (typeof name !== "string" || typeof email !== "string" || typeof password !== "string" || password.length < 6) {
    return res.status(400).json({ error: "name, email et mot de passe (6 caractères minimum) sont requis." });
  }
  const passwordHash = await bcrypt.hash(password, 12);
  try {
    const user = await User.create({ companyId: req.auth.companyId, name, email, passwordHash, role });
    res.status(201).json({ id: user._id, name: user.name, email: user.email, role: user.role });
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ error: "Cet email existe déjà dans l'entreprise." });
    throw e;
  }
});

registerRoute("patch", "/api/users/:id", auth, adminOnly, async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: "ID invalide." });
  const body = req.body || {};
  const update = {};
  if (body.name !== undefined) {
    update.name = String(body.name).trim();
    if (!update.name) return res.status(400).json({ error: "Le nom est requis." });
  }
  if (body.email !== undefined) {
    update.email = String(body.email).trim().toLowerCase();
    if (!update.email) return res.status(400).json({ error: "L'email est requis." });
  }
  if (body.role !== undefined) {
    if (!["admin", "member"].includes(body.role)) {
      return res.status(400).json({ error: "Le rôle doit être admin ou member." });
    }
    update.role = body.role;
  }
  if (body.password !== undefined && body.password !== "") {
    if (typeof body.password !== "string" || body.password.length < 6) {
      return res.status(400).json({ error: "Le mot de passe doit contenir au moins 6 caractères." });
    }
    update.passwordHash = await bcrypt.hash(body.password, 12);
  }
  if (!Object.keys(update).length) return res.status(400).json({ error: "Aucune modification fournie." });

  if (update.email) {
    const duplicate = await User.exists({
      _id: { $ne: req.params.id }, companyId: req.auth.companyId, email: update.email
    });
    if (duplicate) return res.status(409).json({ error: "Cet email existe déjà dans l'entreprise." });
  }

  const current = await User.findOne({ _id: req.params.id, companyId: req.auth.companyId });
  if (!current) return res.status(404).json({ error: "Utilisateur introuvable." });
  if (current.role === "admin" && update.role === "member") {
    const adminCount = await User.countDocuments({ companyId: req.auth.companyId, role: "admin" });
    if (adminCount <= 1) return res.status(409).json({ error: "L'entreprise doit conserver au moins un administrateur." });
  }

  try {
    const user = await User.findOneAndUpdate(
      { _id: req.params.id, companyId: req.auth.companyId },
      update,
      { new: true, runValidators: true }
    ).select("-passwordHash");
    res.json(user);
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ error: "Cet email existe déjà dans l'entreprise." });
    throw e;
  }
});

registerRoute("delete", "/api/users/:id", auth, adminOnly, async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: "ID invalide." });
  if (req.params.id.toLowerCase() === String(req.auth.userId).toLowerCase()) return res.status(400).json({ error: "Impossible de supprimer son propre compte." });
  const user = await User.findOneAndDelete({ _id: req.params.id, companyId: req.auth.companyId });
  if (!user) return res.status(404).json({ error: "Utilisateur introuvable." });
  await Project.updateMany({ companyId: req.auth.companyId }, { $pull: { userIds: user._id } });
  await Task.updateMany({ companyId: req.auth.companyId }, { $pull: { assigneeIds: user._id } });
  res.status(204).end();
});

// Projects
registerRoute("get", "/api/projects", auth, async (req, res) => {
  const projects = await Project.find({ companyId: req.auth.companyId }).populate("userIds", "name email role").sort({ createdAt: -1 });
  res.json(projects);
});

registerRoute("post", "/api/projects", auth, async (req, res) => {
  const { name, description = "", userIds = [] } = req.body || {};
  if (typeof name !== "string" || !name.trim()) return res.status(400).json({ error: "Le nom du projet est requis." });
  if (!Array.isArray(userIds)) return res.status(400).json({ error: "La liste des membres est invalide." });
  const ids = [...new Set(userIds.map(String))];
  const count = await User.countDocuments({ companyId: req.auth.companyId, _id: { $in: ids } });
  if (count !== ids.length) return res.status(400).json({ error: "Tous les utilisateurs du projet doivent appartenir à votre entreprise." });
  const project = await Project.create({ companyId: req.auth.companyId, name, description, userIds: ids });
  res.status(201).json(await Project.findById(project._id).populate("userIds", "name email role"));
});

registerRoute("patch", "/api/projects/:id", auth, async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: "ID invalide." });
  const body = req.body || {};
  const project = await projectInTenant(req.params.id, req.auth.companyId);
  if (!project) return res.status(404).json({ error: "Projet introuvable." });
  const update = {};
  let userIdsToKeep = null;
  if (body.name !== undefined) update.name = body.name;
  if (body.description !== undefined) update.description = body.description;
  if (body.userIds !== undefined) {
    if (!Array.isArray(body.userIds)) return res.status(400).json({ error: "La liste des membres est invalide." });
    const ids = [...new Set(body.userIds.map(String))];
    const count = await User.countDocuments({ companyId: req.auth.companyId, _id: { $in: ids } });
    if (count !== ids.length) return res.status(400).json({ error: "Un utilisateur n'appartient pas à l'entreprise." });
    update.userIds = ids;
    userIdsToKeep = ids;
  }
  const saved = await Project.findOneAndUpdate(
    { _id: req.params.id, companyId: req.auth.companyId },
    update, { new: true, runValidators: true }
  ).populate("userIds", "name email role");
  if (userIdsToKeep) {
    await Task.updateMany(
      { companyId: req.auth.companyId, projectId: project._id },
      { $pull: { assigneeIds: { $nin: userIdsToKeep } }, $set: { updatedAt: new Date() } }
    );
  }
  res.json(saved);
});

registerRoute("delete", "/api/projects/:id", auth, async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: "ID invalide." });
  const project = await Project.findOneAndDelete({ _id: req.params.id, companyId: req.auth.companyId });
  if (!project) return res.status(404).json({ error: "Projet introuvable." });
  await Task.deleteMany({ projectId: project._id, companyId: req.auth.companyId });
  res.status(204).end();
});

// Tasks / Kanban
registerRoute("get", "/api/projects/:projectId/tasks", auth, async (req, res) => {
  if (!validId(req.params.projectId)) return res.status(400).json({ error: "ID invalide." });
  const project = await projectInTenant(req.params.projectId, req.auth.companyId);
  if (!project) return res.status(404).json({ error: "Projet introuvable." });
  const tasks = await Task.find({ projectId: project._id, companyId: req.auth.companyId })
    .populate("assigneeIds", "name email")
    .sort({ createdAt: -1 });
  res.json(tasks);
});

registerRoute("post", "/api/projects/:projectId/tasks", auth, async (req, res) => {
  if (!validId(req.params.projectId)) return res.status(400).json({ error: "ID invalide." });
  const project = await projectInTenant(req.params.projectId, req.auth.companyId);
  if (!project) return res.status(404).json({ error: "Projet introuvable." });
  const { title, description = "", assigneeIds = [], status = "todo", priority = "medium", dueDate = null } = req.body || {};
  if (typeof title !== "string" || !title.trim()) return res.status(400).json({ error: "Le titre est requis." });
  if (!Array.isArray(assigneeIds) || assigneeIds.some(id => !validId(id))) return res.status(400).json({ error: "La liste des personnes assignées est invalide." });
  const uniqueAssigneeIds = [...new Set(assigneeIds.map(String))];
  const userCount = await User.countDocuments({ _id: { $in: uniqueAssigneeIds }, companyId: req.auth.companyId });
  if (userCount !== uniqueAssigneeIds.length) return res.status(400).json({ error: "Chaque personne assignée doit appartenir à l'entreprise." });
  if (uniqueAssigneeIds.some(id => !project.userIds.some(memberId => memberId.toString() === id))) {
    return res.status(400).json({ error: "Chaque personne assignée doit être membre du projet." });
  }
  const task = await Task.create({ companyId: req.auth.companyId, projectId: project._id, title, description, assigneeIds: uniqueAssigneeIds, status, priority, dueDate });
  res.status(201).json(await Task.findById(task._id).populate("assigneeIds", "name email"));
});

registerRoute("patch", "/api/tasks/:id", auth, async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: "ID invalide." });
  const body = req.body || {};
  const task = await Task.findOne({ _id: req.params.id, companyId: req.auth.companyId });
  if (!task) return res.status(404).json({ error: "Tâche introuvable." });
  const update = {};
  for (const field of ["title", "description", "status", "priority", "dueDate"]) {
    if (body[field] !== undefined) update[field] = body[field];
  }
  if (body.assigneeIds !== undefined || body.assigneeId !== undefined) {
    const inputIds = body.assigneeIds !== undefined ? body.assigneeIds : body.assigneeId ? [body.assigneeId] : [];
    if (!Array.isArray(inputIds) || inputIds.some(id => !validId(id))) return res.status(400).json({ error: "La liste des personnes assignées est invalide." });
    const assigneeIds = [...new Set(inputIds.map(String))];
    const project = await projectInTenant(task.projectId, req.auth.companyId);
    const userCount = await User.countDocuments({ _id: { $in: assigneeIds }, companyId: req.auth.companyId });
    if (!project || userCount !== assigneeIds.length || assigneeIds.some(id => !project.userIds.some(memberId => memberId.toString() === id))) {
      return res.status(400).json({ error: "Chaque personne assignée doit appartenir à l'entreprise et au projet." });
    }
    update.assigneeIds = assigneeIds;
  }
  update.updatedAt = new Date();
  const saved = await Task.findOneAndUpdate({ _id: task._id, companyId: req.auth.companyId }, update, { new: true, runValidators: true })
    .populate("assigneeId", "name email");
  res.json(saved);
});

registerRoute("delete", "/api/tasks/:id", auth, async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: "ID invalide." });
  const task = await Task.findOneAndDelete({ _id: req.params.id, companyId: req.auth.companyId });
  if (!task) return res.status(404).json({ error: "Tâche introuvable." });
  res.status(204).end();
});

// Error handling
app.use((err, req, res, next) => {
  console.error(err);
  if (err.status === 400 || err.type === "entity.parse.failed" || ["CastError", "ValidationError"].includes(err.name)) {
    return res.status(400).json({ error: "Données invalides." });
  }
  res.status(500).json({ error: "Erreur interne du serveur." });
});

async function start() {
  await mongoose.connect(MONGO_URI);
  await Task.collection.updateMany(
    { assigneeIds: { $exists: false } },
    [
      { $set: { assigneeIds: { $cond: [{ $eq: [{ $ifNull: ["$assigneeId", null] }, null] }, [], ["$assigneeId"]] } } },
      { $unset: "assigneeId" }
    ]
  );
  console.log("MongoDB connected");
  app.listen(PORT, () => console.log(`SaaS app listening on port ${PORT}`));
}

start().catch(err => {
  console.error("Startup error:", err);
  process.exit(1);
});
