import express from 'express';
import { PrismaClient } from '@prisma/client';
import { authMiddleware, roleGuard } from '../middleware/auth.js';

const router = express.Router();
const prisma = new PrismaClient();

const clampLimit = (value, fallback = 20) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, 100);
};

const buildDateFilter = (fromDate, toDate) => {
  const range = {};
  if (fromDate) range.gte = new Date(fromDate);
  if (toDate) range.lte = new Date(`${toDate}T23:59:59.999`);
  return Object.keys(range).length > 0 ? range : undefined;
};

const parseDetails = (details) => (details && typeof details === 'object' ? details : {});

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

const getScopedOrderWhere = (req, extraWhere = {}) => {
  if (req.user.role === 'MANAGER') {
    return {
      ...extraWhere,
      csvBatch: {
        ...(extraWhere.csvBatch || {}),
        uploadedBy: req.user.id
      }
    };
  }
  return extraWhere;
};

router.get('/pipeline', authMiddleware, roleGuard('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { fromDate, toDate, batchId, articleType, format = 'json' } = req.query;
    const createdAt = buildDateFilter(fromDate, toDate);

    const orderWhere = getScopedOrderWhere(req, {
      ...(createdAt ? { createdAt } : {}),
      ...(batchId ? { csvBatchId: String(batchId) } : {})
    });

    const orders = await prisma.order.findMany({
      where: orderWhere,
      select: {
        id: true,
        status: true,
        createdAt: true,
        details: true
      }
    });

    const filteredOrders = articleType
      ? orders.filter((order) => String(parseDetails(order.details).articleName || '').toLowerCase().includes(String(articleType).toLowerCase()))
      : orders;

    const stages = ['RECEIVED', 'ASSIGNED', 'FABRIC_IN_PROGRESS', 'FABRIC_DONE', 'CUTTING_IN_PROGRESS', 'CUTTING_DONE', 'TAILOR_IN_PROGRESS', 'TAILOR_DONE', 'QC_IN_PROGRESS', 'COMPLETED'];
    const statusCounts = stages.map((status) => ({
      status,
      count: filteredOrders.filter((order) => order.status === status).length
    }));

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const completedToday = filteredOrders.filter((order) => order.status === 'COMPLETED' && new Date(order.createdAt) >= todayStart).length;

    const statusHistoryWhere = getScopedOrderWhere(req, {
      ...(createdAt ? { createdAt } : {})
    });

    const histories = await prisma.orderStatusHistory.findMany({
      where: {
        order: statusHistoryWhere
      },
      select: {
        orderId: true,
        fromStatus: true,
        toStatus: true,
        createdAt: true
      },
      orderBy: { createdAt: 'asc' }
    });

    const grouped = new Map();
    histories.forEach((entry) => {
      if (!grouped.has(entry.orderId)) grouped.set(entry.orderId, []);
      grouped.get(entry.orderId).push(entry);
    });

    const stageDurations = {
      FABRIC: [],
      CUTTING: [],
      TAILOR: [],
      QC: []
    };

    grouped.forEach((entries) => {
      for (let i = 1; i < entries.length; i += 1) {
        const prev = entries[i - 1];
        const curr = entries[i];
        const hours = (new Date(curr.createdAt).getTime() - new Date(prev.createdAt).getTime()) / (1000 * 60 * 60);
        if (Number.isFinite(hours) && hours >= 0) {
          if (curr.toStatus.startsWith('FABRIC')) stageDurations.FABRIC.push(hours);
          if (curr.toStatus.startsWith('CUTTING')) stageDurations.CUTTING.push(hours);
          if (curr.toStatus.startsWith('TAILOR')) stageDurations.TAILOR.push(hours);
          if (curr.toStatus.startsWith('QC') || curr.toStatus === 'COMPLETED') stageDurations.QC.push(hours);
        }
      }
    });

    const avgByStage = Object.fromEntries(Object.entries(stageDurations).map(([key, values]) => [
      key,
      values.length > 0 ? Number((values.reduce((acc, val) => acc + val, 0) / values.length).toFixed(2)) : 0
    ]));

    if (String(format).toLowerCase() === 'csv') {
      const csvRows = statusCounts.map((row) => ({ status: row.status, count: row.count }));
      const csv = toCsv(csvRows, [
        { key: 'status', label: 'Status' },
        { key: 'count', label: 'Count' }
      ]);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      return res.send(csv);
    }

    res.json({
      success: true,
      data: {
        totalOrders: filteredOrders.length,
        completedToday,
        statusCounts,
        avgTimeByStageHours: avgByStage
      },
      message: 'Pipeline report fetched'
    });
  } catch (error) {
    console.error('reports/pipeline error:', error);
    res.status(500).json({ success: false, data: {}, message: 'Failed to fetch pipeline report' });
  }
});

router.get('/employee-performance', authMiddleware, roleGuard('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { fromDate, toDate, role = '', page = 1, limit = 20 } = req.query;
    const pageNum = Number.parseInt(page, 10) || 1;
    const limitNum = clampLimit(limit);

    const assignedAt = buildDateFilter(fromDate, toDate);

    const employeeWhere = {
      isActive: true,
      ...(role ? { role: String(role).toUpperCase() } : {})
    };

    const employees = await prisma.employee.findMany({
      where: employeeWhere,
      select: {
        id: true,
        empId: true,
        name: true,
        role: true
      }
    });

    const rows = [];
    for (const emp of employees) {
      const assignmentWhere = {
        employeeId: emp.id,
        ...(assignedAt ? { assignedAt } : {}),
        order: getScopedOrderWhere(req)
      };

      const [assigned, completed, assignmentRecords, rejectionsCaused] = await Promise.all([
        prisma.orderAssignment.count({ where: assignmentWhere }),
        prisma.orderAssignment.count({ where: { ...assignmentWhere, completedAt: { not: null } } }),
        prisma.orderAssignment.findMany({
          where: { ...assignmentWhere, completedAt: { not: null }, startedAt: { not: null } },
          select: { startedAt: true, completedAt: true }
        }),
        prisma.rejection.count({
          where: {
            routedTo: emp.role,
            createdAt: assignedAt,
            order: {
              assignments: {
                some: { employeeId: emp.id, role: emp.role }
              },
              ...getScopedOrderWhere(req)
            }
          }
        })
      ]);

      const avgTimeHours = assignmentRecords.length > 0
        ? assignmentRecords.reduce((acc, row) => acc + ((new Date(row.completedAt).getTime() - new Date(row.startedAt).getTime()) / (1000 * 60 * 60)), 0) / assignmentRecords.length
        : 0;

      const completionRate = assigned > 0 ? (completed / assigned) * 100 : 0;
      const rejectionRate = assigned > 0 ? (rejectionsCaused / assigned) * 100 : 0;
      const qualityScore = (1 - (rejectionRate / 100)) * (completionRate / 100) * 100;

      rows.push({
        employeeId: emp.id,
        empId: emp.empId,
        employeeName: emp.name,
        role: emp.role,
        totalAssigned: assigned,
        totalCompleted: completed,
        completionRate: Number(completionRate.toFixed(2)),
        avgTimePerOrderHours: Number(avgTimeHours.toFixed(2)),
        totalRejectionsCaused: rejectionsCaused,
        rejectionRate: Number(rejectionRate.toFixed(2)),
        qualityScore: Number(qualityScore.toFixed(2))
      });
    }

    rows.sort((a, b) => b.qualityScore - a.qualityScore);
    const total = rows.length;
    const paged = rows.slice((pageNum - 1) * limitNum, pageNum * limitNum);

    res.json({
      success: true,
      data: {
        items: paged,
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum)
      },
      message: 'Employee performance report fetched'
    });
  } catch (error) {
    console.error('reports/employee-performance error:', error);
    res.status(500).json({ success: false, data: {}, message: 'Failed to fetch employee performance report' });
  }
});

router.get('/rejection-analysis', authMiddleware, roleGuard('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { fromDate, toDate } = req.query;
    const createdAt = buildDateFilter(fromDate, toDate);

    const rejections = await prisma.rejection.findMany({
      where: {
        ...(createdAt ? { createdAt } : {}),
        order: getScopedOrderWhere(req)
      },
      include: {
        order: {
          include: {
            assignments: {
              include: {
                employee: {
                  select: { id: true, name: true, empId: true, role: true }
                }
              }
            },
            csvBatch: true
          }
        }
      }
    });

    const byCategory = ['FABRIC_QUALITY', 'WRONG_CUT', 'STITCHING_ISSUE', 'OTHER'].map((category) => ({
      category,
      count: rejections.filter((item) => item.reasonCategory === category).length
    }));

    const employeeMap = new Map();
    const batchMap = new Map();
    const resolutionHours = [];

    rejections.forEach((rej) => {
      const impacted = (rej.order?.assignments || []).filter((assn) => assn.role === rej.routedTo);
      impacted.forEach((assn) => {
        const key = assn.employee.id;
        const current = employeeMap.get(key) || {
          employeeId: assn.employee.id,
          empId: assn.employee.empId,
          employeeName: assn.employee.name,
          role: assn.employee.role,
          rejectionCount: 0
        };
        current.rejectionCount += 1;
        employeeMap.set(key, current);
      });

      const batch = rej.order?.csvBatch;
      if (batch) {
        const currentBatch = batchMap.get(batch.id) || {
          batchId: batch.id,
          filename: batch.filename,
          rejectionCount: 0
        };
        currentBatch.rejectionCount += 1;
        batchMap.set(batch.id, currentBatch);
      }

      if (rej.resolvedAt) {
        const hours = (new Date(rej.resolvedAt).getTime() - new Date(rej.createdAt).getTime()) / (1000 * 60 * 60);
        if (Number.isFinite(hours) && hours >= 0) resolutionHours.push(hours);
      }
    });

    const averageResolutionHours = resolutionHours.length > 0
      ? Number((resolutionHours.reduce((acc, val) => acc + val, 0) / resolutionHours.length).toFixed(2))
      : 0;

    res.json({
      success: true,
      data: {
        totalRejections: rejections.length,
        byCategory,
        topEmployees: [...employeeMap.values()].sort((a, b) => b.rejectionCount - a.rejectionCount),
        topBatches: [...batchMap.values()].sort((a, b) => b.rejectionCount - a.rejectionCount),
        averageResolutionHours
      },
      message: 'Rejection analysis report fetched'
    });
  } catch (error) {
    console.error('reports/rejection-analysis error:', error);
    res.status(500).json({ success: false, data: {}, message: 'Failed to fetch rejection analysis report' });
  }
});

router.get('/batch', authMiddleware, roleGuard('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { fromDate, toDate, page = 1, limit = 20 } = req.query;
    const pageNum = Number.parseInt(page, 10) || 1;
    const limitNum = clampLimit(limit);
    const createdAt = buildDateFilter(fromDate, toDate);

    const where = getScopedOrderWhere(req, {
      ...(createdAt ? { createdAt } : {})
    });

    const [total, batches] = await Promise.all([
      prisma.csvBatch.count({ where: req.user.role === 'MANAGER' ? { uploadedBy: req.user.id } : {} }),
      prisma.csvBatch.findMany({
        where: req.user.role === 'MANAGER' ? { uploadedBy: req.user.id } : {},
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
        include: {
          orders: {
            where,
            include: {
              assignments: {
                include: {
                  employee: {
                    select: { id: true, name: true, role: true }
                  }
                }
              }
            }
          }
        }
      })
    ]);

    const items = batches.map((batch) => {
      const orders = batch.orders || [];
      const completed = orders.filter((order) => order.status === 'COMPLETED').length;
      const inProgress = orders.filter((order) => !['COMPLETED', 'REJECTED'].includes(order.status)).length;
      const rejected = orders.filter((order) => order.status === 'REJECTED').length;

      const durations = orders
        .map((order) => {
          const completedAssignments = (order.assignments || []).filter((a) => a.startedAt && a.completedAt);
          if (completedAssignments.length === 0) return null;
          const totalHours = completedAssignments.reduce((acc, assn) => acc + ((new Date(assn.completedAt).getTime() - new Date(assn.startedAt).getTime()) / (1000 * 60 * 60)), 0);
          return totalHours / completedAssignments.length;
        })
        .filter((v) => Number.isFinite(v));

      const employeeSet = new Set();
      orders.forEach((order) => {
        (order.assignments || []).forEach((assn) => {
          if (assn.employee?.name) employeeSet.add(`${assn.employee.name} (${assn.employee.role})`);
        });
      });

      return {
        batchId: batch.id,
        filename: batch.filename,
        uploadDate: batch.createdAt,
        totalOrders: orders.length,
        completed,
        inProgress,
        rejected,
        averageCompletionHours: durations.length > 0 ? Number((durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(2)) : 0,
        employeesWorked: [...employeeSet]
      };
    });

    res.json({
      success: true,
      data: {
        items,
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum)
      },
      message: 'Batch report fetched'
    });
  } catch (error) {
    console.error('reports/batch error:', error);
    res.status(500).json({ success: false, data: {}, message: 'Failed to fetch batch report' });
  }
});

router.get('/daily-summary', authMiddleware, roleGuard('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const orderWhere = getScopedOrderWhere(req);

    const [ordersCompletedToday, ordersStartedToday, rejectionsToday, employeesActiveToday, overdueOrders] = await Promise.all([
      prisma.orderStatusHistory.count({
        where: {
          toStatus: 'COMPLETED',
          createdAt: { gte: todayStart },
          order: orderWhere
        }
      }),
      prisma.orderStatusHistory.count({
        where: {
          toStatus: { in: ['FABRIC_IN_PROGRESS', 'CUTTING_IN_PROGRESS', 'TAILOR_IN_PROGRESS', 'QC_IN_PROGRESS'] },
          createdAt: { gte: todayStart },
          order: orderWhere
        }
      }),
      prisma.rejection.count({
        where: {
          createdAt: { gte: todayStart },
          order: orderWhere
        }
      }),
      prisma.activityLog.count({
        where: {
          action: 'LOGIN',
          createdAt: { gte: todayStart }
        }
      }),
      prisma.order.findMany({
        where: {
          ...orderWhere,
          status: { not: 'COMPLETED' }
        },
        select: {
          id: true,
          orderCode: true,
          status: true,
          details: true
        }
      })
    ]);

    const now = Date.now();
    const overdue = overdueOrders.filter((order) => {
      const details = parseDetails(order.details);
      if (!details.deliveryDate) return false;
      const due = new Date(details.deliveryDate).getTime();
      return Number.isFinite(due) && due < now;
    });

    res.json({
      success: true,
      data: {
        ordersCompletedToday,
        ordersStartedToday,
        rejectionsToday,
        employeesActiveToday,
        overdueOrders: overdue
      },
      message: 'Daily summary fetched'
    });
  } catch (error) {
    console.error('reports/daily-summary error:', error);
    res.status(500).json({ success: false, data: {}, message: 'Failed to fetch daily summary' });
  }
});

export default router;
