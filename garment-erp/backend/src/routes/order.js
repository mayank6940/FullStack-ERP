import express from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import csv from 'csv-parser';
import { Readable } from 'stream';
import { authMiddleware, roleGuard } from '../middleware/auth.js';
import AssignmentService from '../services/AssignmentService.js';
import { logActivity } from '../utils/auth.js';

const router = express.Router();
const prisma = new PrismaClient();
const assignmentService = new AssignmentService(prisma);
const EMPLOYEE_ROLES = ['FABRIC_MAN', 'CUTTER', 'TAILOR', 'SUPERVISOR'];
const VISIBILITY_SIGNATURE_PREFIX = '__EMPLOYEE_VISIBLE_COLUMNS__';

const getVisibilitySignature = (role) => `${VISIBILITY_SIGNATURE_PREFIX}${role}`;

const REQUIRED_FIELDS = ['OrderCode'];

const COMPANY_DISPLAY_FIELDS = {
  OrderCode: 'Order #',
  UniwareCreatedAt: 'Uniware Created At',
  Channel: 'Channel',
  Products: 'Products',
  StyleCode: 'Style Code',
  FabricName: 'Fabric Type (Rayon, Poly Georgette, etc.)',
  Colour: 'Colour',
  Pattern: 'Pattern',
  FabricSize: 'Fabric Weight/Yardage (0.88, 0.66, etc.)',
  Lining: 'Lining',
  ChannelCreatedAt: 'Channel Created At',
  DisplayOrderNo: 'Display Order #',
  PaymentType: 'Pymt',
  OrderPrice: 'Order Price',
  SellerSKUs: 'Seller SKUs'
};

const getDefaultCompanyMapping = () => ({
  OrderCode: 'Order #',
  UniwareCreatedAt: 'Uniware Created At',
  Channel: 'Channel',
  Products: 'Products',
  StyleCode: 'Style Code',
  FabricName: 'Fabric',
  Colour: 'Colour',
  Pattern: 'Pattern',
  FabricSize: 'Fabric',
  ChannelCreatedAt: 'Channel Created At',
  DisplayOrderNo: 'Display Order #',
  PaymentType: 'Pymt',
  OrderPrice: 'Order Price',
  SellerSKUs: 'Seller SKUs'
});

const STATUS_TRANSITIONS = {
  RECEIVED: ['ASSIGNED'],
  ASSIGNED: ['FABRIC_IN_PROGRESS'],
  FABRIC_IN_PROGRESS: ['FABRIC_DONE'],
  FABRIC_DONE: ['CUTTING_IN_PROGRESS'],
  CUTTING_IN_PROGRESS: ['CUTTING_DONE'],
  CUTTING_DONE: ['TAILOR_IN_PROGRESS'],
  TAILOR_IN_PROGRESS: ['TAILOR_DONE'],
  TAILOR_DONE: ['QC_IN_PROGRESS'],
  QC_IN_PROGRESS: ['COMPLETED', 'REJECTED']
};

const STATUS_RANK = {
  RECEIVED: 1,
  ASSIGNED: 2,
  FABRIC_IN_PROGRESS: 3,
  FABRIC_DONE: 4,
  CUTTING_IN_PROGRESS: 5,
  CUTTING_DONE: 6,
  TAILOR_IN_PROGRESS: 7,
  TAILOR_DONE: 8,
  QC_IN_PROGRESS: 9,
  COMPLETED: 10,
  REJECTED: 0
};

const REJECTION_ROUTE_CONFIG = {
  FABRIC_QUALITY: { routedTo: 'FABRIC_MAN', resetStatus: 'ASSIGNED' },
  WRONG_CUT: { routedTo: 'CUTTER', resetStatus: 'FABRIC_DONE' },
  STITCHING_ISSUE: { routedTo: 'TAILOR', resetStatus: 'CUTTING_DONE' }
};

const REJECTION_CATEGORIES = ['FABRIC_QUALITY', 'WRONG_CUT', 'STITCHING_ISSUE', 'OTHER'];
const REJECTION_ROUTE_ROLES = ['FABRIC_MAN', 'CUTTER', 'TAILOR'];
const ISSUE_REPORTED_ACTION = 'ORDER_ISSUE_REPORTED';
const ISSUE_RESOLVED_ACTION = 'ORDER_ISSUE_RESOLVED';

const getUnresolvedIssueIds = (logs = []) => {
  const unresolved = new Set();

  logs.forEach((log) => {
    if (log.action === ISSUE_REPORTED_ACTION) {
      unresolved.add(log.id);
      return;
    }

    if (log.action === ISSUE_RESOLVED_ACTION) {
      const reportedActivityId = log.metadata?.reportedActivityId;
      if (reportedActivityId && unresolved.has(reportedActivityId)) {
        unresolved.delete(reportedActivityId);
      }
    }
  });

  return unresolved;
};

const normalizeSize = (value) => {
  if (!value) return null;
  const upper = String(value).trim().toUpperCase();
  if (['SMALL', 'MEDIUM', 'LARGE'].includes(upper)) return upper;
  if (['XS', 'S'].includes(upper)) return 'SMALL';
  if (['M', 'L'].includes(upper)) return 'MEDIUM';
  if (['XL', 'XXL', 'XXXL', '2XL', '3XL'].includes(upper)) return 'LARGE';
  return null;
};

const extractSizeToken = (rawValue) => {
  const text = String(rawValue || '').trim().toUpperCase();
  if (!text) return null;

  const match = text.match(/(?:_|-|\s)(XXXL|XXL|2XL|3XL|XL|XS|S|M|L)(?:$|\b)/);
  if (match) return match[1];

  if (/\b(XXXL|XXL|2XL|3XL|XL|XS|S|M|L)\b/.test(text)) {
    return text.match(/\b(XXXL|XXL|2XL|3XL|XL|XS|S|M|L)\b/)[1];
  }

  return null;
};

const inferSizeFromRow = (row, mapping) => {
  const directSize = normalizeSize(mapping.Size ? row[mapping.Size] : null);
  if (directSize) return directSize;

  const sellerSkusValue = mapping.SellerSKUs ? row[mapping.SellerSKUs] : null;
  const productsValue = mapping.Products ? row[mapping.Products] : null;
  const styleCodeValue = mapping.StyleCode ? row[mapping.StyleCode] : null;

  const fromSellerSku = normalizeSize(extractSizeToken(sellerSkusValue));
  if (fromSellerSku) return fromSellerSku;

  const fromProducts = normalizeSize(extractSizeToken(productsValue));
  if (fromProducts) return fromProducts;

  const fromStyleCode = normalizeSize(extractSizeToken(styleCodeValue));
  if (fromStyleCode) return fromStyleCode;

  return null;
};

const inferQuantityFromRow = (row, mapping) => {
  const quantityRaw = mapping.Quantity ? row[mapping.Quantity] : null;
  const parsedQuantity = Number(quantityRaw);
  if (Number.isFinite(parsedQuantity) && parsedQuantity > 0) return parsedQuantity;

  const sellerSkusValue = String(mapping.SellerSKUs ? row[mapping.SellerSKUs] || '' : '').trim();
  if (sellerSkusValue) {
    const skuCount = sellerSkusValue
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean).length;
    if (skuCount > 0) return skuCount;
  }

  return 1;
};

const mergeMappings = (inferredMapping, providedMapping = {}) => {
  const merged = { ...inferredMapping };
  for (const [key, value] of Object.entries(providedMapping || {})) {
    if (value === undefined) continue;

    const normalized = String(value).trim();
    if (!normalized || normalized === '__SKIP__') {
      merged[key] = null;
      continue;
    }

    merged[key] = value;
  }
  return merged;
};

const inferHeaderMapping = (headers) => {
  const mapped = {};
  const normalized = headers.map((h) => h.trim().toLowerCase());

  const findField = (patterns, skipIndices = new Set()) => {
    for (let i = 0; i < normalized.length; i += 1) {
      if (skipIndices.has(i)) continue;
      if (patterns.some((p) => normalized[i].includes(p))) return headers[i];
    }
    return null;
  };

  const findFieldIndex = (patterns, skipIndices = new Set()) => {
    for (let i = 0; i < normalized.length; i += 1) {
      if (skipIndices.has(i)) continue;
      if (patterns.some((p) => normalized[i].includes(p))) return i;
    }
    return -1;
  };

  mapped.OrderCode = findField(['ordercode', 'order_code', 'order code', 'orderno', 'order no', 'order #', 'order#']);
  mapped.Quantity = findField(['qty', 'quantity']);
  mapped.Size = findField(['size', 'garment size']);
  mapped.ArticleName = findField(['article', 'item', 'style', 'products']);
  mapped.Products = findField(['products', 'product']);
  mapped.SellerSKUs = findField(['seller skus', 'seller sku', 'sku']);
  mapped.StyleCode = findField(['style code', 'stylecode']);

  // Map fabric columns even when second column is renamed (e.g., "Fabric Size", "9 Fabric Size").
  const fabricNameIndex = findFieldIndex(['fabric_1_name', 'fabric type', 'fabric name', 'fabric']);
  mapped.FabricName = fabricNameIndex >= 0 ? headers[fabricNameIndex] : null;

  const skipFabricName = fabricNameIndex >= 0 ? new Set([fabricNameIndex]) : new Set();
  mapped.FabricSize = findField(
    ['fabric_2_size', 'fabric size', 'fabric weight', 'yardage', 'gsm', 'fabric 2', '2nd fabric'],
    skipFabricName
  );

  mapped.Colour = findField(['colour', 'color']);
  mapped.Pattern = findField(['pattern']);
  mapped.Lining = findField(['lining']);
  mapped.Channel = findField(['channel']);
  mapped.UniwareCreatedAt = findField(['uniware created at', 'created at']);
  mapped.ChannelCreatedAt = findField(['channel created at']);
  mapped.DisplayOrderNo = findField(['display order #', 'display order no', 'nykf']);
  mapped.PaymentType = findField(['pymt', 'payment', 'payment type']);
  mapped.OrderPrice = findField(['order price', 'price']);
  mapped.DeliveryDate = findField(['delivery', 'due', 'created at', 'channel created at', 'uniware created at']);

  return mapped;
};

const getTemplateSignature = (headers) => headers.map((h) => h.trim().toLowerCase()).sort().join('|');

const isPlainObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

const normalizeCellValue = (value) => {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => normalizeCellValue(item)).join(', ');
  if (isPlainObject(value)) return JSON.stringify(value);
  return value;
};

const flattenOrderForVisibility = (order) => {
  const flat = {
    OrderCode: order.orderCode,
    Size: order.size,
    Status: order.status,
    CreatedAt: order.createdAt,
    UpdatedAt: order.updatedAt
  };

  const details = isPlainObject(order.details) ? order.details : {};
  for (const [key, value] of Object.entries(details)) {
    if (key === 'companyFields' && isPlainObject(value)) {
      for (const [companyKey, companyValue] of Object.entries(value)) {
        flat[companyKey] = normalizeCellValue(companyValue);
      }
      continue;
    }
    flat[key] = normalizeCellValue(value);
  }

  return flat;
};

const collectAvailableColumns = (flattenedRows) => {
  const set = new Set();
  flattenedRows.forEach((row) => {
    Object.keys(row || {}).forEach((key) => {
      if (key) set.add(key);
    });
  });
  return [...set].sort((a, b) => a.localeCompare(b));
};

const readRoleVisibleColumns = async (role) => {
  const signature = getVisibilitySignature(role);
  const latest = await prisma.columnMappingTemplate.findFirst({
    where: { signature },
    orderBy: { updatedAt: 'desc' }
  });

  const mapping = latest?.mapping;
  if (Array.isArray(mapping)) {
    return mapping.map((item) => String(item || '').trim()).filter(Boolean);
  }

  if (isPlainObject(mapping) && Array.isArray(mapping.columns)) {
    return mapping.columns.map((item) => String(item || '').trim()).filter(Boolean);
  }

  return [];
};

const withTimeout = (promise, ms, stageLabel) => {
  let timer = null;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${stageLabel} timed out after ${ms}ms`)), ms);
    })
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
};

const parseDateRange = (fromDate, toDate) => {
  const now = new Date();
  const start = fromDate ? new Date(fromDate) : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const end = toDate ? new Date(`${toDate}T23:59:59.999`) : now;
  return { start, end };
};

const requiredWorkersPerRoleFromRows = (rows = []) => {
  let required = 1;

  for (const row of rows) {
    const normalized = normalizeSize(row?.size);
    if (normalized === 'MEDIUM' || normalized === 'LARGE') {
      required = 2;
      break;
    }
  }

  return required;
};

const getWeekStart = () => {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? 6 : day - 1;
  const monday = new Date(now);
  monday.setDate(now.getDate() - diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
};

const parseCsv = async (csvContent) => {
  return new Promise((resolve, reject) => {
    if (!csvContent || !String(csvContent).trim()) {
      resolve({ headers: [], rows: [], fabricIndices: [] });
      return;
    }

    const rows = [];
    const originalHeaders = [];
    const renamedHeaders = [];
    const fabricIndices = [];
    let fabricCounter = 0;

    Readable.from([csvContent])
      .pipe(csv({
        mapHeaders: ({ header, index }) => {
          const raw = String(header || '').trim();
          const lower = raw.toLowerCase();
          originalHeaders[index] = raw;

          if (lower === 'fabric') {
            fabricCounter += 1;
            fabricIndices.push(index);
            const renamed = fabricCounter === 1
              ? 'Fabric_1_Name'
              : fabricCounter === 2
                ? 'Fabric_2_Size'
                : `Fabric_${fabricCounter}`;
            renamedHeaders[index] = renamed;
            return renamed;
          }

          renamedHeaders[index] = raw;
          return raw;
        }
      }))
      .on('data', (row) => rows.push(row))
      .on('end', () => {
        resolve({ headers: renamedHeaders, originalHeaders, rows, fabricIndices });
      })
      .on('error', reject);
  });
};

const buildMappedRows = async (rows, mapping) => {
  const invalidRows = [];
  const validRows = [];
  const duplicateRows = [];
  const seenOrderCodes = new Set();

  const orderCodes = rows
    .map((r) => r[mapping.OrderCode])
    .filter(Boolean)
    .map((v) => String(v).trim());

  const existing = await prisma.order.findMany({
    where: { orderCode: { in: [...new Set(orderCodes)] } },
    select: { orderCode: true }
  });
  const existingSet = new Set(existing.map((e) => e.orderCode));

  rows.forEach((row, idx) => {
    const orderCode = String(row[mapping.OrderCode] || '').trim();
    const quantityValue = inferQuantityFromRow(row, mapping);
    const size = inferSizeFromRow(row, mapping);

    const issues = [];
    if (!orderCode) issues.push('Missing OrderCode');
    if (!size) issues.push('Invalid or missing Size');
    if (!Number.isFinite(quantityValue) || quantityValue <= 0) issues.push('Invalid Quantity');

    const companyFields = {};
    Object.keys(COMPANY_DISPLAY_FIELDS).forEach((fieldKey) => {
      if (mapping[fieldKey] && row[mapping[fieldKey]]) {
        companyFields[fieldKey] = row[mapping[fieldKey]];
      }
    });

    const mapped = {
      rowNumber: idx + 2,
      orderCode,
      quantity: quantityValue,
      size,
      articleName: mapping.ArticleName ? row[mapping.ArticleName] : null,
      fabricType: mapping.FabricType ? row[mapping.FabricType] : null,
      deliveryDate: mapping.DeliveryDate ? row[mapping.DeliveryDate] : null,
      companyFields,
      details: Object.fromEntries(
        Object.entries(row).filter(([key]) => !Object.values(mapping).includes(key))
      )
    };

    if (issues.length > 0) {
      invalidRows.push({ ...mapped, issues });
      return;
    }

    if (seenOrderCodes.has(orderCode)) {
      duplicateRows.push({ ...mapped, issues: ['Duplicate OrderCode in uploaded CSV'] });
      return;
    }
    seenOrderCodes.add(orderCode);

    if (existingSet.has(orderCode)) {
      duplicateRows.push({ ...mapped, issues: ['OrderCode already exists'] });
      return;
    }

    validRows.push(mapped);
  });

  return { validRows, invalidRows, duplicateRows };
};

router.post('/csv-preview', authMiddleware, roleGuard('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { csvContent, columnMapping, templateId } = req.body;
    if (!csvContent) {
      return res.status(400).json({ success: false, data: {}, message: 'CSV content is required' });
    }

    const { headers, rows } = await withTimeout(parseCsv(csvContent), 30000, 'CSV parsing');
    const signature = getTemplateSignature(headers);

    let effectiveMapping = null;
    const inferredMapping = inferHeaderMapping(headers);

    if (columnMapping && Object.keys(columnMapping).length > 0) {
      effectiveMapping = mergeMappings(inferredMapping, columnMapping);
    }
    if (!effectiveMapping && templateId) {
      const template = await prisma.columnMappingTemplate.findUnique({ where: { id: templateId } });
      effectiveMapping = mergeMappings(inferredMapping, template?.mapping || {});
    }

    if (!effectiveMapping) {
      const stored = await withTimeout(prisma.columnMappingTemplate.findFirst({
        where: { createdBy: req.user.id, signature },
        orderBy: { updatedAt: 'desc' }
      }), 10000, 'Template lookup');
      effectiveMapping = mergeMappings(inferredMapping, stored?.mapping || {});
    }

    const missingRequired = REQUIRED_FIELDS.filter((field) => !effectiveMapping?.[field]);
    const hasAnySizeSource = Boolean(effectiveMapping?.Size || effectiveMapping?.Products || effectiveMapping?.SellerSKUs || effectiveMapping?.StyleCode);
    if (!hasAnySizeSource) {
      missingRequired.push('Size source (Size/Products/SellerSKUs/StyleCode)');
    }

    if (missingRequired.length > 0) {
      return res.status(400).json({
        success: false,
        data: { headers, suggestedMapping: inferredMapping, missingRequired },
        message: `Missing required mapping: ${missingRequired.join(', ')}`
      });
    }

    const report = await withTimeout(buildMappedRows(rows, effectiveMapping), 45000, 'Row validation');

    res.json({
      success: true,
      data: {
        headers,
        rowCount: rows.length,
        mapping: effectiveMapping,
        signature,
        report,
        summary: {
          validRows: report.validRows.length,
          invalidRows: report.invalidRows.length,
          duplicateRows: report.duplicateRows.length
        },
        companyDisplayFields: COMPANY_DISPLAY_FIELDS
      },
      message: 'Order CSV preview generated'
    });
  } catch (error) {
    console.error('orders/csv-preview error:', error);
    res.status(500).json({ success: false, data: {}, message: error?.message || 'Failed to generate order CSV preview' });
  }
});

router.post('/save-column-mapping', authMiddleware, roleGuard('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { name, signature, mapping } = req.body;
    if (!name || !signature || !mapping) {
      return res.status(400).json({ success: false, data: {}, message: 'name, signature and mapping are required' });
    }

    const template = await prisma.columnMappingTemplate.upsert({
      where: {
        createdBy_signature: {
          createdBy: req.user.id,
          signature
        }
      },
      create: {
        name,
        signature,
        mapping,
        createdBy: req.user.id
      },
      update: {
        name,
        mapping
      }
    });

    await logActivity(prisma, req.user.id, 'ORDER_COLUMN_MAPPING_SAVED', null, { templateId: template.id, name: template.name });

    res.json({ success: true, data: { template }, message: 'Column mapping saved' });
  } catch (error) {
    console.error('orders/save-column-mapping error:', error);
    res.status(500).json({ success: false, data: {}, message: 'Failed to save column mapping' });
  }
});

router.get('/column-mappings', authMiddleware, roleGuard('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const templates = await prisma.columnMappingTemplate.findMany({
      where: { createdBy: req.user.id },
      orderBy: { updatedAt: 'desc' }
    });
    res.json({ success: true, data: { templates }, message: 'Column mappings fetched' });
  } catch (error) {
    console.error('orders/column-mappings error:', error);
    res.status(500).json({ success: false, data: {}, message: 'Failed to load column mappings' });
  }
});

router.get('/mapping-fields', authMiddleware, roleGuard('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const requiredFields = ['OrderCode'];
    const sizeSourceFields = ['Size', 'Products', 'SellerSKUs', 'StyleCode'];

    // Core ingestion fields (not all are company display fields but still valid mapping targets).
    const coreFields = ['Quantity', 'Size', 'ArticleName', 'FabricType', 'DeliveryDate'];

    const fieldOrder = [
      ...requiredFields,
      ...sizeSourceFields,
      ...coreFields,
      ...Object.keys(COMPANY_DISPLAY_FIELDS)
    ];

    const uniqueFields = [...new Set(fieldOrder)];

    res.json({
      success: true,
      data: {
        fields: uniqueFields,
        requiredFields,
        sizeSourceFields
      },
      message: 'Order mapping fields fetched'
    });
  } catch (error) {
    console.error('orders/mapping-fields error:', error);
    res.status(500).json({ success: false, data: {}, message: 'Failed to fetch mapping fields' });
  }
});

router.post('/csv-confirm', authMiddleware, roleGuard('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { filename = 'orders.csv', approvedRows = [] } = req.body;
    if (!Array.isArray(approvedRows) || approvedRows.length === 0) {
      return res.status(400).json({ success: false, data: {}, message: 'approvedRows is required' });
    }

    const requiredPerRole = requiredWorkersPerRoleFromRows(approvedRows);
    for (const role of ['FABRIC_MAN', 'CUTTER', 'TAILOR']) {
      const available = await assignmentService.getAvailableWorkers(role);
      if (available.length < requiredPerRole) {
        return res.status(400).json({
          success: false,
          data: {
            role,
            required: requiredPerRole,
            available: available.length
          },
          message: `Insufficient active workers for ${role}. Required: ${requiredPerRole}, available: ${available.length}`
        });
      }
    }

    const batch = await prisma.csvBatch.create({
      data: {
        filename,
        uploadedBy: req.user.id,
        totalOrders: approvedRows.length,
        status: 'PENDING'
      }
    });

    const createdOrders = [];
    const assignmentResults = [];

    for (const row of approvedRows) {
      const baseDetails = {
        quantity: row.quantity,
        articleName: row.articleName,
        fabricType: row.fabricType,
        deliveryDate: row.deliveryDate,
        companyFields: row.companyFields || {},
        ...row.details
      };

      if (row.size === 'LARGE') {
        const parent = await prisma.order.create({
          data: {
            orderCode: row.orderCode,
            csvBatchId: batch.id,
            size: 'LARGE',
            status: 'RECEIVED',
            details: baseDetails
          }
        });

        for (const suffix of ['A', 'B']) {
          const subOrder = await prisma.order.create({
            data: {
              orderCode: `${row.orderCode}-${suffix}`,
              csvBatchId: batch.id,
              size: 'MEDIUM',
              status: 'RECEIVED',
              parentOrderId: parent.id,
              details: {
                ...baseDetails,
                quantity: Math.ceil((row.quantity || 0) / 2),
                splitFrom: row.orderCode
              }
            }
          });

          createdOrders.push(subOrder);
          const result = await assignmentService.assignOrder(subOrder.id);
          assignmentResults.push(result);
        }

        await prisma.order.update({
          where: { id: parent.id },
          data: { status: 'ASSIGNED' }
        });
      } else {
        const order = await prisma.order.create({
          data: {
            orderCode: row.orderCode,
            csvBatchId: batch.id,
            size: row.size,
            status: 'RECEIVED',
            details: baseDetails
          }
        });

        createdOrders.push(order);
        const result = await assignmentService.assignOrder(order.id);
        assignmentResults.push(result);
      }
    }

    await prisma.csvBatch.update({
      where: { id: batch.id },
      data: { status: 'APPROVED' }
    });

    await logActivity(prisma, req.user.id, 'ORDER_CSV_IMPORTED', null, {
      batchId: batch.id,
      filename,
      createdOrders: createdOrders.length
    });

    res.json({
      success: true,
      data: {
        batch,
        createdOrders,
        assignmentResults
      },
      message: 'Orders imported and assigned successfully'
    });
  } catch (error) {
    console.error('orders/csv-confirm error:', error);
    if (error?.code === 'P2002') {
      return res.status(409).json({ success: false, data: {}, message: 'Duplicate order code detected while importing CSV' });
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return res.status(500).json({ success: false, data: {}, message: `Database error during CSV import (${error.code})` });
    }

    const message = error?.message || 'Failed to confirm order CSV import';
    res.status(500).json({ success: false, data: {}, message });
  }
});

router.get('/batches', authMiddleware, roleGuard('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const batches = await prisma.csvBatch.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        uploader: {
          select: { id: true, empId: true, name: true, role: true }
        }
      }
    });

    res.json({ success: true, data: { batches }, message: 'Order batches fetched' });
  } catch (error) {
    console.error('orders/batches error:', error);
    res.status(500).json({ success: false, data: {}, message: 'Failed to fetch order batches' });
  }
});

router.get('/visible-columns/options', authMiddleware, roleGuard('MANAGER'), async (req, res) => {
  try {
    const role = String(req.query.role || EMPLOYEE_ROLES[0]).toUpperCase();
    if (!EMPLOYEE_ROLES.includes(role)) {
      return res.status(400).json({ success: false, data: {}, message: `Invalid role. Allowed: ${EMPLOYEE_ROLES.join(', ')}` });
    }

    const orders = await prisma.order.findMany({
      take: 500,
      orderBy: { createdAt: 'desc' },
      select: {
        orderCode: true,
        size: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        details: true
      }
    });

    const flattened = orders.map(flattenOrderForVisibility);
    const availableColumns = collectAvailableColumns(flattened);
    const selectedColumns = await readRoleVisibleColumns(role);

    res.json({
      success: true,
      data: {
        role,
        roles: EMPLOYEE_ROLES,
        availableColumns,
        selectedColumns
      },
      message: 'Visible column options fetched'
    });
  } catch (error) {
    console.error('orders/visible-columns/options error:', error);
    res.status(500).json({ success: false, data: {}, message: 'Failed to load column visibility options' });
  }
});

router.put('/visible-columns/:role', authMiddleware, roleGuard('MANAGER'), async (req, res) => {
  try {
    const role = String(req.params.role || '').toUpperCase();
    if (!EMPLOYEE_ROLES.includes(role)) {
      return res.status(400).json({ success: false, data: {}, message: `Invalid role. Allowed: ${EMPLOYEE_ROLES.join(', ')}` });
    }

    const incoming = Array.isArray(req.body?.columns) ? req.body.columns : null;
    if (!incoming) {
      return res.status(400).json({ success: false, data: {}, message: 'columns array is required' });
    }

    const normalizedColumns = [...new Set(incoming.map((item) => String(item || '').trim()).filter(Boolean))];
    const signature = getVisibilitySignature(role);

    await prisma.columnMappingTemplate.deleteMany({ where: { signature } });

    await prisma.columnMappingTemplate.create({
      data: {
        name: `Visible Columns - ${role}`,
        signature,
        mapping: { columns: normalizedColumns },
        createdBy: req.user.id
      }
    });

    await logActivity(prisma, req.user.id, 'VISIBLE_COLUMNS_UPDATED', null, {
      role,
      columnCount: normalizedColumns.length
    });

    res.json({
      success: true,
      data: { role, selectedColumns: normalizedColumns },
      message: 'Visible columns updated'
    });
  } catch (error) {
    console.error('orders/visible-columns/update error:', error);
    res.status(500).json({ success: false, data: {}, message: 'Failed to update visible columns' });
  }
});

router.get('/employee-view', authMiddleware, roleGuard(...EMPLOYEE_ROLES), async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);

    const where = {
      assignments: {
        some: {
          employeeId: req.user.id
        }
      }
    };

    const total = await prisma.order.count({ where });
    const orders = await prisma.order.findMany({
      where,
      skip: (pageNum - 1) * limitNum,
      take: limitNum,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        orderCode: true,
        size: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        details: true
      }
    });

    const flattenedRows = orders.map(flattenOrderForVisibility);
    const availableColumns = collectAvailableColumns(flattenedRows);
    const configuredColumns = await readRoleVisibleColumns(req.user.role);
    const selectedColumns = (configuredColumns.length > 0 ? configuredColumns : availableColumns)
      .filter((column) => availableColumns.includes(column));

    const items = flattenedRows.map((row) => {
      const filtered = {};
      selectedColumns.forEach((column) => {
        filtered[column] = Object.prototype.hasOwnProperty.call(row, column) ? row[column] : null;
      });
      return filtered;
    });

    res.json({
      success: true,
      data: {
        role: req.user.role,
        columns: selectedColumns,
        items,
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum)
      },
      message: 'Employee order view fetched'
    });
  } catch (error) {
    console.error('orders/employee-view error:', error);
    res.status(500).json({ success: false, data: {}, message: 'Failed to load employee order view' });
  }
});

router.get('/', authMiddleware, roleGuard('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { page = 1, limit = 20, status, size, assignedEmployee, fromDate, toDate } = req.query;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);

    const where = {};
    if (status) where.status = status;
    if (size) where.size = size;
    if (fromDate || toDate) {
      where.createdAt = {};
      if (fromDate) where.createdAt.gte = new Date(fromDate);
      if (toDate) where.createdAt.lte = new Date(toDate);
    }
    if (assignedEmployee) {
      where.assignments = {
        some: {
          employeeId: assignedEmployee
        }
      };
    }

    const total = await prisma.order.count({ where });
    const orders = await prisma.order.findMany({
      where,
      skip: (pageNum - 1) * limitNum,
      take: limitNum,
      orderBy: { createdAt: 'desc' },
      include: {
        assignments: {
          include: {
            employee: {
              select: { id: true, empId: true, name: true, role: true }
            }
          }
        }
      }
    });

    res.json({
      success: true,
      data: {
        items: orders,
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum)
      },
      message: 'Orders fetched'
    });
  } catch (error) {
    console.error('orders/list error:', error);
    res.status(500).json({ success: false, data: {}, message: 'Failed to list orders' });
  }
});

router.delete('/all', authMiddleware, roleGuard('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const countsBefore = await prisma.$transaction(async (tx) => {
      const totalOrders = await tx.order.count();
      const totalAssignments = await tx.orderAssignment.count();
      return { totalOrders, totalAssignments };
    });

    await prisma.$transaction(async (tx) => {
      // Explicitly remove assignments first to guarantee cleanup in all environments.
      await tx.orderAssignment.deleteMany({});
      await tx.order.deleteMany({});
    });

    await logActivity(prisma, req.user.id, 'ALL_ORDERS_DELETED', null, {
      deletedOrders: countsBefore.totalOrders,
      deletedAssignments: countsBefore.totalAssignments
    });

    res.json({
      success: true,
      data: {
        deletedOrders: countsBefore.totalOrders,
        deletedAssignments: countsBefore.totalAssignments
      },
      message: `Deleted ${countsBefore.totalOrders} orders and ${countsBefore.totalAssignments} assignments`
    });
  } catch (error) {
    console.error('orders/delete-all error:', error);
    res.status(500).json({ success: false, data: {}, message: 'Failed to delete all orders' });
  }
});

router.get('/rejection-stats', authMiddleware, roleGuard('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { fromDate, toDate, role } = req.query;
    const { start, end } = parseDateRange(fromDate, toDate);
    const roleFilter = role ? String(role).toUpperCase() : '';
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const weekStart = getWeekStart();

    const scopeOrderWhere = req.user.role === 'MANAGER'
      ? { csvBatch: { uploadedBy: req.user.id } }
      : {};

    const rejectionWhereBase = {
      createdAt: { gte: start, lte: end },
      order: scopeOrderWhere
    };

    if (REJECTION_ROUTE_ROLES.includes(roleFilter)) {
      rejectionWhereBase.routedTo = roleFilter;
    }

    const [todayRejected, weekRejected, weekInspected] = await Promise.all([
      prisma.rejection.count({
        where: {
          createdAt: { gte: todayStart },
          order: scopeOrderWhere
        }
      }),
      prisma.rejection.count({
        where: {
          createdAt: { gte: weekStart },
          order: scopeOrderWhere
        }
      }),
      prisma.activityLog.count({
        where: {
          action: { in: ['ORDER_REJECTED', 'ORDER_PASSED'] },
          createdAt: { gte: weekStart },
          order: scopeOrderWhere
        }
      })
    ]);

    const rejections = await prisma.rejection.findMany({
      where: rejectionWhereBase,
      include: {
        order: {
          include: {
            assignments: {
              include: {
                employee: {
                  select: { id: true, empId: true, name: true, role: true }
                }
              }
            },
            csvBatch: {
              include: {
                uploader: {
                  select: { id: true, empId: true, name: true, role: true }
                }
              }
            }
          }
        }
      }
    });

    const handledAssignments = await prisma.orderAssignment.findMany({
      where: {
        completedAt: { gte: start, lte: end },
        order: scopeOrderWhere,
        ...(REJECTION_ROUTE_ROLES.includes(roleFilter) ? { role: roleFilter } : {})
      },
      select: {
        employeeId: true,
        role: true
      }
    });

    const handledMap = new Map();
    handledAssignments.forEach((row) => {
      const key = `${row.employeeId}::${row.role}`;
      handledMap.set(key, (handledMap.get(key) || 0) + 1);
    });

    const rejectionCountByManager = new Map();
    const rejectionCountByEmployee = new Map();

    rejections.forEach((rej) => {
      const manager = rej.order?.csvBatch?.uploader;
      if (manager) {
        const managerKey = manager.id;
        const existing = rejectionCountByManager.get(managerKey) || {
          managerId: manager.id,
          managerEmpId: manager.empId,
          managerName: manager.name,
          totalRejections: 0
        };
        existing.totalRejections += 1;
        rejectionCountByManager.set(managerKey, existing);
      }

      const impactedAssignments = (rej.order?.assignments || []).filter((assignment) => assignment.role === rej.routedTo);
      impactedAssignments.forEach((assignment) => {
        const employee = assignment.employee;
        if (!employee) return;
        const key = `${employee.id}::${assignment.role}`;
        const existing = rejectionCountByEmployee.get(key) || {
          employeeId: employee.id,
          empId: employee.empId,
          employeeName: employee.name,
          role: assignment.role,
          totalRejections: 0,
          handledCount: 0,
          rejectionRate: 0
        };
        existing.totalRejections += 1;
        rejectionCountByEmployee.set(key, existing);
      });
    });

    const employeeStats = [...rejectionCountByEmployee.values()]
      .map((row) => {
        const handledCount = handledMap.get(`${row.employeeId}::${row.role}`) || 0;
        const rejectionRate = handledCount > 0
          ? Number(((row.totalRejections / handledCount) * 100).toFixed(2))
          : 0;
        return { ...row, handledCount, rejectionRate };
      })
      .sort((a, b) => b.totalRejections - a.totalRejections);

    const managerStats = [...rejectionCountByManager.values()]
      .sort((a, b) => b.totalRejections - a.totalRejections);

    const rejectionRateThisWeek = weekInspected > 0
      ? Number(((weekRejected / weekInspected) * 100).toFixed(2))
      : 0;

    res.json({
      success: true,
      data: {
        summary: {
          rejectedToday: todayRejected,
          rejectedThisWeek: weekRejected,
          inspectedThisWeek: weekInspected,
          rejectionRateThisWeek
        },
        filters: {
          fromDate: start,
          toDate: end,
          role: roleFilter || null
        },
        employeeStats,
        managerStats
      },
      message: 'Rejection stats fetched'
    });
  } catch (error) {
    console.error('orders/rejection-stats error:', error);
    res.status(500).json({ success: false, data: {}, message: 'Failed to load rejection stats' });
  }
});

router.post('/:id/reject', authMiddleware, roleGuard('SUPERVISOR'), async (req, res) => {
  try {
    const { reasonCategory, reason = '', routedTo } = req.body;
    const normalizedCategory = String(reasonCategory || '').toUpperCase();

    if (!REJECTION_CATEGORIES.includes(normalizedCategory)) {
      return res.status(400).json({
        success: false,
        data: {},
        message: `Invalid reasonCategory. Allowed: ${REJECTION_CATEGORIES.join(', ')}`
      });
    }

    let routing = REJECTION_ROUTE_CONFIG[normalizedCategory] || null;
    if (normalizedCategory === 'OTHER') {
      const normalizedRoute = String(routedTo || '').toUpperCase();
      if (!REJECTION_ROUTE_ROLES.includes(normalizedRoute)) {
        return res.status(400).json({
          success: false,
          data: {},
          message: `routedTo is required for OTHER. Allowed: ${REJECTION_ROUTE_ROLES.join(', ')}`
        });
      }

      const fallbackStatus = normalizedRoute === 'FABRIC_MAN'
        ? 'ASSIGNED'
        : normalizedRoute === 'CUTTER'
          ? 'FABRIC_DONE'
          : 'CUTTING_DONE';

      routing = { routedTo: normalizedRoute, resetStatus: fallbackStatus };
    }

    const result = await prisma.$transaction(async (tx) => {
      const currentOrder = await tx.order.findUnique({ where: { id: req.params.id } });
      if (!currentOrder) {
        throw new Error('Order not found');
      }

      // Optimistic lock: only one supervisor can reject an order while it is pending QC.
      const statusUpdate = await tx.order.updateMany({
        where: {
          id: currentOrder.id,
          status: 'TAILOR_DONE',
          updatedAt: currentOrder.updatedAt
        },
        data: {
          status: routing.resetStatus
        }
      });

      if (statusUpdate.count === 0) {
        throw new Error('Order is no longer available for rejection. Please refresh and try again.');
      }

      const rejection = await tx.rejection.create({
        data: {
          orderId: currentOrder.id,
          rejectedBy: req.user.id,
          routedTo: routing.routedTo,
          reason: String(reason || '').trim() || 'No reason provided',
          reasonCategory: normalizedCategory
        }
      });

      await tx.orderStatusHistory.create({
        data: {
          orderId: currentOrder.id,
          fromStatus: currentOrder.status,
          toStatus: routing.resetStatus,
          changedBy: req.user.id,
          metadata: {
            source: 'supervisor-reject',
            reasonCategory: normalizedCategory,
            routedTo: routing.routedTo,
            rejectionId: rejection.id
          }
        }
      });

      return { rejection, currentOrder, routing };
    });

    await logActivity(prisma, req.user.id, 'ORDER_REJECTED', result.currentOrder.id, {
      rejectedBy: req.user.id,
      routedTo: result.routing.routedTo,
      reasonCategory: normalizedCategory,
      reason: String(reason || '').trim() || 'No reason provided',
      orderId: result.currentOrder.id,
      rejectionId: result.rejection.id
    });

    res.json({
      success: true,
      data: {
        rejection: result.rejection,
        orderId: result.currentOrder.id,
        routedTo: result.routing.routedTo,
        resetStatus: result.routing.resetStatus
      },
      message: `Order rejected and routed to ${result.routing.routedTo}`
    });
  } catch (error) {
    const statusCode = error.message === 'Order not found' ? 404 : 409;
    if (statusCode === 409 && !String(error.message || '').includes('available for rejection')) {
      console.error('orders/reject error:', error);
      return res.status(500).json({ success: false, data: {}, message: 'Failed to reject order' });
    }
    res.status(statusCode).json({ success: false, data: {}, message: error.message || 'Failed to reject order' });
  }
});

router.post('/:id/pass', authMiddleware, roleGuard('SUPERVISOR'), async (req, res) => {
  try {
    const result = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: req.params.id } });
      if (!order) throw new Error('Order not found');

      if (!['TAILOR_DONE', 'QC_IN_PROGRESS'].includes(order.status)) {
        throw new Error(`Order is not ready for pass. Current status: ${order.status}`);
      }

      await tx.order.update({
        where: { id: order.id },
        data: { status: 'COMPLETED' }
      });

      await tx.orderStatusHistory.create({
        data: {
          orderId: order.id,
          fromStatus: order.status,
          toStatus: 'COMPLETED',
          changedBy: req.user.id,
          metadata: { source: 'supervisor-pass' }
        }
      });

      const unresolved = await tx.rejection.findMany({
        where: {
          orderId: order.id,
          resolvedAt: null
        },
        orderBy: { createdAt: 'desc' }
      });

      if (unresolved.length > 0) {
        await tx.rejection.updateMany({
          where: {
            id: { in: unresolved.map((item) => item.id) }
          },
          data: { resolvedAt: new Date() }
        });
      }

      return { order, resolvedRejections: unresolved.length };
    });

    await logActivity(prisma, req.user.id, 'ORDER_PASSED', result.order.id, {
      orderId: result.order.id,
      resolvedRejections: result.resolvedRejections
    });

    res.json({
      success: true,
      data: {
        orderId: result.order.id,
        status: 'COMPLETED',
        resolvedRejections: result.resolvedRejections
      },
      message: 'Order marked as completed'
    });
  } catch (error) {
    if (error.message === 'Order not found') {
      return res.status(404).json({ success: false, data: {}, message: error.message });
    }
    if (String(error.message || '').includes('not ready for pass')) {
      return res.status(400).json({ success: false, data: {}, message: error.message });
    }
    console.error('orders/pass error:', error);
    res.status(500).json({ success: false, data: {}, message: 'Failed to pass order' });
  }
});

router.get('/:id/rejections', authMiddleware, roleGuard('ADMIN', 'MANAGER', 'SUPERVISOR', 'FABRIC_MAN', 'CUTTER', 'TAILOR'), async (req, res) => {
  try {
    const rejections = await prisma.rejection.findMany({
      where: { orderId: req.params.id },
      orderBy: { createdAt: 'desc' },
      include: {
        supervisor: {
          select: { id: true, empId: true, name: true, role: true }
        }
      }
    });

    res.json({
      success: true,
      data: { items: rejections },
      message: 'Order rejection history fetched'
    });
  } catch (error) {
    console.error('orders/rejections error:', error);
    res.status(500).json({ success: false, data: {}, message: 'Failed to fetch order rejections' });
  }
});

router.get('/:id([0-9a-fA-F-]{36})', authMiddleware, roleGuard('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: {
        assignments: {
          include: {
            employee: {
              select: { id: true, empId: true, name: true, role: true }
            }
          }
        },
        rejections: {
          orderBy: { createdAt: 'desc' },
          include: {
            supervisor: {
              select: { id: true, empId: true, name: true, role: true }
            }
          }
        },
        subOrders: true,
        parentOrder: true
      }
    });

    if (!order) {
      return res.status(404).json({ success: false, data: {}, message: 'Order not found' });
    }

    res.json({ success: true, data: { order }, message: 'Order detail fetched' });
  } catch (error) {
    console.error('orders/detail error:', error);
    res.status(500).json({ success: false, data: {}, message: 'Failed to fetch order detail' });
  }
});

router.post('/:id/assign', authMiddleware, roleGuard('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const result = await assignmentService.assignOrder(req.params.id);
    await logActivity(prisma, req.user.id, 'ORDER_ASSIGNED_MANUALLY', req.params.id, result);
    res.json({ success: true, data: { result }, message: 'Order assignment triggered' });
  } catch (error) {
    console.error('orders/assign error:', error);
    res.status(400).json({ success: false, data: {}, message: error.message || 'Failed to assign order' });
  }
});

router.patch('/:id/status', authMiddleware, async (req, res) => {
  try {
    const { newStatus } = req.body;
    if (!newStatus) {
      return res.status(400).json({ success: false, data: {}, message: 'newStatus is required' });
    }

    const order = await prisma.order.findUnique({ where: { id: req.params.id } });
    if (!order) {
      return res.status(404).json({ success: false, data: {}, message: 'Order not found' });
    }

    const issueLogs = await prisma.activityLog.findMany({
      where: {
        orderId: order.id,
        action: { in: [ISSUE_REPORTED_ACTION, ISSUE_RESOLVED_ACTION] }
      },
      select: { id: true, action: true, metadata: true, createdAt: true },
      orderBy: { createdAt: 'asc' }
    });

    const unresolvedIssues = getUnresolvedIssueIds(issueLogs);
    if (unresolvedIssues.size > 0) {
      return res.status(409).json({
        success: false,
        data: { unresolvedIssueCount: unresolvedIssues.size },
        message: 'Order is currently halted due to reported issue(s). Resolve issues before updating status.'
      });
    }

    const allowedNext = STATUS_TRANSITIONS[order.status] || [];
    if (!allowedNext.includes(newStatus)) {
      return res.status(400).json({
        success: false,
        data: { currentStatus: order.status, attemptedStatus: newStatus, allowedNext },
        message: 'Invalid status transition'
      });
    }

    const updated = await prisma.order.update({
      where: { id: order.id },
      data: { status: newStatus }
    });

    // Keep parent status aligned with the worst-case status among sub-orders.
    if (order.parentOrderId) {
      const siblings = await prisma.order.findMany({
        where: { parentOrderId: order.parentOrderId },
        select: { status: true }
      });

      if (siblings.length > 0) {
        const worst = siblings.reduce((acc, current) => {
          const currentRank = STATUS_RANK[current.status] ?? 999;
          const accRank = STATUS_RANK[acc] ?? 999;
          return currentRank < accRank ? current.status : acc;
        }, siblings[0].status);

        await prisma.order.update({
          where: { id: order.parentOrderId },
          data: { status: worst }
        });
      }
    }

    const roleByStatus = {
      FABRIC_IN_PROGRESS: 'FABRIC_MAN',
      FABRIC_DONE: 'FABRIC_MAN',
      CUTTING_IN_PROGRESS: 'CUTTER',
      CUTTING_DONE: 'CUTTER',
      TAILOR_IN_PROGRESS: 'TAILOR',
      TAILOR_DONE: 'TAILOR'
    };

    const assignmentRole = roleByStatus[newStatus];
    if (assignmentRole) {
      const latestAssignment = await prisma.orderAssignment.findFirst({
        where: { orderId: order.id, role: assignmentRole },
        orderBy: { assignedAt: 'desc' }
      });

      if (latestAssignment) {
        const assignmentUpdate = {};
        if (newStatus.endsWith('_IN_PROGRESS')) assignmentUpdate.startedAt = new Date();
        if (newStatus.endsWith('_DONE')) assignmentUpdate.completedAt = new Date();

        if (Object.keys(assignmentUpdate).length > 0) {
          await prisma.orderAssignment.update({
            where: { id: latestAssignment.id },
            data: assignmentUpdate
          });
        }
      }
    }

    await prisma.orderStatusHistory.create({
      data: {
        orderId: order.id,
        fromStatus: order.status,
        toStatus: newStatus,
        changedBy: req.user?.id,
        metadata: { source: 'status-update-api' }
      }
    });

    await logActivity(prisma, req.user.id, 'ORDER_STATUS_UPDATED', order.id, {
      oldStatus: order.status,
      newStatus
    });

    res.json({ success: true, data: { order: updated }, message: 'Order status updated' });
  } catch (error) {
    console.error('orders/status error:', error);
    res.status(500).json({ success: false, data: {}, message: 'Failed to update order status' });
  }
});

router.post('/:id/issue', authMiddleware, roleGuard('FABRIC_MAN', 'CUTTER', 'TAILOR', 'SUPERVISOR', 'MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const { issueType, description } = req.body;
    if (!issueType || !description) {
      return res.status(400).json({ success: false, data: {}, message: 'issueType and description are required' });
    }

    const order = await prisma.order.findUnique({ where: { id: req.params.id } });
    if (!order) {
      return res.status(404).json({ success: false, data: {}, message: 'Order not found' });
    }

    await logActivity(prisma, req.user.id, ISSUE_REPORTED_ACTION, order.id, {
      issueType: String(issueType).trim(),
      description: String(description).trim(),
      role: req.user.role
    });

    res.json({ success: true, data: {}, message: 'Issue reported successfully' });
  } catch (error) {
    console.error('orders/issue error:', error);
    res.status(500).json({ success: false, data: {}, message: 'Failed to report issue' });
  }
});

router.get('/reported-issues', authMiddleware, roleGuard('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const statusFilter = String(req.query.status || 'open').toLowerCase();
    const limitNum = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 500);

    const logs = await prisma.activityLog.findMany({
      where: {
        action: { in: [ISSUE_REPORTED_ACTION, ISSUE_RESOLVED_ACTION] },
        orderId: { not: null }
      },
      include: {
        employee: { select: { id: true, empId: true, name: true, role: true } },
        order: { select: { id: true, orderCode: true, status: true, details: true } }
      },
      orderBy: { createdAt: 'asc' }
    });

    const resolveByReportId = new Map();
    for (const log of logs) {
      if (log.action !== ISSUE_RESOLVED_ACTION) continue;
      const reportId = log.metadata?.reportedActivityId;
      if (reportId) resolveByReportId.set(reportId, log);
    }

    let items = logs
      .filter((log) => log.action === ISSUE_REPORTED_ACTION)
      .map((log) => {
        const resolvedLog = resolveByReportId.get(log.id) || null;
        return {
          id: log.id,
          orderId: log.orderId,
          order: log.order,
          reportedBy: log.employee,
          issueType: log.metadata?.issueType || null,
          description: log.metadata?.description || null,
          reportedRole: log.metadata?.role || null,
          reportedAt: log.createdAt,
          isResolved: Boolean(resolvedLog),
          resolvedAt: resolvedLog?.createdAt || null,
          resolvedByEmployeeId: resolvedLog?.employeeId || null,
          resolvedBy: resolvedLog?.employee || null,
          resolutionNote: resolvedLog?.metadata?.resolutionNote || null,
          correctedMaterial: resolvedLog?.metadata?.correctedMaterial || null
        };
      });

    if (statusFilter === 'open') items = items.filter((item) => !item.isResolved);
    if (statusFilter === 'resolved') items = items.filter((item) => item.isResolved);

    items = items.sort((a, b) => new Date(b.reportedAt).getTime() - new Date(a.reportedAt).getTime()).slice(0, limitNum);

    res.json({
      success: true,
      data: { items, total: items.length, status: statusFilter },
      message: 'Reported issues fetched'
    });
  } catch (error) {
    console.error('orders/reported-issues error:', error);
    res.status(500).json({ success: false, data: {}, message: 'Failed to fetch reported issues' });
  }
});

router.post('/issues/:activityId/resolve', authMiddleware, roleGuard('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { resolutionNote = '', correctedMaterial = '' } = req.body || {};

    const reportLog = await prisma.activityLog.findUnique({
      where: { id: req.params.activityId },
      include: {
        order: { select: { id: true, details: true } },
        employee: { select: { id: true, empId: true, name: true, role: true } }
      }
    });

    if (!reportLog || reportLog.action !== ISSUE_REPORTED_ACTION) {
      return res.status(404).json({ success: false, data: {}, message: 'Reported issue entry not found' });
    }

    if (!reportLog.orderId || !reportLog.order) {
      return res.status(400).json({ success: false, data: {}, message: 'Reported issue has no linked order' });
    }

    const issueLogs = await prisma.activityLog.findMany({
      where: {
        orderId: reportLog.orderId,
        action: { in: [ISSUE_REPORTED_ACTION, ISSUE_RESOLVED_ACTION] }
      },
      select: { id: true, action: true, metadata: true, createdAt: true },
      orderBy: { createdAt: 'asc' }
    });

    const unresolvedIssues = getUnresolvedIssueIds(issueLogs);
    if (!unresolvedIssues.has(reportLog.id)) {
      return res.status(400).json({ success: false, data: {}, message: 'This reported issue is already resolved' });
    }

    const previousDetails = reportLog.order.details && typeof reportLog.order.details === 'object'
      ? reportLog.order.details
      : {};
    const previousHistory = Array.isArray(previousDetails.issueResolutionHistory)
      ? previousDetails.issueResolutionHistory
      : [];

    const resolutionEntry = {
      reportedActivityId: reportLog.id,
      issueType: reportLog.metadata?.issueType || null,
      description: reportLog.metadata?.description || null,
      resolvedBy: req.user.id,
      resolvedAt: new Date().toISOString(),
      resolutionNote: String(resolutionNote || '').trim() || null,
      correctedMaterial: String(correctedMaterial || '').trim() || null
    };

    await prisma.$transaction([
      prisma.activityLog.create({
        data: {
          employeeId: req.user.id,
          action: ISSUE_RESOLVED_ACTION,
          orderId: reportLog.orderId,
          metadata: {
            reportedActivityId: reportLog.id,
            issueType: reportLog.metadata?.issueType || null,
            resolutionNote: String(resolutionNote || '').trim() || null,
            correctedMaterial: String(correctedMaterial || '').trim() || null
          }
        }
      }),
      prisma.order.update({
        where: { id: reportLog.orderId },
        data: {
          details: {
            ...previousDetails,
            issueResolutionHistory: [...previousHistory, resolutionEntry]
          }
        }
      })
    ]);

    res.json({
      success: true,
      data: {
        orderId: reportLog.orderId,
        reportedActivityId: reportLog.id,
        issueType: reportLog.metadata?.issueType || null,
        resolutionNote: String(resolutionNote || '').trim() || null,
        correctedMaterial: String(correctedMaterial || '').trim() || null
      },
      message: 'Issue resolved and order resumed'
    });
  } catch (error) {
    console.error('orders/resolve-issue error:', error);
    res.status(500).json({ success: false, data: {}, message: 'Failed to resolve issue' });
  }
});

router.get('/:id/timeline', authMiddleware, roleGuard('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const timeline = await prisma.orderStatusHistory.findMany({
      where: { orderId: req.params.id },
      orderBy: { createdAt: 'asc' },
      include: {
        employee: {
          select: { id: true, empId: true, name: true, role: true }
        }
      }
    });

    res.json({ success: true, data: { timeline }, message: 'Order timeline fetched' });
  } catch (error) {
    console.error('orders/timeline error:', error);
    res.status(500).json({ success: false, data: {}, message: 'Failed to load order timeline' });
  }
});

export default router;
