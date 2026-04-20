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

router.post('/retry-pending', authMiddleware, roleGuard('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const requestedLimit = Number.parseInt(req.body?.limit, 10);
    const replay = await assignmentService.assignUnassignedOrders({
      limit: Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 1000) : 300
    });

    const roles = ['FABRIC_MAN', 'CUTTER', 'TAILOR'];
    const availabilityEntries = await Promise.all(
      roles.map(async (role) => {
        const workers = await assignmentService.getAvailableWorkers(role, { limit: 500 });
        return [role, workers.length];
      })
    );
    const activeWorkersByRole = Object.fromEntries(availabilityEntries);

    res.json({
      success: true,
      data: {
        ...replay,
        activeWorkersByRole
      },
      message: replay.assignedCount > 0
        ? `Assigned ${replay.assignedCount} pending orders`
        : 'No pending orders could be assigned with current worker availability'
    });
  } catch (error) {
    console.error('assignment/retry-pending error:', error);
    res.status(500).json({ success: false, data: {}, message: 'Failed to retry pending order assignments' });
  }
});

export default router;
