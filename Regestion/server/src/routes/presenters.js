// Formes renvoyées par l'API : les champs internes (`rev`, `companyId`) ne sortent jamais.
export const presentUser = (user) => ({
  _id: user._id,
  email: user.email,
  name: user.name,
  role: user.role,
  avatarColor: user.avatarColor,
  createdAt: user.createdAt,
});

export const presentCompany = (company) => ({
  _id: company._id,
  name: company.name,
  color: company.color,
  timezone: company.timezone,
  ownerId: company.ownerId,
  createdAt: company.createdAt,
});

export const presentProject = ({ companyId, rev, taskCounter, ...project }) => project;

export const presentTask = ({ companyId, ...task }) => task;

export const presentDocument = ({ companyId, ...document }) => document;
