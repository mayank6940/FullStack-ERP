# Garment Manufacturing ERP

Production ERP for garment manufacturing with role-based desktop/mobile portals, full order lifecycle tracking, supervisor rejection routing, and reporting/ML export support.

## 1. Project Overview

Roles supported:
- ADMIN
- MANAGER
- FABRIC_MAN
- CUTTER
- TAILOR
- SUPERVISOR

Core lifecycle:
- Manager uploads CSV
- Orders are assigned
- Fabric -> Cutting -> Tailor -> Supervisor QC
- Supervisor can pass or reject back to responsible role

## 2. Tech Stack

- Frontend: React 18, Vite 8, TailwindCSS
- Backend: Node.js (ESM), Express
- Database: PostgreSQL, Prisma ORM
- Auth: JWT (HttpOnly cookie support + bearer fallback)
- Caching/Phase 6 readiness: Redis URL documented
- Process manager (recommended for server): PM2

## 2.1 Deployment Flow

This repo is ready for a split deployment:
- Frontend on Vercel from the `frontend` folder.
- Backend on Render from the `backend` folder.

Frontend routing is already configured for SPA refreshes through [frontend/vercel.json](frontend/vercel.json).
Backend deployment settings are defined in [render.yaml](render.yaml).

## 3. Local Development Setup

No Docker is required.

### Prerequisites
- Node.js 18+
- PostgreSQL 13+
- npm

### Install
```bash
cd backend
npm install

cd ../frontend
npm install
```

From repository root (full install):
```bash
npm run install:all
```

### Environment
- Copy root [.env.example](.env.example) values into your local backend/frontend env files as needed.
- For Vercel, set `VITE_API_URL` to the Render backend URL after the backend is live.
- Ensure backend has valid `DATABASE_URL`, JWT secrets, `PORT`, and `FRONTEND_ORIGIN`.

### Database
```bash
cd backend
npx prisma generate
npx prisma migrate dev
```

From repository root (full build):
```bash
npm run build
```

### Run
Terminal 1:
```bash
cd backend
npm run dev
```

Terminal 2:
```bash
cd frontend
npm run dev
```

Frontend default: `http://localhost:3000`
Backend default: `http://localhost:5000`

## 4. Environment Variables Guide

Reference: [.env.example](.env.example)

Important values:
- `DATABASE_URL`
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `PORT`
- `NODE_ENV`
- `BCRYPT_SALT_ROUNDS`
- `REDIS_URL`
- `VITE_API_URL`

## 5. Database Migrations

Create migration:
```bash
cd backend
npx prisma migrate dev --name <migration_name>
```

Apply on server:
```bash
npx prisma migrate deploy
```

Regenerate Prisma client:
```bash
npx prisma generate
```

## 6. Production Deployment Guide (Ubuntu, No Docker)

Suggested path: `/opt/garment-erp`

1. Clone repository on server.
2. Install Node.js and PostgreSQL.
3. Configure backend env.
4. Install dependencies:
```bash
cd /opt/garment-erp/backend
npm ci --omit=dev
npx prisma migrate deploy
npx prisma generate
```
5. Start backend with PM2:
```bash
pm2 start src/index.js --name garment-erp-backend
pm2 save
pm2 startup
```
6. Build frontend:
```bash
cd /opt/garment-erp/frontend
npm ci
npm run build
```
7. Serve frontend build using your preferred static server/reverse proxy.

## 7. Vercel + Render Deployment

Recommended order:
1. Deploy the frontend first on Vercel using the `frontend` directory as the project root.
2. Set `VITE_API_URL` in Vercel to the Render backend URL once the backend is deployed.
3. Deploy the backend on Render using the `backend` directory as the root.
4. Set `FRONTEND_ORIGIN` on Render to your Vercel domain so cookies and CORS work correctly.

Frontend notes:
- Keep `VITE_API_URL` pointed at Render in production.
- The SPA rewrite in [frontend/vercel.json](frontend/vercel.json) keeps direct portal URLs working on refresh.

Backend notes:
- Render should expose `/api/health` as the health check path.
- Render needs `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, and `FRONTEND_ORIGIN` set in the dashboard.

## 8. SSL Setup Guide

Use [scripts/setup-ssl.sh](scripts/setup-ssl.sh):
```bash
chmod +x scripts/setup-ssl.sh
./scripts/setup-ssl.sh app.example.com api.example.com
```

The script obtains certificates with Certbot and enables auto-renewal timer.

## 9. Database Backup Guide

Use [scripts/backup-db.sh](scripts/backup-db.sh):
```bash
chmod +x scripts/backup-db.sh
PGHOST=localhost PGPORT=5432 PGUSER=postgres PGPASSWORD=postgres DB_NAME=garment_erp ./scripts/backup-db.sh
```

Optional upload to S3-compatible storage:
```bash
S3_BUCKET=s3://your-backup-bucket ./scripts/backup-db.sh
```

Restore:
```bash
gunzip -c backups/<backup_file>.sql.gz | psql -h localhost -U postgres garment_erp
```

## 10. Add a New Employee Role

1. Add role to Prisma enum `Role` in [backend/src/prisma/schema.prisma](backend/src/prisma/schema.prisma).
2. Run migration and regenerate Prisma client.
3. Update role guards and assignment logic in backend routes/services.
4. Add frontend routing and portal UI.
5. Add language labels in i18n files.
6. Add tests/report mappings where relevant.

## 11. Troubleshooting

- `npm run dev` fails in wrong directory:
Run commands from `backend` or `frontend`, not parent folder.
- Prisma connection errors:
Check `DATABASE_URL`, PostgreSQL service status, and credentials.
- Frontend cannot reach backend:
Confirm backend is running on expected port and frontend proxy/API base URL matches.
- Migration issues:
Run `npx prisma migrate status` and `npx prisma generate`.

## Phase 5 Deliverables Status

Implemented:
- Reporting endpoints (`/api/reports/*`)
- Admin ML export endpoints
- Activity monitor polling and color coding
- Overdue alerts in manager dashboard
- API health endpoint `/api/health`
- DB indexes for frequent queries
- Pagination limits and consistency improvements on list endpoints
- Lazy-loaded portal routes and skeleton loading states
- CI deploy workflow via SSH
- Backup and SSL setup scripts

Skipped intentionally:
- Docker, docker-compose, and Nginx tasks
- These were explicitly excluded in project instructions.

## CI/CD Secrets

Required repository secrets for [deploy workflow](.github/workflows/deploy.yml):
- `SERVER_HOST`
- `SERVER_USER`
- `SERVER_SSH_KEY`
- `DATABASE_URL`
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
