import express from 'express';
import { PrismaClient } from '@prisma/client';
import { authMiddleware, roleGuard } from '../middleware/auth.js';

const router = express.Router();
const prisma = new PrismaClient();

const WORKER_ROLES = ['FABRIC_MAN', 'CUTTER', 'TAILOR', 'SUPERVISOR'];
const ISSUE_REPORTED_ACTION = 'ORDER_ISSUE_REPORTED';
const ISSUE_RESOLVED_ACTION = 'ORDER_ISSUE_RESOLVED';

const ROLE_STATUS_FILTER = {
  FABRIC_MAN: ['ASSIGNED', 'FABRIC_IN_PROGRESS'],
  CUTTER: ['FABRIC_DONE', 'CUTTING_IN_PROGRESS'],
  TAILOR: ['CUTTING_DONE', 'TAILOR_IN_PROGRESS', 'REJECTED'],
  SUPERVISOR: ['TAILOR_DONE', 'QC_IN_PROGRESS', 'REJECTED']
};

const ROLE_DONE_STATUS = {
  FABRIC_MAN: 'FABRIC_DONE',
  CUTTER: 'CUTTING_DONE',
  TAILOR: 'TAILOR_DONE',
  SUPERVISOR: 'COMPLETED'
};

const ROLE_IN_PROGRESS_STATUS = {
  FABRIC_MAN: 'FABRIC_IN_PROGRESS',
  CUTTER: 'CUTTING_IN_PROGRESS',
  TAILOR: 'TAILOR_IN_PROGRESS',
  SUPERVISOR: 'QC_IN_PROGRESS'
};

const ROLE_HISTORY_DONE_OR_LATER = {
  FABRIC_MAN: ['FABRIC_DONE', 'CUTTING_IN_PROGRESS', 'CUTTING_DONE', 'TAILOR_IN_PROGRESS', 'TAILOR_DONE', 'QC_IN_PROGRESS', 'COMPLETED', 'REJECTED'],
  CUTTER: ['CUTTING_DONE', 'TAILOR_IN_PROGRESS', 'TAILOR_DONE', 'QC_IN_PROGRESS', 'COMPLETED', 'REJECTED'],
  TAILOR: ['TAILOR_DONE', 'QC_IN_PROGRESS', 'COMPLETED', 'REJECTED'],
  SUPERVISOR: ['COMPLETED']
};

const PREVIOUS_ROLE_BY_ROLE = {
  CUTTER: 'FABRIC_MAN',
  TAILOR: 'CUTTER',
  SUPERVISOR: 'TAILOR'
};

const getUnresolvedIssueMapByOrder = (logs = []) => {
  const unresolvedByOrder = new Map();

  logs.forEach((log) => {
    if (!log.orderId) return;
    if (!unresolvedByOrder.has(log.orderId)) unresolvedByOrder.set(log.orderId, new Set());
    const unresolvedSet = unresolvedByOrder.get(log.orderId);

    if (log.action === ISSUE_REPORTED_ACTION) {
      unresolvedSet.add(log.id);
      return;
    }

    if (log.action === ISSUE_RESOLVED_ACTION) {
      const reportedActivityId = log.metadata?.reportedActivityId;
      if (reportedActivityId && unresolvedSet.has(reportedActivityId)) {
        unresolvedSet.delete(reportedActivityId);
      }
    }
  });

  return unresolvedByOrder;
};

const normalizeOrder = (assignment, handoffByOrderId = new Map()) => {
  const order = assignment.order;
  const details = order?.details && typeof order.details === 'object' ? order.details : {};
  const companyFields = details.companyFields && typeof details.companyFields === 'object' ? details.companyFields : {};
  const latestRejection = (order?.rejections || [])[0] || null;
  const handoffFrom = handoffByOrderId.get(assignment.orderId) || null;

  return {
    id: order.id,
    orderCode: order.orderCode,
    size: order.size,
    status: order.status,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    assignedAt: assignment.assignedAt,
    startedAt: assignment.startedAt,
    completedAt: assignment.completedAt,
    details,
    companyFields,
    latestRejection,
    isReturned: Boolean(order.status === 'REJECTED' || latestRejection),
    handoffFrom
  };
};

const buildHandoffMap = async (role, orderIds = []) => {
  const previousRole = PREVIOUS_ROLE_BY_ROLE[role];
  if (!previousRole || orderIds.length === 0) return new Map();

  const previousAssignments = await prisma.orderAssignment.findMany({
    where: {
      orderId: { in: orderIds },
      role: previousRole,
      completedAt: { not: null }
    },
    orderBy: [{ completedAt: 'desc' }, { assignedAt: 'desc' }],
    include: {
      employee: {
        select: { id: true, empId: true, name: true, role: true }
      }
    }
  });

  const handoffByOrderId = new Map();
  previousAssignments.forEach((assignment) => {
    if (!handoffByOrderId.has(assignment.orderId)) {
      handoffByOrderId.set(assignment.orderId, {
        employeeId: assignment.employee?.id || assignment.employeeId,
        empId: assignment.employee?.empId || null,
        name: assignment.employee?.name || null,
        role: assignment.employee?.role || previousRole,
        completedAt: assignment.completedAt || null
      });
    }
  });

  return handoffByOrderId;
};

router.get('/my-orders', authMiddleware, roleGuard(...WORKER_ROLES), async (req, res) => {
  try {
    const role = req.user.role;
    const allowedStatuses = ROLE_STATUS_FILTER[role] || [];
    const pageNum = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);

    const where = {
      employeeId: req.user.id,
      role,
      order: {
        OR: [
          { status: { in: allowedStatuses } },
          {
            AND: [
              { status: 'REJECTED' },
              { rejections: { some: { routedTo: role, resolvedAt: null } } }
            ]
          }
        ]
      }
    };

    const assignments = await prisma.orderAssignment.findMany({
      where,
      orderBy: { assignedAt: 'desc' },
      include: {
        order: {
          include: {
            rejections: {
              orderBy: { createdAt: 'desc' },
              take: 1
            }
          }
        }
      }
    });

    const orderIds = assignments.map((assignment) => assignment.orderId).filter(Boolean);
    let visibleAssignments = assignments;

    if (orderIds.length > 0) {
      const issueLogs = await prisma.activityLog.findMany({
        where: {
          orderId: { in: orderIds },
          action: { in: [ISSUE_REPORTED_ACTION, ISSUE_RESOLVED_ACTION] }
        },
        select: { id: true, action: true, orderId: true, metadata: true, createdAt: true },
        orderBy: { createdAt: 'asc' }
      });

      const unresolvedByOrder = getUnresolvedIssueMapByOrder(issueLogs);
      visibleAssignments = assignments.filter((assignment) => {
        const unresolvedSet = unresolvedByOrder.get(assignment.orderId);
        return !unresolvedSet || unresolvedSet.size === 0;
      });
    }

    const handoffByOrderId = await buildHandoffMap(role, visibleAssignments.map((assignment) => assignment.orderId));

    const total = visibleAssignments.length;
    const start = (pageNum - 1) * limitNum;
    const items = visibleAssignments.slice(start, start + limitNum);

    res.json({
      success: true,
      data: {
        role,
        items: items.map((assignment) => normalizeOrder(assignment, handoffByOrderId)),
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum)
      },
      message: 'Worker orders fetched'
    });
  } catch (error) {
    console.error('worker/my-orders error:', error);
    res.status(500).json({ success: false, data: {}, message: 'Failed to load worker orders' });
  }
});

router.get('/my-orders/history', authMiddleware, roleGuard(...WORKER_ROLES), async (req, res) => {
  try {
    const role = req.user.role;
    const doneOrLaterStatuses = ROLE_HISTORY_DONE_OR_LATER[role] || [];
    const days = Number(req.query.days || 30);
    const pageNum = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const fromDate = new Date(Date.now() - Math.max(days, 1) * 24 * 60 * 60 * 1000);

    const where = {
      employeeId: req.user.id,
      role,
      OR: [
        { completedAt: { not: null } },
        { order: { status: { in: doneOrLaterStatuses } } }
      ]
    };

    const completedAssignments = await prisma.orderAssignment.findMany({
      where,
      orderBy: [{ completedAt: 'desc' }, { assignedAt: 'desc' }],
      include: {
        order: {
          include: {
            rejections: true
          }
        }
      }
    });

    const handoffByOrderId = await buildHandoffMap(role, completedAssignments.map((assignment) => assignment.orderId));

    const normalizedItems = completedAssignments
      .map((assignment) => {
        const base = normalizeOrder(assignment, handoffByOrderId);
        const returnedCount = (assignment.order.rejections || []).filter((rej) => rej.routedTo === role).length;
        const effectiveCompletedAt = assignment.completedAt || assignment.order.updatedAt || assignment.order.createdAt;
        return {
          ...base,
          returnedCount,
          effectiveCompletedAt
        };
      })
      .filter((item) => item.effectiveCompletedAt && new Date(item.effectiveCompletedAt) >= fromDate)
      .sort((a, b) => new Date(b.effectiveCompletedAt).getTime() - new Date(a.effectiveCompletedAt).getTime());

    const total = normalizedItems.length;
    const start = (pageNum - 1) * limitNum;
    const items = normalizedItems.slice(start, start + limitNum);

    res.json({
      success: true,
      data: {
        role,
        days,
        items,
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum)
      },
      message: 'Worker order history fetched'
    });
  } catch (error) {
    console.error('worker/my-orders/history error:', error);
    res.status(500).json({ success: false, data: {}, message: 'Failed to load worker order history' });
  }
});

router.get('/my-stats', authMiddleware, roleGuard(...WORKER_ROLES), async (req, res) => {
  try {
    const role = req.user.role;
    const doneOrLaterStatuses = ROLE_HISTORY_DONE_OR_LATER[role] || [];
    const inProgressStatus = ROLE_IN_PROGRESS_STATUS[role];

    const [completedAssignments, activeAssignments, returnedByRejection, reportedByIssue] = await Promise.all([
      prisma.orderAssignment.findMany({
        where: {
          employeeId: req.user.id,
          role,
          OR: [
            { completedAt: { not: null } },
            { order: { status: { in: doneOrLaterStatuses } } }
          ]
        },
        select: {
          id: true,
          completedAt: true,
          order: {
            select: {
              status: true,
              updatedAt: true,
              createdAt: true
            }
          }
        }
      }),
      prisma.orderAssignment.count({
        where: {
          employeeId: req.user.id,
          role,
          order: { status: inProgressStatus }
        }
      }),
      prisma.rejection.count({
        where: {
          routedTo: role,
          order: {
            assignments: {
              some: {
                employeeId: req.user.id,
                role
              }
            }
          }
        }
      }),
      prisma.activityLog.count({
        where: {
          employeeId: req.user.id,
          action: ISSUE_REPORTED_ACTION,
          orderId: { not: null }
        }
      })
    ]);

    const totalCompleted = completedAssignments.length;
    const currentActive = activeAssignments;
    const totalReturned = returnedByRejection + reportedByIssue;

    res.json({
      success: true,
      data: {
        role,
        totalCompleted,
        totalReturned,
        currentActive
      },
      message: 'Worker stats fetched'
    });
  } catch (error) {
    console.error('worker/my-stats error:', error);
    res.status(500).json({ success: false, data: {}, message: 'Failed to load worker stats' });
  }
});

export default router;
