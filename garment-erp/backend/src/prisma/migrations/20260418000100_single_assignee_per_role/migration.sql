-- Keep only the latest assignment per (order, role) before enforcing uniqueness.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "orderId", role
      ORDER BY "assignedAt" DESC, id DESC
    ) AS rn
  FROM order_assignments
)
DELETE FROM order_assignments
WHERE id IN (
  SELECT id FROM ranked WHERE rn > 1
);

-- Enforce one employee per role for each order.
CREATE UNIQUE INDEX "order_assignments_orderId_role_key"
ON "order_assignments"("orderId", "role");
