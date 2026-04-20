import express from 'express';
import csv from 'csv-parser';
import { Readable } from 'stream';
import { authMiddleware, roleGuard } from '../middleware/auth.js';
import { hashCredential, logActivity } from '../utils/auth.js';
import prisma from '../prisma/client.js';

const router = express.Router();

const normalizeHeader = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const getRowValueByAliases = (row, aliases) => {
  const entries = Object.entries(row || {});
  const aliasSet = new Set(aliases.map(normalizeHeader));

  for (const [key, value] of entries) {
    if (aliasSet.has(normalizeHeader(key))) {
      return String(value || '').trim();
    }
  }

  return '';
};

// Designation to Role mapping
const designationToRoleMap = (designation) => {
  if (!designation) return null;

  const lower = designation.toLowerCase();

  // Exact and partial matches
  if (lower.includes('fabric') || lower.includes('store incharge')) return 'FABRIC_MAN';
  if (lower.includes('cutter') || lower.includes('cutting')) return 'CUTTER';
  if (lower.includes('tailor') || lower.includes('stitching')) return 'TAILOR';
  if (lower.includes('supervisor') || lower.includes('qc') || lower.includes('quality')) return 'SUPERVISOR';
  if (lower.includes('manager') || lower.includes('production manager') || lower.includes('floor manager')) return 'MANAGER';
  if (lower.includes('executive')) return 'MANAGER';
  if (lower.includes('admin') || lower.includes('system admin')) return 'ADMIN';

  return null; // UNMAPPED
};

// POST /api/employees/csv-preview
// Parse CSV and return preview of changes without writing to DB
router.post('/csv-preview', authMiddleware, roleGuard('ADMIN'), async (req, res) => {
  try {
    // Get CSV file from request body or file upload
    const csvContent = req.body.csvContent;

    if (!csvContent) {
      return res.status(400).json({
        success: false,
        message: 'CSV content is required'
      });
    }

    const records = [];
    const parseStream = Readable.from([csvContent]);

    parseStream
      .pipe(csv())
      .on('data', (row) => {
        const empIdValue = getRowValueByAliases(row, ['EmpID', 'Emp ID', 'Employee ID', 'Emp_Id']);
        const nameValue = getRowValueByAliases(row, ['Name', 'Employee Name', 'Emp Name']);
        const designationValue = getRowValueByAliases(row, ['Designation', 'Role Designation']);

        if (empIdValue && nameValue) {
          records.push({
            empId: empIdValue,
            name: nameValue,
            designation: designationValue
          });
        }
      })
      .on('error', (error) => {
        return res.status(400).json({
          success: false,
          message: 'Failed to parse CSV: ' + error.message
        });
      })
      .on('end', async () => {
        // Get existing employees
        const existingEmployees = await prisma.employee.findMany();
        const existingMap = new Map(existingEmployees.map(e => [e.empId, e]));
        const seenEmpIds = new Set();

        // Categorize records
        const newEmployees = [];
        const updatedEmployees = [];
        const unchangedEmployees = [];
        const flaggedEmployees = [];
        const unmappedRoles = [];

        for (const record of records) {
          const normalizedEmpId = String(record.empId || '').trim();
          if (!normalizedEmpId) continue;

          if (seenEmpIds.has(normalizedEmpId)) {
            flaggedEmployees.push({
              ...record,
              empId: normalizedEmpId,
              issue: 'DUPLICATE_EMP_ID_IN_CSV'
            });
            continue;
          }
          seenEmpIds.add(normalizedEmpId);

          const mappedRole = designationToRoleMap(record.designation);

          if (!mappedRole) {
            unmappedRoles.push({
              ...record,
              empId: normalizedEmpId,
              issue: 'UNMAPPED_ROLE'
            });
          }

          if (existingMap.has(normalizedEmpId)) {
            const existing = existingMap.get(normalizedEmpId);
            if (existing.name !== record.name || existing.designation !== record.designation) {
              updatedEmployees.push({
                ...record,
                empId: normalizedEmpId,
                mappedRole,
                action: 'UPDATE'
              });
            } else {
              unchangedEmployees.push({
                ...record,
                empId: normalizedEmpId,
                action: 'SKIP_EXISTS',
                issue: 'EMP_ALREADY_EXISTS'
              });
            }
          } else {
            newEmployees.push({
              ...record,
              empId: normalizedEmpId,
              mappedRole,
              action: 'CREATE'
            });
          }
        }

        // Check for employees in DB but not in CSV
        const removedEmployees = [];
        for (const [empId, employee] of existingMap) {
          if (!records.some(r => r.empId === empId)) {
            removedEmployees.push({
              empId: employee.empId,
              name: employee.name,
              designation: employee.designation,
              action: 'FLAG_AS_LEFT',
              issue: 'MISSING_FROM_CSV'
            });
          }
        }

        res.json({
          success: true,
          data: {
            summary: {
              totalRecords: records.length,
              newEmployees: newEmployees.length,
              updatedEmployees: updatedEmployees.length,
              unchangedEmployees: unchangedEmployees.length,
              flaggedEmployees: removedEmployees.length + unmappedRoles.length + flaggedEmployees.length
            },
            newEmployees,
            updatedEmployees,
            unchangedEmployees,
            flaggedEmployees: [...removedEmployees, ...unmappedRoles, ...flaggedEmployees]
          },
          message: 'CSV preview generated'
        });
      });
  } catch (error) {
    console.error('CSV preview error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to preview CSV'
    });
  }
});

// POST /api/employees
// Manually add a single employee (Admin only)
router.post('/', authMiddleware, roleGuard('ADMIN'), async (req, res) => {
  try {
    const { empId, name, designation, role } = req.body;
    const validRoles = ['ADMIN', 'MANAGER', 'FABRIC_MAN', 'CUTTER', 'TAILOR', 'SUPERVISOR'];

    if (!empId || !name || !designation) {
      return res.status(400).json({
        success: false,
        data: {},
        message: 'empId, name and designation are required'
      });
    }

    const normalizedEmpId = String(empId).trim();
    if (!normalizedEmpId) {
      return res.status(400).json({
        success: false,
        data: {},
        message: 'empId cannot be empty'
      });
    }

    const mappedRole = role || designationToRoleMap(designation);
    if (!mappedRole || !validRoles.includes(mappedRole)) {
      return res.status(400).json({
        success: false,
        data: {},
        message: 'Role could not be inferred. Provide a valid role manually.'
      });
    }

    const exists = await prisma.employee.findUnique({ where: { empId: normalizedEmpId } });
    if (exists) {
      return res.status(409).json({
        success: false,
        data: {},
        message: `Employee with empId ${normalizedEmpId} already exists`
      });
    }

    const created = await prisma.employee.create({
      data: {
        empId: normalizedEmpId,
        name: String(name).trim(),
        designation: String(designation).trim(),
        role: mappedRole,
        isActive: true,
        isFirstLogin: true
      }
    });

    await logActivity(prisma, req.user.id, 'EMPLOYEE_CREATED_MANUAL', null, {
      empId: created.empId,
      role: created.role
    });

    res.status(201).json({
      success: true,
      data: {
        employee: {
          id: created.id,
          empId: created.empId,
          name: created.name,
          designation: created.designation,
          role: created.role,
          isActive: created.isActive,
          isFirstLogin: created.isFirstLogin
        }
      },
      message: 'Employee added successfully'
    });
  } catch (error) {
    console.error('Create employee error:', error);
    res.status(500).json({
      success: false,
      data: {},
      message: 'Failed to add employee'
    });
  }
});

// POST /api/employees/csv-confirm
// Apply the confirmed changes to database
router.post('/csv-confirm', authMiddleware, roleGuard('ADMIN'), async (req, res) => {
  try {
    const { confirmations } = req.body; // { newEmployees: [...], updatedEmployees: [...], flaggedEmployees: [...] }
    const validRoles = new Set(['ADMIN', 'MANAGER', 'FABRIC_MAN', 'CUTTER', 'TAILOR', 'SUPERVISOR']);

    const safeLogActivity = async (action, metadata = {}) => {
      try {
        await logActivity(prisma, req.user.id, action, null, metadata);
      } catch (logError) {
        // Import should not fail if activity log write fails.
        console.error('Activity log write failed during CSV import:', logError);
      }
    };

    if (!confirmations) {
      return res.status(400).json({
        success: false,
        message: 'Confirmations object is required'
      });
    }

    const results = {
      created: [],
      updated: [],
      unchanged: [],
      flagged: []
    };

    // Create new employees, but never alter existing employees from CREATE list.
    for (const emp of confirmations.newEmployees || []) {
      if (emp.action === 'CREATE') {
        const normalizedEmpId = String(emp?.empId || '').trim();
        if (!normalizedEmpId || !emp?.name) {
          results.flagged.push({
            empId: normalizedEmpId || 'N/A',
            name: emp?.name || 'N/A',
            action: 'SKIPPED',
            reason: 'INVALID_EMPLOYEE_ROW'
          });
          continue;
        }

        if (!emp.mappedRole || !validRoles.has(emp.mappedRole)) {
          results.flagged.push({
            empId: normalizedEmpId,
            name: emp.name,
            action: 'SKIPPED',
            reason: 'UNMAPPED_ROLE'
          });
          continue;
        }

        const existing = await prisma.employee.findUnique({ where: { empId: normalizedEmpId } });

        if (existing) {
          results.unchanged.push({
            id: existing.id,
            empId: existing.empId,
            name: existing.name,
            role: existing.role,
            reason: 'EMP_ALREADY_EXISTS'
          });
          await safeLogActivity('EMPLOYEE_SKIPPED_EXISTS', { empId: existing.empId, source: 'CSV_CONFIRM_CREATE_LIST' });
        } else {
          const record = await prisma.employee.create({
            data: {
              empId: normalizedEmpId,
              name: String(emp.name || '').trim(),
              designation: String(emp.designation || '').trim(),
              role: emp.mappedRole,
              isActive: true,
              isFirstLogin: true
            }
          });

          results.created.push({
            id: record.id,
            empId: record.empId,
            name: record.name,
            role: record.role
          });
          await safeLogActivity('EMPLOYEE_CREATED', { empId: record.empId });
        }
      }
    }

    // Update existing employees from UPDATE list.
    for (const emp of confirmations.updatedEmployees || []) {
      if (emp.action === 'UPDATE') {
        const normalizedEmpId = String(emp?.empId || '').trim();
        if (!normalizedEmpId || !emp?.name) {
          results.flagged.push({
            empId: normalizedEmpId || 'N/A',
            name: emp?.name || 'N/A',
            action: 'SKIPPED',
            reason: 'INVALID_EMPLOYEE_ROW'
          });
          continue;
        }

        const existing = await prisma.employee.findUnique({ where: { empId: normalizedEmpId } });
        const resolvedRole = validRoles.has(emp.mappedRole) ? emp.mappedRole : existing?.role;

        if (!resolvedRole) {
          results.flagged.push({
            empId: normalizedEmpId,
            name: emp.name,
            action: 'SKIPPED',
            reason: 'UNMAPPED_ROLE'
          });
          continue;
        }

        if (!existing) {
          const updatedEmp = await prisma.employee.create({
            data: {
              empId: normalizedEmpId,
              name: String(emp.name || '').trim(),
              designation: String(emp.designation || '').trim(),
              role: resolvedRole,
              isActive: true,
              isFirstLogin: true
            }
          });

          results.created.push({
            id: updatedEmp.id,
            empId: updatedEmp.empId,
            name: updatedEmp.name,
            role: updatedEmp.role,
            note: 'Record missing during update, created safely'
          });
          await safeLogActivity('EMPLOYEE_CREATED', { empId: updatedEmp.empId, source: 'CSV_CONFIRM_UPDATE_LIST_CREATE' });
        } else {
          const existingName = String(existing.name || '').trim();
          const existingDesignation = String(existing.designation || '').trim();
          const incomingName = String(emp.name || '').trim();
          const incomingDesignation = String(emp.designation || '').trim();

          if (existingName === incomingName && existingDesignation === incomingDesignation && existing.role === resolvedRole) {
            results.unchanged.push({
              id: existing.id,
              empId: existing.empId,
              name: existing.name,
              role: existing.role,
              reason: 'NO_CHANGES_DETECTED'
            });
            continue;
          }

          const updatedEmp = await prisma.employee.update({
            where: { empId: normalizedEmpId },
            data: {
              name: incomingName,
              designation: incomingDesignation,
              role: resolvedRole
            }
          });

          results.updated.push({
            id: updatedEmp.id,
            empId: updatedEmp.empId,
            name: updatedEmp.name,
            role: updatedEmp.role
          });
          await safeLogActivity('EMPLOYEE_UPDATED', { empId: updatedEmp.empId });
        }
      }
    }

    // Handle flagged employees based on admin's choice
    for (const emp of confirmations.flaggedEmployees || []) {
      const existingEmp = await prisma.employee.findUnique({
        where: { empId: emp.empId }
      });

      if (!existingEmp) continue;

      if (emp.action === 'DEACTIVATE') {
        await prisma.employee.update({
          where: { empId: emp.empId },
          data: { isActive: false }
        });

        results.flagged.push({
          empId: emp.empId,
          name: emp.name,
          action: 'DEACTIVATED'
        });

        await safeLogActivity('EMPLOYEE_DEACTIVATED', { empId: emp.empId });
      } else if (emp.action === 'KEEP_ACTIVE') {
        results.flagged.push({
          empId: emp.empId,
          name: emp.name,
          action: 'KEPT_ACTIVE'
        });

        await safeLogActivity('EMPLOYEE_KEPT_ACTIVE', { empId: emp.empId });
      } else if (emp.action === 'DELETE_PERMANENTLY') {
        // Only delete if no orders or assignments
        const hasAssignments = await prisma.orderAssignment.findFirst({
          where: { employeeId: existingEmp.id }
        });

        if (hasAssignments) {
          results.flagged.push({
            empId: emp.empId,
            name: emp.name,
            action: 'DELETE_FAILED',
            reason: 'Employee has active assignments'
          });
        } else {
          await prisma.employee.delete({
            where: { empId: emp.empId }
          });

          results.flagged.push({
            empId: emp.empId,
            name: emp.name,
            action: 'DELETED'
          });

          await safeLogActivity('EMPLOYEE_DELETED', { empId: emp.empId });
        }
      }
    }

    // Log CSV import completion
    await safeLogActivity('CSV_IMPORT_COMPLETED', {
      created: results.created.length,
      updated: results.updated.length,
      unchanged: results.unchanged.length,
      flagged: results.flagged.length
    });

    const summaryMessage = `CSV import completed. Created: ${results.created.length}, Updated: ${results.updated.length}, Already exists/Unchanged: ${results.unchanged.length}, Flagged: ${results.flagged.length}.`;

    res.json({
      success: true,
      data: results,
      message: summaryMessage
    });
  } catch (error) {
    console.error('CSV confirm error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to confirm CSV import'
    });
  }
});

// GET /api/employees
// List all employees with optional filters
router.get('/', authMiddleware, roleGuard('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { role, isActive, page = 1, limit = 20 } = req.query;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);

    const whereClause = {};
    if (role) whereClause.role = role;
    if (isActive !== undefined) whereClause.isActive = isActive === 'true';

    const total = await prisma.employee.count({ where: whereClause });
    const employees = await prisma.employee.findMany({
      where: whereClause,
      select: {
        id: true,
        empId: true,
        name: true,
        designation: true,
        role: true,
        isActive: true,
        isFirstLogin: true,
        lastLogin: true,
        createdAt: true
      },
      skip: (pageNum - 1) * limitNum,
      take: limitNum,
      orderBy: { createdAt: 'desc' }
    });

    // Employee roster must refresh immediately after mutations like delete/deactivate.
    res.set('Cache-Control', 'no-store');

    res.json({
      success: true,
      data: employees,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum)
      },
      message: 'Employees retrieved'
    });
  } catch (error) {
    console.error('Get employees error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve employees'
    });
  }
});

// PATCH /api/employees/:id/deactivate
// Deactivate an employee
router.patch('/:id/deactivate', authMiddleware, roleGuard('ADMIN'), async (req, res) => {
  try {
    const employee = await prisma.employee.update({
      where: { id: req.params.id },
      data: { isActive: false }
    });

    await logActivity(prisma, req.user.id, 'EMPLOYEE_DEACTIVATED', null, { empId: employee.empId });

    res.json({
      success: true,
      data: { empId: employee.empId, name: employee.name },
      message: 'Employee deactivated'
    });
  } catch (error) {
    console.error('Deactivate employee error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to deactivate employee'
    });
  }
});

// PATCH /api/employees/:id/reactivate
// Reactivate an employee
router.patch('/:id/reactivate', authMiddleware, roleGuard('ADMIN'), async (req, res) => {
  try {
    const employee = await prisma.employee.update({
      where: { id: req.params.id },
      data: { isActive: true }
    });

    await logActivity(prisma, req.user.id, 'EMPLOYEE_REACTIVATED', null, { empId: employee.empId });

    res.json({
      success: true,
      data: { empId: employee.empId, name: employee.name },
      message: 'Employee reactivated'
    });
  } catch (error) {
    console.error('Reactivate employee error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reactivate employee'
    });
  }
});

// DELETE /api/employees/:id
// Permanent delete when safe; otherwise fall back to deactivation so employee can be removed from active use.
router.delete('/:id', authMiddleware, roleGuard('ADMIN'), async (req, res) => {
  try {
    const employee = await prisma.employee.findUnique({
      where: { id: req.params.id }
    });

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found'
      });
    }

    const hasAssignments = await prisma.orderAssignment.findFirst({
      where: { employeeId: req.params.id }
    });

    if (hasAssignments) {
      const deactivated = await prisma.employee.update({
        where: { id: req.params.id },
        data: { isActive: false }
      });

      await logActivity(prisma, req.user.id, 'EMPLOYEE_DELETED', null, {
        empId: deactivated.empId,
        mode: 'DEACTIVATED_DUE_TO_ASSIGNMENT_HISTORY'
      });

      return res.json({
        success: true,
        data: { empId: deactivated.empId, name: deactivated.name, isActive: deactivated.isActive },
        message: 'Employee has assignment history, so it was deactivated instead of permanently deleted'
      });
    }

    await prisma.employee.delete({
      where: { id: req.params.id }
    });

    await logActivity(prisma, req.user.id, 'EMPLOYEE_DELETED', null, { empId: employee.empId });

    res.json({
      success: true,
      data: { empId: employee.empId, name: employee.name },
      message: 'Employee deleted'
    });
  } catch (error) {
    console.error('Delete employee error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete employee'
    });
  }
});

// PATCH /api/employees/:id/reset-credential
// Admin resets PIN or password for any employee
router.patch('/:id/reset-credential', authMiddleware, roleGuard('ADMIN'), async (req, res) => {
  try {
    const { newCredential } = req.body;

    if (!newCredential) {
      return res.status(400).json({
        success: false,
        message: 'New credential is required'
      });
    }

    const employee = await prisma.employee.findUnique({
      where: { id: req.params.id }
    });

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found'
      });
    }

    const hashedCredential = await hashCredential(newCredential);

    const updateData = {
      isFirstLogin: false
    };

    if (employee.role === 'ADMIN' || employee.role === 'MANAGER') {
      updateData.password = hashedCredential;
    } else {
      updateData.pin = hashedCredential;
    }

    await prisma.employee.update({
      where: { id: req.params.id },
      data: updateData
    });

    await logActivity(prisma, req.user.id, 'CREDENTIAL_RESET', null, { empId: employee.empId });

    res.json({
      success: true,
      data: { empId: employee.empId, name: employee.name },
      message: 'Credential reset successfully'
    });
  } catch (error) {
    console.error('Reset credential error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reset credential'
    });
  }
});

// PATCH /api/employees/:id/role
// Admin manually assigns role (for UNMAPPED designations)
router.patch('/:id/role', authMiddleware, roleGuard('ADMIN'), async (req, res) => {
  try {
    const { role } = req.body;

    const validRoles = ['ADMIN', 'MANAGER', 'FABRIC_MAN', 'CUTTER', 'TAILOR', 'SUPERVISOR'];
    if (!role || !validRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid role provided'
      });
    }

    const employee = await prisma.employee.update({
      where: { id: req.params.id },
      data: { role }
    });

    await logActivity(prisma, req.user.id, 'ROLE_ASSIGNED', null, { empId: employee.empId, role });

    res.json({
      success: true,
      data: { empId: employee.empId, name: employee.name, role: employee.role },
      message: 'Role assigned successfully'
    });
  } catch (error) {
    console.error('Assign role error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to assign role'
    });
  }
});

export default router;
