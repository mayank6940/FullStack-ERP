import express from 'express';
import { authMiddleware, roleGuard } from '../middleware/auth.js';
import prisma from '../prisma/client.js';

const router = express.Router();

const SETTINGS_KEY = 'GLOBAL_ADMIN_SETTINGS';
const DEFAULT_SETTINGS = {
  activityRefreshSeconds: 30,
  reportsAutoRefreshSeconds: 60,
  stuckOrderHours: 24,
  overdueGraceHours: 0,
  lowQualityScoreThreshold: 70,
  highlightRejections: true
};

const clampLimit = (value, fallback = 20) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, 100);
};

const csvValue = (value) => {
  if (value === null || value === undefined) return '';
  const text = String(value).replace(/"/g, '""');
  return /[",\n]/.test(text) ? `"${text}"` : text;
};

const toCsv = (rows, columns) => {
  const header = columns.map((col) => csvValue(col.label)).join(',');
  const body = rows.map((row) => columns.map((col) => csvValue(row[col.key])).join(',')).join('\n');
  return `${header}\n${body}`;
};

const normalizeSettings = (incoming = {}) => {
  const num = (value, min, max, fallback) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(parsed, min), max);
  };

  return {
    activityRefreshSeconds: num(incoming.activityRefreshSeconds, 10, 300, DEFAULT_SETTINGS.activityRefreshSeconds),
    reportsAutoRefreshSeconds: num(incoming.reportsAutoRefreshSeconds, 10, 600, DEFAULT_SETTINGS.reportsAutoRefreshSeconds),
    stuckOrderHours: num(incoming.stuckOrderHours, 1, 168, DEFAULT_SETTINGS.stuckOrderHours),
    overdueGraceHours: num(incoming.overdueGraceHours, 0, 168, DEFAULT_SETTINGS.overdueGraceHours),
    lowQualityScoreThreshold: num(incoming.lowQualityScoreThreshold, 0, 100, DEFAULT_SETTINGS.lowQualityScoreThreshold),
    highlightRejections: Boolean(incoming.highlightRejections)
  };
};

const readSettings = async () => {
  const record = await prisma.systemSetting.findUnique({ where: { key: SETTINGS_KEY } });
  const value = record?.value && typeof record.value === 'object' ? record.value : {};
  return { ...DEFAULT_SETTINGS, ...value };
};

router.get('/settings/public', authMiddleware, roleGuard('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const settings = await readSettings();
    res.json({
      success: true,
      data: {
        activityRefreshSeconds: settings.activityRefreshSeconds,
        reportsAutoRefreshSeconds: settings.reportsAutoRefreshSeconds,
        stuckOrderHours: settings.stuckOrderHours,
        overdueGraceHours: settings.overdueGraceHours,
        lowQualityScoreThreshold: settings.lowQualityScoreThreshold,
        highlightRejections: settings.highlightRejections
      },
      message: 'Public settings fetched'
    });
  } catch (error) {
    console.error('admin/settings/public error:', error);
    res.status(500).json({ success: false, data: {}, message: 'Failed to load public settings' });
  }
});

router.get('/settings', authMiddleware, roleGuard('ADMIN'), async (req, res) => {
  try {
    const settings = await readSettings();
    res.json({ success: true, data: { settings }, message: 'Settings fetched' });
  } catch (error) {
    console.error('admin/settings get error:', error);
    res.status(500).json({ success: false, data: {}, message: 'Failed to load settings' });
  }
});

router.put('/settings', authMiddleware, roleGuard('ADMIN'), async (req, res) => {
  try {
    const settings = normalizeSettings(req.body?.settings || {});

    const saved = await prisma.systemSetting.upsert({
      where: { key: SETTINGS_KEY },
      create: {
        key: SETTINGS_KEY,
        value: settings,
        updatedBy: req.user.id
      },
      update: {
        value: settings,
        updatedBy: req.user.id
      }
    });

    await prisma.activityLog.create({
      data: {
        employeeId: req.user.id,
        action: 'SYSTEM_SETTINGS_UPDATED',
        metadata: settings
      }
    });

    res.json({ success: true, data: { settings: saved.value }, message: 'Settings updated' });
  } catch (error) {
    console.error('admin/settings put error:', error);
    res.status(500).json({ success: false, data: {}, message: 'Failed to save settings' });
  }
});

router.get('/ml-export', authMiddleware, roleGuard('ADMIN'), async (req, res) => {
  try {
    const { format = 'json', page = 1, limit = 20, role = '' } = req.query;
    const pageNum = Number.parseInt(page, 10) || 1;
    const limitNum = clampLimit(limit);

    const assignmentWhere = {
      ...(role ? { role: String(role).toUpperCase() } : {})
    };

    const [total, assignments] = await Promise.all([
      prisma.orderAssignment.count({ where: assignmentWhere }),
      prisma.orderAssignment.findMany({
        where: assignmentWhere,
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
        orderBy: { assignedAt: 'asc' },
        include: {
          order: {
            select: {
              id: true,
              size: true,
              details: true
            }
          },
          employee: {
            select: {
              id: true,
              role: true
            }
          }
        }
      })
    ]);

    const items = [];

    for (const assignment of assignments) {
      const details = assignment.order?.details && typeof assignment.order.details === 'object' ? assignment.order.details : {};
      const articleType = details.articleName || details.Products || null;
      const timeToCompleteHours = assignment.startedAt && assignment.completedAt
        ? Number((((new Date(assignment.completedAt).getTime() - new Date(assignment.startedAt).getTime()) / (1000 * 60 * 60))).toFixed(2))
        : null;

      const rejectionCount = await prisma.rejection.count({
        where: {
          orderId: assignment.orderId,
          routedTo: assignment.role
        }
      });

      const qualityScore = rejectionCount === 0 ? 1 : rejectionCount === 1 ? 0.5 : 0;

      const [historicalAssigned, historicalCompleted, workloadAtAssignment] = await Promise.all([
        prisma.orderAssignment.count({
          where: {
            employeeId: assignment.employeeId,
            assignedAt: { lt: assignment.assignedAt }
          }
        }),
        prisma.orderAssignment.count({
          where: {
            employeeId: assignment.employeeId,
            assignedAt: { lt: assignment.assignedAt },
            completedAt: { not: null }
          }
        }),
        prisma.orderAssignment.count({
          where: {
            employeeId: assignment.employeeId,
            assignedAt: { lte: assignment.assignedAt },
            OR: [
              { completedAt: null },
              { completedAt: { gt: assignment.assignedAt } }
            ]
          }
        })
      ]);

      const completionRateAtTime = historicalAssigned > 0
        ? Number((historicalCompleted / historicalAssigned).toFixed(4))
        : 0;

      items.push({
        employee_id: assignment.employeeId,
        role: assignment.role,
        order_id: assignment.orderId,
        order_size: assignment.order?.size || null,
        article_type: articleType,
        time_to_complete_hours: timeToCompleteHours,
        rejection_count: rejectionCount,
        quality_score: qualityScore,
        completion_rate_at_time: completionRateAtTime,
        workload_at_assignment: workloadAtAssignment
      });
    }

    if (String(format).toLowerCase() === 'csv') {
      const csv = toCsv(items, [
        { key: 'employee_id', label: 'employee_id' },
        { key: 'role', label: 'role' },
        { key: 'order_id', label: 'order_id' },
        { key: 'order_size', label: 'order_size' },
        { key: 'article_type', label: 'article_type' },
        { key: 'time_to_complete_hours', label: 'time_to_complete_hours' },
        { key: 'rejection_count', label: 'rejection_count' },
        { key: 'quality_score', label: 'quality_score' },
        { key: 'completion_rate_at_time', label: 'completion_rate_at_time' },
        { key: 'workload_at_assignment', label: 'workload_at_assignment' }
      ]);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      return res.send(csv);
    }

    res.json({
      success: true,
      data: {
        items,
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum)
      },
      message: 'ML export dataset generated'
    });
  } catch (error) {
    console.error('admin/ml-export error:', error);
    res.status(500).json({ success: false, data: {}, message: 'Failed to generate ML export dataset' });
  }
});

router.get('/ml-export/summary', authMiddleware, roleGuard('ADMIN'), async (req, res) => {
  try {
    const [totalAssignments, completedAssignments, totalRejections, byRole] = await Promise.all([
      prisma.orderAssignment.count(),
      prisma.orderAssignment.count({ where: { completedAt: { not: null } } }),
      prisma.rejection.count(),
      prisma.orderAssignment.groupBy({
        by: ['role'],
        _count: { _all: true }
      })
    ]);

    const readiness = totalAssignments >= 100 && completedAssignments >= 50;

    res.json({
      success: true,
      data: {
        totalAssignments,
        completedAssignments,
        completionRatio: totalAssignments > 0 ? Number((completedAssignments / totalAssignments).toFixed(4)) : 0,
        totalRejections,
        assignmentsByRole: byRole.map((item) => ({ role: item.role, count: item._count._all })),
        trainingReadiness: readiness ? 'READY' : 'INSUFFICIENT_DATA'
      },
      message: 'ML export summary generated'
    });
  } catch (error) {
    console.error('admin/ml-export/summary error:', error);
    res.status(500).json({ success: false, data: {}, message: 'Failed to generate ML export summary' });
  }
});

export default router;
