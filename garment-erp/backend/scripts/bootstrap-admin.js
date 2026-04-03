#!/usr/bin/env node

import { PrismaClient } from '@prisma/client';
import { hashCredential } from '../src/utils/auth.js';

const prisma = new PrismaClient();

const requiredEnv = ['ADMIN_BOOTSTRAP_EMP_ID', 'ADMIN_BOOTSTRAP_NAME', 'ADMIN_BOOTSTRAP_PASSWORD'];

function readRequiredEnv(key) {
  const value = process.env[key];
  if (!value || !value.trim()) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value.trim();
}

async function main() {
  const empId = readRequiredEnv('ADMIN_BOOTSTRAP_EMP_ID');
  const name = readRequiredEnv('ADMIN_BOOTSTRAP_NAME');
  const password = readRequiredEnv('ADMIN_BOOTSTRAP_PASSWORD');

  const designation = (process.env.ADMIN_BOOTSTRAP_DESIGNATION || 'System Admin').trim();
  const allowPasswordReset = (process.env.ADMIN_BOOTSTRAP_ALLOW_RESET || 'false').toLowerCase() === 'true';

  const existing = await prisma.employee.findUnique({
    where: { empId },
    select: {
      id: true,
      role: true,
      isFirstLogin: true,
      password: true
    }
  });

  const hashedPassword = await hashCredential(password);

  if (!existing) {
    await prisma.employee.create({
      data: {
        empId,
        name,
        designation,
        role: 'ADMIN',
        isActive: true,
        isFirstLogin: false,
        password: hashedPassword
      }
    });

    console.log(`Created bootstrap admin: ${empId}`);
    return;
  }

  if (existing.role !== 'ADMIN') {
    throw new Error(`Employee ${empId} exists but is not ADMIN. Aborting.`);
  }

  if (!allowPasswordReset) {
    console.log(`Admin ${empId} already exists. No changes made.`);
    console.log('Set ADMIN_BOOTSTRAP_ALLOW_RESET=true to reset admin password intentionally.');
    return;
  }

  await prisma.employee.update({
    where: { empId },
    data: {
      name,
      designation,
      isActive: true,
      isFirstLogin: false,
      password: hashedPassword
    }
  });

  console.log(`Updated bootstrap admin password: ${empId}`);
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
