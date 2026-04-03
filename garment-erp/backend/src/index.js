import express from 'express';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

// Route imports
import authRoutes from './routes/auth.js';
import employeeRoutes from './routes/employee.js';
import orderRoutes from './routes/order.js';
import assignmentRoutes from './routes/assignment.js';
import activityRoutes from './routes/activity.js';
import workerRoutes from './routes/worker.js';
import supervisorRoutes from './routes/supervisor.js';
import reportRoutes from './routes/report.js';
import adminRoutes from './routes/admin.js';

dotenv.config();

const app = express();
const prisma = new PrismaClient();

const allowedOrigins = (process.env.FRONTEND_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

// Middleware
app.use((req, res, next) => {
  const requestOrigin = req.headers.origin;

  if (requestOrigin && (allowedOrigins.length === 0 || allowedOrigins.includes(requestOrigin))) {
    res.header('Access-Control-Allow-Origin', requestOrigin);
    res.header('Vary', 'Origin');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
  }

  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Health check
app.get('/health', (req, res) => {
  res.json({ success: true, message: 'Server is running' });
});

app.get('/api/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      success: true,
      data: {
        status: 'ok',
        timestamp: new Date().toISOString(),
        db: 'connected',
        uptime: Number(process.uptime().toFixed(2))
      },
      message: 'Health check passed'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      data: {
        status: 'error',
        timestamp: new Date().toISOString(),
        db: 'disconnected',
        uptime: Number(process.uptime().toFixed(2))
      },
      message: 'Health check failed'
    });
  }
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/assignment', assignmentRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/worker', workerRoutes);
app.use('/api/supervisor', supervisorRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/admin', adminRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    success: false,
    message: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message
  });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`NODE_ENV: ${process.env.NODE_ENV}`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  await prisma.$disconnect();
  process.exit(0);
});
