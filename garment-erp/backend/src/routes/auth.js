import express from 'express';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { generateTokens, hashCredential, verifyCredential, logActivity } from '../utils/auth.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();
const prisma = new PrismaClient();

const getCookieOptions = (maxAge) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'None' : 'Strict',
  path: '/',
  maxAge
});

// POST /api/auth/login
// Login with Employee ID + credential (password or PIN)
router.post('/login', async (req, res) => {
  try {
    const { empId, credential } = req.body;

    if (!empId || !credential) {
      return res.status(400).json({
        success: false,
        message: 'Employee ID and credential are required'
      });
    }

    // Find employee
    const employee = await prisma.employee.findUnique({
      where: { empId }
    });

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee ID is not registered'
      });
    }

    if (!employee.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Employee account is deactivated'
      });
    }

    // Verify credential based on role
    let credentialField = null;
    if (employee.role === 'ADMIN' || employee.role === 'MANAGER') {
      credentialField = employee.password;
    } else {
      credentialField = employee.pin;
    }

    // First-login users might not have any credential saved yet.
    if (employee.isFirstLogin && !credentialField) {
      await logActivity(prisma, employee.id, 'FIRST_LOGIN_SETUP_REQUIRED', null, { ipAddress: req.ip });

      return res.status(403).json({
        success: false,
        data: {
          employee: {
            id: employee.id,
            empId: employee.empId,
            name: employee.name,
            role: employee.role,
            isFirstLogin: true
          }
        },
        message: 'First-time users must use New User Registration'
      });
    }

    if (!credentialField) {
      return res.status(403).json({
        success: false,
        data: {},
        message: 'Employee credential is not configured'
      });
    }

    const isValid = await verifyCredential(credential, credentialField);
    if (!isValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid Employee ID or credential'
      });
    }

    // Persist last login for admin insights and auditing.
    const updatedEmployee = await prisma.employee.update({
      where: { id: employee.id },
      data: { lastLogin: new Date() }
    });

    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(updatedEmployee);

    const refreshMaxAge = employee.role === 'ADMIN' || employee.role === 'MANAGER'
      ? 8 * 60 * 60 * 1000
      : 7 * 24 * 60 * 60 * 1000;

    // Store both JWTs in HttpOnly cookies for Phase 1 requirement compliance.
    res.cookie('accessToken', accessToken, getCookieOptions(15 * 60 * 1000));
    res.cookie('refreshToken', refreshToken, getCookieOptions(refreshMaxAge));

    // Log login activity
    await logActivity(prisma, employee.id, 'LOGIN', null, { ipAddress: req.ip });

    res.json({
      success: true,
      data: {
        accessToken,
        employee: {
          id: updatedEmployee.id,
          empId: updatedEmployee.empId,
          name: updatedEmployee.name,
          role: updatedEmployee.role,
          isFirstLogin: updatedEmployee.isFirstLogin
        }
      },
      message: 'Login successful'
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Login failed'
    });
  }
});

// POST /api/auth/setup-credential
// Set PIN or password for first login
router.post('/setup-credential', async (req, res) => {
  try {
    const { empId, newCredential } = req.body;

    if (!empId || !newCredential) {
      return res.status(400).json({
        success: false,
        message: 'Employee ID and credential are required'
      });
    }

    const employee = await prisma.employee.findUnique({
      where: { empId }
    });

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found'
      });
    }

    if (!employee.isFirstLogin) {
      return res.status(403).json({
        success: false,
        message: 'You are already registered. Please use Employee Login.'
      });
    }

    // Hash and save credential
    const hashedCredential = await hashCredential(newCredential);

    const updateData = {
      isFirstLogin: false
    };

    // Determine which field to update based on role
    if (employee.role === 'ADMIN' || employee.role === 'MANAGER') {
      updateData.password = hashedCredential;
    } else {
      updateData.pin = hashedCredential;
    }

    const updatedEmployee = await prisma.employee.update({
      where: { id: employee.id },
      data: updateData
    });

    // Log activity
    await logActivity(prisma, employee.id, 'CREDENTIAL_SET_UP', null, { role: employee.role });

    res.json({
      success: true,
      data: {
        employee: {
          id: updatedEmployee.id,
          empId: updatedEmployee.empId,
          name: updatedEmployee.name,
          role: updatedEmployee.role
        }
      },
      message: 'Credential set up successfully'
    });
  } catch (error) {
    console.error('Setup credential error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to set up credential'
    });
  }
});

// POST /api/auth/refresh
// Get new access token using refresh token
router.post('/refresh', async (req, res) => {
  try {
    const refreshToken = req.cookies.refreshToken;

    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        message: 'No refresh token found'
      });
    }

    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);

    const employee = await prisma.employee.findUnique({
      where: { id: decoded.id }
    });

    if (!employee || !employee.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Employee not found or inactive'
      });
    }

    const { accessToken, refreshToken: newRefreshToken } = generateTokens(employee);

    const refreshMaxAge = employee.role === 'ADMIN' || employee.role === 'MANAGER'
      ? 8 * 60 * 60 * 1000
      : 7 * 24 * 60 * 60 * 1000;

    res.cookie('accessToken', accessToken, getCookieOptions(15 * 60 * 1000));
    res.cookie('refreshToken', newRefreshToken, getCookieOptions(refreshMaxAge));

    res.json({
      success: true,
      data: { accessToken },
      message: 'Token refreshed successfully'
    });
  } catch (error) {
    console.error('Refresh token error:', error);
    res.status(401).json({
      success: false,
      message: 'Invalid or expired refresh token'
    });
  }
});

// POST /api/auth/logout
// Clear refresh token cookie
router.post('/logout', authMiddleware, async (req, res) => {
  try {
    const clearCookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'None' : 'Strict',
      path: '/'
    };

    res.clearCookie('accessToken', clearCookieOptions);
    res.clearCookie('refreshToken', clearCookieOptions);

    // Log logout activity
    await logActivity(prisma, req.user.id, 'LOGOUT');

    res.json({ success: true, data: {}, message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Logout failed'
    });
  }
});

// GET /api/auth/me
// Validate active session using access token cookie
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const employee = await prisma.employee.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        empId: true,
        name: true,
        role: true,
        isFirstLogin: true,
        isActive: true
      }
    });

    if (!employee || !employee.isActive) {
      return res.status(401).json({ success: false, data: {}, message: 'Session invalid' });
    }

    res.json({ success: true, data: { employee }, message: 'Session valid' });
  } catch (error) {
    res.status(401).json({ success: false, data: {}, message: 'Session invalid' });
  }
});

export default router;
