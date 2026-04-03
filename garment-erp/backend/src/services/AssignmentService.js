import { PrismaClient, OrderStatus } from '@prisma/client';

const WORKER_COUNT_BY_SIZE = {
  SMALL: 1,
  MEDIUM: 2,
  LARGE: 2
};

const IN_PROGRESS_STATUSES = [
  OrderStatus.FABRIC_IN_PROGRESS,
  OrderStatus.CUTTING_IN_PROGRESS,
  OrderStatus.TAILOR_IN_PROGRESS,
  OrderStatus.QC_IN_PROGRESS
];

class AssignmentService {
  constructor(prisma = new PrismaClient()) {
    this.prisma = prisma;
  }

  async assignOrder(orderId) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) {
      throw new Error('Order not found');
    }

    const workersPerRole = WORKER_COUNT_BY_SIZE[order.size] || 1;
    const assignmentRoles = ['FABRIC_MAN', 'CUTTER', 'TAILOR'];
    const assigned = [];

    for (const role of assignmentRoles) {
      const available = await this.getAvailableWorkers(role);
      if (available.length === 0) {
        throw new Error(`No available workers for role ${role}`);
      }

      const ranked = await this._scoreWorkers(available, role);
      const selected = ranked.slice(0, Math.min(workersPerRole, ranked.length));

      for (const worker of selected) {
        const record = await this.prisma.orderAssignment.create({
          data: {
            orderId,
            employeeId: worker.id,
            role
          }
        });
        assigned.push(record);
      }
    }

    await this.prisma.order.update({
      where: { id: orderId },
      data: { status: 'ASSIGNED' }
    });

    return {
      orderId,
      assignmentsCount: assigned.length,
      assignments: assigned
    };
  }

  async getWorkload(employeeId) {
    const totalAssigned = await this.prisma.orderAssignment.count({ where: { employeeId } });

    const completed = await this.prisma.orderAssignment.count({
      where: { employeeId, completedAt: { not: null } }
    });

    const active = await this.prisma.orderAssignment.count({
      where: {
        employeeId,
        order: {
          status: { in: IN_PROGRESS_STATUSES }
        }
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

  async getAvailableWorkers(role) {
    const workers = await this.prisma.employee.findMany({
      where: {
        role,
        isActive: true
      },
      select: {
        id: true,
        empId: true,
        name: true,
        role: true
      }
    });

    const workerIds = workers.map((w) => w.id);
    if (workerIds.length === 0) return [];

    const busyAssignments = await this.prisma.orderAssignment.findMany({
      where: {
        employeeId: { in: workerIds },
        order: {
          status: { in: IN_PROGRESS_STATUSES }
        }
      },
      select: { employeeId: true }
    });

    const busySet = new Set(busyAssignments.map((b) => b.employeeId));
    return workers.filter((w) => !busySet.has(w.id));
  }

  async _scoreWorkers(workers, role) {
    const scored = [];

    for (const worker of workers) {
      const totalAssigned = await this.prisma.orderAssignment.count({
        where: { employeeId: worker.id, role }
      });

      const totalCompleted = await this.prisma.orderAssignment.count({
        where: { employeeId: worker.id, role, completedAt: { not: null } }
      });

      const activeAssignments = await this.prisma.orderAssignment.count({
        where: {
          employeeId: worker.id,
          role,
          order: {
            status: { in: IN_PROGRESS_STATUSES }
          }
        }
      });

      const lastAssignment = await this.prisma.orderAssignment.findFirst({
        where: { employeeId: worker.id, role },
        orderBy: { assignedAt: 'desc' },
        select: { assignedAt: true }
      });

      const score = totalCompleted / (totalAssigned + 1);
      const lastAssignedAt = lastAssignment?.assignedAt ? new Date(lastAssignment.assignedAt).getTime() : 0;

      scored.push({
        ...worker,
        score,
        activeAssignments,
        lastAssignedAt
      });
    }

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.activeAssignments !== b.activeAssignments) return a.activeAssignments - b.activeAssignments;
      return a.lastAssignedAt - b.lastAssignedAt;
    });

    return scored;
  }
}

export default AssignmentService;
export { WORKER_COUNT_BY_SIZE, IN_PROGRESS_STATUSES };
