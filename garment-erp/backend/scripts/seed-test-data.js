#!/usr/bin/env node

/**
 * Quick test data setup script
 * Creates test employees for Phase 1 testing
 * 
 * Usage:
 * cd backend
 * node scripts/seed-test-data.js
 */

import { PrismaClient } from '@prisma/client';
import { hashCredential } from '../src/utils/auth.js';

const prisma = new PrismaClient();

const testEmployees = [
  {
    empId: 'EMP-ADMIN-001',
    name: 'Admin Test User',
    designation: 'System Admin',
    role: 'ADMIN',
    credential: 'admin12345' // Use bcrypt to hash
  },
  {
    empId: 'EMP-MGR-001',
    name: 'Manager Test User',
    designation: 'Production Manager',
    role: 'MANAGER',
    credential: 'manager12345'
  },
  {
    empId: 'EMP-FABRIC-001',
    name: 'Fabric Man Test',
    designation: 'Fabric Manager',
    role: 'FABRIC_MAN',
    credential: '123456'
  },
  {
    empId: 'EMP-CUT-001',
    name: 'Cutter Test User',
    designation: 'Cutting Master',
    role: 'CUTTER',
    credential: '654321'
  },
  {
    empId: 'EMP-TAILOR-001',
    name: 'Tailor Test User',
    designation: 'Master Tailor',
    role: 'TAILOR',
    credential: '111111'
  },
  {
    empId: 'EMP-SUPERVISOR-001',
    name: 'Supervisor Test User',
    designation: 'QC Supervisor',
    role: 'SUPERVISOR',
    credential: '999999'
  }
];

async function main() {
  console.log('🌱 Seeding test data...');

  for (const emp of testEmployees) {
    const hashedCredential = await hashCredential(emp.credential);

    const data = {
      empId: emp.empId,
      name: emp.name,
      designation: emp.designation,
      role: emp.role,
      isActive: true,
      isFirstLogin: false // Pre-created for testing
    };

    if (emp.role === 'ADMIN' || emp.role === 'MANAGER') {
      data.password = hashedCredential;
    } else {
      data.pin = hashedCredential;
    }

    try {
      const created = await prisma.employee.create({ data });
      console.log(`✅ Created: ${emp.empId} (${emp.name})`);
    } catch (error) {
      if (error.code === 'P2002') {
        console.log(`⏭️  Skipped: ${emp.empId} (already exists)`);
      } else {
        console.error(`❌ Error creating ${emp.empId}:`, error.message);
      }
    }
  }

  console.log('\n📋 Test Credentials:');
  console.log('Admin:      EMP-ADMIN-001 / admin12345');
  console.log('Manager:    EMP-MGR-001 / manager12345');
  console.log('Fabric:     EMP-FABRIC-001 / 123456');
  console.log('Cutter:     EMP-CUT-001 / 654321');
  console.log('Tailor:     EMP-TAILOR-001 / 111111');
  console.log('Supervisor: EMP-SUPERVISOR-001 / 999999');
  console.log('\n✨ Seed complete!\n');
}

main()
  .catch((error) => {
    console.error('Error seeding data:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
