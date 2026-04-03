import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';

// Generate JWT tokens
export const generateTokens = (employee) => {
  const tokenTTL = parseInt(process.env.ACCESS_TOKEN_TTL, 10) || 900; // seconds
  
  // Determine refresh token TTL based on role
  let refreshTokenTTL;
  if (employee.role === 'ADMIN' || employee.role === 'MANAGER') {
    refreshTokenTTL = parseInt(process.env.REFRESH_TOKEN_TTL_ADMIN, 10) || 28800; // seconds
  } else {
    refreshTokenTTL = parseInt(process.env.REFRESH_TOKEN_TTL_MOBILE, 10) || 604800; // seconds
  }

  const accessToken = jwt.sign(
    {
      id: employee.id,
      empId: employee.empId,
      name: employee.name,
      role: employee.role
    },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: tokenTTL }
  );

  const refreshToken = jwt.sign(
    {
      id: employee.id,
      empId: employee.empId,
      role: employee.role
    },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: refreshTokenTTL }
  );

  return { accessToken, refreshToken };
};

// Hash credential (password or PIN)
export const hashCredential = async (credential) => {
  const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS) || 12;
  return await bcrypt.hash(credential, saltRounds);
};

// Compare credential with hash
export const verifyCredential = async (credential, hash) => {
  return await bcrypt.compare(credential, hash);
};

// Log activity
export const logActivity = async (prisma, employeeId, action, orderId = null, metadata = null) => {
  try {
    await prisma.activityLog.create({
      data: {
        employeeId,
        action,
        orderId,
        metadata
      }
    });
  } catch (error) {
    console.error('Failed to log activity:', error);
  }
};
