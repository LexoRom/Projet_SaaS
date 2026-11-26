import { Router } from 'express';
import { visibleProjects } from '../access.js';
import { presentTask } from './presenters.js';

const router = Router();

router.get('/', async (req, res) => {
  const { tenant, user } = req.ctx;
  const projects = await tenant.projects
    .find({ ...visibleProjects(user), archived: false })
    .project({ name: 1, key: 1, color: 1, columns: 1 })
    .sort({ name: 1 })
    .toArray();
  const projectIds = projects.map((project) => project._id);

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const [mine, overdue, counts] = await Promise.all([
    tenant.tasks.find({ assigneeId: user._id, completedAt: null, projectId: { $in: projectIds } }).toArray(),
    tenant.tasks
      .find({ projectId: { $in: projectIds }, completedAt: null, dueDate: { $ne: null, $lt: today } })
      .sort({ dueDate: 1 })
      .limit(50)
      .toArray(),
    tenant.tasks
      .aggregate([
        { $match: { projectId: { $in: projectIds } } },
        { $group: { _id: { projectId: '$projectId', status: '$status' }, count: { $sum: 1 } } },
      ])
      .toArray(),
  ]);

  // Les tâches sans échéance passent après les autres.
  const deadline = (task) => task.dueDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
  mine.sort((a, b) => deadline(a) - deadline(b));

  res.json({
    myTasks: mine.map(presentTask),
    overdue: overdue.map(presentTask),
    projects: projects.map(({ companyId, ...project }) => ({
      ...project,
      counts: Object.fromEntries(
        counts.filter((c) => c._id.projectId.equals(project._id)).map((c) => [c._id.status, c.count]),
      ),
    })),
  });
});

export default router;
