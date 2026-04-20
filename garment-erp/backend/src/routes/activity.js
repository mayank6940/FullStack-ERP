import express from 'express';
import { authMiddleware, roleGuard } from '../middleware/auth.js';
import prisma from '../prisma/client.js';

const router = express.Router();

router.get('/', authMiddleware, roleGuard('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { page = 1, limit = 20, employeeId, role, action, fromDate, toDate } = req.query;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);

    const where = {};
    if (employeeId) where.employeeId = employeeId;
    if (action) where.action = action;
    if (role) {
      where.employee = {
        role: String(role).toUpperCase()
      };
    }
    if (fromDate || toDate) {
      where.createdAt = {};
      if (fromDate) where.createdAt.gte = new Date(fromDate);
      if (toDate) where.createdAt.lte = new Date(toDate);
    }

    const total = await prisma.activityLog.count({ where });
    const items = await prisma.activityLog.findMany({
      where,
      include: {
        employee: {
          select: {
            id: true,
            empId: true,
            name: true,
            role: true
          }
        },
        order: {
          select: {
            id: true,
            orderCode: true,
            status: true,
            details: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      skip: (pageNum - 1) * limitNum,
      take: limitNum
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
      message: 'Activity log fetched'
    });
  } catch (error) {
    console.error('activity/list error:', error);
    res.status(500).json({ success: false, data: {}, message: 'Failed to fetch activity logs' });
  }
});

export default router;
