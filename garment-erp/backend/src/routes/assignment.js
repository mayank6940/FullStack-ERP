import express from 'express';
import { authMiddleware, roleGuard } from '../middleware/auth.js';
import AssignmentService from '../services/AssignmentService.js';
import prisma from '../prisma/client.js';

const router = express.Router();
const assignmentService = new AssignmentService(prisma);

router.get('/workload', authMiddleware, roleGuard('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const employees = await prisma.employee.findMany({
      where: {
        isActive: true,
        role: { in: ['FABRIC_MAN', 'CUTTER', 'TAILOR'] }
      },
      select: {
        id: true,
        empId: true,
        name: true,
        role: true
      }
    });

    const workloads = await Promise.all(
      employees.map(async (employee) => ({
        ...employee,
        ...(await assignmentService.getWorkload(employee.id))
      }))
    );

    res.json({ success: true, data: { workloads }, message: 'Workload fetched' });
  } catch (error) {
    console.error('assignment/workload error:', error);
    res.status(500).json({ success: false, data: {}, message: 'Failed to fetch workloads' });
  }
});

router.get('/available/:role', authMiddleware, roleGuard('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const role = String(req.params.role || '').toUpperCase();
    const validRoles = ['FABRIC_MAN', 'CUTTER', 'TAILOR'];

    if (!validRoles.includes(role)) {
      return res.status(400).json({ success: false, data: {}, message: 'Invalid role' });
    }

    const workers = await assignmentService.getAvailableWorkers(role);
    res.json({ success: true, data: { workers }, message: 'Available workers fetched' });
  } catch (error) {
    console.error('assignment/available error:', error);
    res.status(500).json({ success: false, data: {}, message: 'Failed to fetch available workers' });
  }
});

router.get('/suggestions/:orderId', authMiddleware, roleGuard('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const limitPerRole = Number.parseInt(req.query.limitPerRole, 10) || 5;
    const suggestions = await assignmentService.getOrderAssignmentSuggestions(req.params.orderId, {
      limitPerRole: Math.min(Math.max(limitPerRole, 1), 20)
    });

    res.json({ success: true, data: { suggestions }, message: 'Assignment suggestions fetched' });
  } catch (error) {
    console.error('assignment/suggestions error:', error);
    res.status(400).json({ success: false, data: {}, message: error.message || 'Failed to fetch assignment suggestions' });
  }
});

export default router;
