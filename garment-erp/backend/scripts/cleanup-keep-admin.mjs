import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const admins = await prisma.employee.findMany({
    where: { role: 'ADMIN' },
    select: { id: true, empId: true, name: true },
  });

  if (admins.length === 0) {
    throw new Error('No ADMIN user found. Cleanup aborted to prevent lockout.');
  }

  await prisma.$transaction(async (tx) => {
    await tx.orderStatusHistory.deleteMany({});
    await tx.orderAssignment.deleteMany({});
    await tx.rejection.deleteMany({});
    await tx.activityLog.deleteMany({});
    await tx.order.deleteMany({});
    await tx.csvBatch.deleteMany({});
    await tx.columnMappingTemplate.deleteMany({});
    await tx.employee.deleteMany({ where: { role: { not: 'ADMIN' } } });
  });

  const counts = {
    employees: await prisma.employee.count(),
    orders: await prisma.order.count(),
    batches: await prisma.csvBatch.count(),
    assignments: await prisma.orderAssignment.count(),
    rejections: await prisma.rejection.count(),
    activities: await prisma.activityLog.count(),
    templates: await prisma.columnMappingTemplate.count(),
    history: await prisma.orderStatusHistory.count(),
  };

  console.log('Cleanup complete');
  console.log('Admins kept:', admins.map((a) => `${a.empId}:${a.name}`).join(', '));
  console.log('Counts:', counts);
}

main()
  .catch((err) => {
    console.error(err.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
