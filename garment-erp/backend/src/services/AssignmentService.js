import { Prisma, OrderStatus } from '@prisma/client';
import sharedPrisma from '../prisma/client.js';

const ASSIGNMENT_ROLES = ['FABRIC_MAN', 'CUTTER', 'TAILOR'];
const DEFAULT_MAX_ACTIVE_PER_EMPLOYEE = Number.parseInt(process.env.ASSIGNMENT_MAX_ACTIVE_PER_EMPLOYEE || '4', 10) || 4;

const IN_PROGRESS_STATUSES = [
  OrderStatus.ASSIGNED,
  OrderStatus.FABRIC_IN_PROGRESS,
  OrderStatus.CUTTING_IN_PROGRESS,
  OrderStatus.TAILOR_IN_PROGRESS,
  OrderStatus.QC_IN_PROGRESS
];

const TERMINAL_ORDER_STATUSES = [OrderStatus.COMPLETED];

const ASSIGNMENT_TRANSACTION_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable
};

const isNoActiveWorkersAvailableError = (error) => /no active workers available for role/i.test(String(error?.message || ''));

class AssignmentService {
  constructor(prisma = sharedPrisma) {
    this.prisma = prisma;
  }

  async assignOrder(orderId, options = {}) {
    const { overrides = {} } = options;

    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: {
          assignments: {
            include: {
              employee: {
                select: {
                  id: true,
                  empId: true,
                  name: true,
                  role: true,
                  isActive: true
                }
              }
            }
          }
        }
      });

      if (!order) {
        throw new Error('Order not found');
      }

      if (TERMINAL_ORDER_STATUSES.includes(order.status)) {
        throw new Error('Completed order cannot be reassigned');
      }

      const existingByRole = new Map(
        (order.assignments || []).map((assignment) => [assignment.role, assignment])
      );
      const assigned = [];

      for (const role of ASSIGNMENT_ROLES) {
        const existing = existingByRole.get(role);
        if (existing) {
          assigned.push(existing);
          continue;
        }

        let selectedWorker = null;
        const overrideEmployeeId = overrides?.[role];

        if (overrideEmployeeId) {
          selectedWorker = await this._validateOverrideWorker(tx, role, overrideEmployeeId);
        } else {
          const suggestions = await this.getSuggestedWorkersForRole(role, { tx, limit: 5 });
          if (suggestions.length === 0) {
            throw new Error(`No active workers available for role ${role}`);
          }
          selectedWorker = suggestions[0];
        }

        const created = await this._createRoleAssignment(tx, orderId, role, selectedWorker.id);
        assigned.push(created);
      }

      if (order.status === OrderStatus.RECEIVED) {
        await tx.order.update({
          where: { id: orderId },
          data: { status: OrderStatus.ASSIGNED }
        });
      }

      return {
        orderId,
        assignmentsCount: assigned.length,
        assignments: assigned
      };
    }, ASSIGNMENT_TRANSACTION_OPTIONS);
  }

  async getWorkload(employeeId) {
    const totalAssigned = await this.prisma.orderAssignment.count({ where: { employeeId } });

    const completed = await this.prisma.orderAssignment.count({
      where: { employeeId, completedAt: { not: null } }
    });

    const active = await this.prisma.orderAssignment.count({
      where: {
        employeeId,
        completedAt: null,
        order: { status: { in: IN_PROGRESS_STATUSES } }
      }
    });

    const rejections = await this.prisma.rejection.count({
      where: {
        order: {
          assignments: {
            some: { employeeId }
          }
        }
      }
    });

    return {
      employeeId,
      totalAssigned,
      completed,
      active,
      rejections
    };
  }

  async getAvailableWorkers(role, options = {}) {
    const maxActive = Number.isFinite(options.maxActive) ? options.maxActive : DEFAULT_MAX_ACTIVE_PER_EMPLOYEE;
    const suggestions = await this.getSuggestedWorkersForRole(role, {
      limit: options.limit || 200,
      maxActive,
      includeAtCapacity: true
    });

    const preferred = suggestions.filter((worker) => worker.activeAssignments < maxActive);
    return preferred.length > 0 ? preferred : suggestions;
  }

  async getSuggestedWorkersForRole(role, options = {}) {
    const tx = options.tx || this.prisma;
    const limit = Number.isFinite(options.limit) ? options.limit : 10;
    const maxActive = Number.isFinite(options.maxActive) ? options.maxActive : DEFAULT_MAX_ACTIVE_PER_EMPLOYEE;
    const includeAtCapacity = Boolean(options.includeAtCapacity);

    const workers = await tx.employee.findMany({
      where: {
        role,
        isActive: true
      },
      select: {
        id: true,
        empId: true,
        name: true,
        role: true,
        lastLogin: true
      }
    });

    if (workers.length === 0) return [];

    const workerIds = workers.map((worker) => worker.id);
    const [activeByEmployee, totalByEmployee, completedByEmployee, lastByEmployee] = await Promise.all([
      tx.orderAssignment.groupBy({
        by: ['employeeId'],
        where: {
          employeeId: { in: workerIds },
          role,
          completedAt: null,
          order: {
            status: { in: IN_PROGRESS_STATUSES }
          }
        },
        _count: { _all: true }
      }),
      tx.orderAssignment.groupBy({
        by: ['employeeId'],
        where: {
          employeeId: { in: workerIds },
          role
        },
        _count: { _all: true }
      }),
      tx.orderAssignment.groupBy({
        by: ['employeeId'],
        where: {
          employeeId: { in: workerIds },
          role,
          completedAt: { not: null }
        },
        _count: { _all: true }
      }),
      tx.orderAssignment.groupBy({
        by: ['employeeId'],
        where: {
          employeeId: { in: workerIds },
          role
        },
        _max: { assignedAt: true }
      })
    ]);

    const activeMap = new Map(activeByEmployee.map((row) => [row.employeeId, row._count._all]));
    const totalMap = new Map(totalByEmployee.map((row) => [row.employeeId, row._count._all]));
    const completedMap = new Map(completedByEmployee.map((row) => [row.employeeId, row._count._all]));
    const lastAssignedMap = new Map(lastByEmployee.map((row) => [row.employeeId, row._max.assignedAt]));

    const nowMs = Date.now();

    const scored = workers.map((worker) => {
      const activeAssignments = activeMap.get(worker.id) || 0;
      const totalAssigned = totalMap.get(worker.id) || 0;
      const totalCompleted = completedMap.get(worker.id) || 0;
      const lastAssignedAt = lastAssignedMap.get(worker.id) || null;
      const lastAssignedMs = lastAssignedAt ? new Date(lastAssignedAt).getTime() : 0;

      // Priority is biased for fairness first, then quality, so no employee is starved.
      const workloadScore = 1 / (1 + activeAssignments);
      const rotationScore = 1 / (1 + totalAssigned);
      const idleHours = lastAssignedAt ? (nowMs - lastAssignedMs) / (1000 * 60 * 60) : 24 * 365;
      const idleScore = Math.min(idleHours / 48, 1);
      const qualityScore = totalAssigned > 0 ? totalCompleted / totalAssigned : 0.5;
      const fairnessScore = (workloadScore * 0.45) + (rotationScore * 0.35) + (idleScore * 0.20);
      const score = Number((fairnessScore + (qualityScore * 0.05)).toFixed(6));

      return {
        ...worker,
        activeAssignments,
        totalAssigned,
        totalCompleted,
        lastAssignedAt,
        score,
        isAtCapacity: activeAssignments >= maxActive
      };
    });

    scored.sort((a, b) => {
      if (a.isAtCapacity !== b.isAtCapacity) return a.isAtCapacity ? 1 : -1;
      if (a.activeAssignments !== b.activeAssignments) return a.activeAssignments - b.activeAssignments;
      if (a.totalAssigned !== b.totalAssigned) return a.totalAssigned - b.totalAssigned;

      const aLast = a.lastAssignedAt ? new Date(a.lastAssignedAt).getTime() : 0;
      const bLast = b.lastAssignedAt ? new Date(b.lastAssignedAt).getTime() : 0;
      if (aLast !== bLast) return aLast - bLast;

      if (b.score !== a.score) return b.score - a.score;
      return String(a.empId || a.id).localeCompare(String(b.empId || b.id));
    });

    const filtered = includeAtCapacity ? scored : scored.filter((worker) => !worker.isAtCapacity);
    return filtered.slice(0, limit);
  }

  async getOrderAssignmentSuggestions(orderId, options = {}) {
    const limitPerRole = Number.isFinite(options.limitPerRole) ? options.limitPerRole : 5;
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        assignments: true
      }
    });

    if (!order) {
      throw new Error('Order not found');
    }

    const existingByRole = new Map((order.assignments || []).map((assignment) => [assignment.role, assignment]));
    const suggestions = {};

    for (const role of ASSIGNMENT_ROLES) {
      const existing = existingByRole.get(role);
      if (existing) {
        suggestions[role] = {
          alreadyAssigned: true,
          currentAssignment: existing,
          suggestions: []
        };
        continue;
      }

      const ranked = await this.getSuggestedWorkersForRole(role, { limit: limitPerRole, includeAtCapacity: true });
      suggestions[role] = {
        alreadyAssigned: false,
        currentAssignment: null,
        suggestions: ranked
      };
    }

    return {
      orderId,
      orderStatus: order.status,
      suggestions
    };
  }

  async assignUnassignedOrders(options = {}) {
    const limit = Number.isFinite(options.limit) ? options.limit : 200;

    const pendingOrders = await this.prisma.order.findMany({
      where: {
        status: OrderStatus.RECEIVED,
        assignments: { none: {} },
        OR: [
          { parentOrderId: { not: null } },
          { subOrders: { none: {} } }
        ]
      },
      select: {
        id: true,
        orderCode: true,
        parentOrderId: true
      },
      orderBy: { createdAt: 'asc' },
      take: Math.min(Math.max(limit, 1), 1000)
    });

    const assignedOrders = [];
    const skippedOrders = [];

    for (const order of pendingOrders) {
      try {
        const result = await this.assignOrder(order.id);
        assignedOrders.push({
          orderId: order.id,
          orderCode: order.orderCode,
          assignmentsCount: result.assignmentsCount
        });

        if (order.parentOrderId) {
          await this.prisma.order.updateMany({
            where: {
              id: order.parentOrderId,
              status: OrderStatus.RECEIVED
            },
            data: { status: OrderStatus.ASSIGNED }
          });
        }
      } catch (error) {
        if (isNoActiveWorkersAvailableError(error)) {
          skippedOrders.push({
            orderId: order.id,
            orderCode: order.orderCode,
            reason: String(error.message || 'No active workers available')
          });
          continue;
        }

        throw error;
      }
    }

    return {
      scannedOrders: pendingOrders.length,
      assignedOrders,
      skippedOrders,
      assignedCount: assignedOrders.length,
      skippedCount: skippedOrders.length
    };
  }

  async _validateOverrideWorker(tx, role, employeeId) {
    const employee = await tx.employee.findUnique({
      where: { id: employeeId },
      select: {
        id: true,
        empId: true,
        name: true,
        role: true,
        isActive: true
      }
    });

    if (!employee || !employee.isActive || employee.role !== role) {
      throw new Error(`Override employee is invalid for role ${role}`);
    }

    return employee;
  }

  async _createRoleAssignment(tx, orderId, role, employeeId) {
    try {
      return await tx.orderAssignment.create({
        data: {
          orderId,
          employeeId,
          role
        },
        include: {
          employee: {
            select: {
              id: true,
              empId: true,
              name: true,
              role: true
            }
          }
        }
      });
    } catch (error) {
      if (error?.code === 'P2002') {
        const existing = await tx.orderAssignment.findFirst({
          where: { orderId, role },
          include: {
            employee: {
              select: {
                id: true,
                empId: true,
                name: true,
                role: true
              }
            }
          }
        });

        if (existing) return existing;
      }
      throw error;
    }
  }
}

export default AssignmentService;
export { ASSIGNMENT_ROLES, DEFAULT_MAX_ACTIVE_PER_EMPLOYEE, IN_PROGRESS_STATUSES };
