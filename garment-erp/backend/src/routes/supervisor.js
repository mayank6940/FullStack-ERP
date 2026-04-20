import express from 'express';
import { authMiddleware, roleGuard } from '../middleware/auth.js';
import prisma from '../prisma/client.js';

const router = express.Router();

router.get('/pending', authMiddleware, roleGuard('SUPERVISOR'), async (req, res) => {
  try {
    const pageNum = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);

    const where = { status: 'TAILOR_DONE' };
    const total = await prisma.order.count({ where });

    const orders = await prisma.order.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      skip: (pageNum - 1) * limitNum,
      take: limitNum,
      include: {
        assignments: {
          include: {
            employee: {
              select: { id: true, empId: true, name: true, role: true }
            }
          }
        },
        rejections: {
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    const items = orders.map((order) => {
      const latestRejection = order.rejections[0] || null;
      const assignmentsByRole = order.assignments.reduce((acc, assignment) => {
        const key = assignment.role;
        if (!acc[key]) acc[key] = [];
        acc[key].push({
          employeeId: assignment.employee.id,
          empId: assignment.employee.empId,
          name: assignment.employee.name,
          role: assignment.employee.role
        });
        return acc;
      }, {});

      return {
        id: order.id,
        orderCode: order.orderCode,
        size: order.size,
        status: order.status,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
        details: order.details,
        workers: {
          fabric: assignmentsByRole.FABRIC_MAN || [],
          cutter: assignmentsByRole.CUTTER || [],
          tailor: assignmentsByRole.TAILOR || []
        },
        rejectionCount: order.rejections.length,
        latestRejection
      };
    });

    res.json({
      success: true,
      data: {
        pendingCount: items.length,
        items,
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum)
      },
      message: 'Supervisor pending orders fetched'
    });
  } catch (error) {
    console.error('supervisor/pending error:', error);
    res.status(500).json({ success: false, data: {}, message: 'Failed to load pending checks' });
  }
});

router.get('/history', authMiddleware, roleGuard('SUPERVISOR'), async (req, res) => {
  try {
    const pageNum = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);

    const where = {
      employeeId: req.user.id,
      action: {
        in: ['ORDER_REJECTED', 'ORDER_PASSED']
      }
    };

    const total = await prisma.activityLog.count({ where });

    const logs = await prisma.activityLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (pageNum - 1) * limitNum,
      take: limitNum,
      include: {
        order: {
          select: {
            id: true,
            orderCode: true,
            details: true
          }
        }
      }
    });

    const items = logs.map((log) => ({
      id: log.id,
      orderId: log.orderId,
      orderCode: log.order?.orderCode || '-',
      articleName: log.order?.details?.articleName || '-',
      decision: log.action === 'ORDER_PASSED' ? 'PASS' : 'REJECT',
      reasonCategory: log.metadata?.reasonCategory || null,
      reason: log.metadata?.reason || null,
      routedTo: log.metadata?.routedTo || null,
      inspectedAt: log.createdAt
    }));

    res.json({
      success: true,
      data: {
        items,
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum)
      },
      message: 'Supervisor history fetched'
    });
  } catch (error) {
    console.error('supervisor/history error:', error);
    res.status(500).json({ success: false, data: {}, message: 'Failed to load supervisor history' });
  }
});

export default router;
