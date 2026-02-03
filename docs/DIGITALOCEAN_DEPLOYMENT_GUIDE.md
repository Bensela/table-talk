# Digital Ocean App Platform Deployment Guide - Table-Talk

> **Last Updated**: February 2026  
> **Application**: Table-Talk MVP  
> **Platform**: Digital Ocean App Platform

---

## Table of Contents

1. [Codebase Deep Dive](#1-codebase-deep-dive)
2. [Digital Ocean App Platform Configuration](#2-digital-ocean-app-platform-configuration)
3. [Deployment Strategy](#3-deployment-strategy)
4. [Post-Deployment Checklist](#4-post-deployment-checklist)
5. [Troubleshooting](#5-troubleshooting)

---

## 1. Codebase Deep Dive

### 1.1 Application Architecture

**Table-Talk** is a full-stack web application designed to facilitate meaningful conversations in restaurants through QR code scanning. The application uses a monorepo structure with separate frontend and backend workspaces.

```
table-talk/
├── backend/          # Node.js/Express API + Socket.io server
├── frontend/         # React/Vite SPA
├── docs/            # Documentation
├── package.json     # Root workspace configuration
└── app-spec.yaml    # Digital Ocean App Platform spec
```

**Key Features**:
- Zero-friction QR code-based session creation
- Single-phone and dual-phone modes
- Real-time synchronization using Socket.io
- Daily shuffled question decks (deterministic seeding)
- Anonymous sessions with auto-expiration
- Context-aware questions (Exploring, Established, Mature)

### 1.2 Technology Stack

#### Frontend
- **Framework**: React 19.1.0
- **Build Tool**: Vite 6.3.5
- **Styling**: Tailwind CSS 4.1.18, Autoprefixer, PostCSS
- **Routing**: React Router DOM 7.11.0
- **Animations**: Framer Motion 12.29.2
- **Real-time**: Socket.io-client 4.8.3
- **HTTP Client**: Axios 1.13.2
- **QR Scanning**: html5-qrcode 2.3.8
- **Testing**: Vitest 4.0.17, Testing Library

#### Backend
- **Runtime**: Node.js 22.x
- **Framework**: Express 4.18.2
- **Real-time**: Socket.io 4.8.3
- **Database Driver**: pg (PostgreSQL) 8.16.3
- **QR Generation**: qrcode 1.5.4
- **Environment**: dotenv 17.2.3
- **CORS**: cors 2.8.5
- **Testing**: Jest 29.7.0, Supertest 7.2.2
- **Dev Tools**: Nodemon 3.1.11

#### Database
- **Engine**: PostgreSQL (version 14+)
- **Schema**: 3 tables (sessions, questions, analytics_events)
- **Extensions**: uuid-ossp
- **Migrations**: Custom Node.js scripts

### 1.3 Package Managers and Dependencies

**Monorepo Structure**: Uses npm workspaces for coordinated dependency management.

```json
{
  "workspaces": ["backend", "frontend"]
}
```

**Key Scripts** (root `package.json`):
- `npm run setup` - Install all dependencies
- `npm run dev` - Start both frontend and backend in development
- `npm run build` - Build frontend for production
- `npm start` - Start backend server in production

**Backend Dependencies** (22 total):
- **Production**: Express, Socket.io, pg, cors, dotenv, qrcode, uuid, ms
- **Development**: Jest, Supertest, Nodemon, cross-env

**Frontend Dependencies** (30 total):
- **Production**: React, React DOM, Vite, Tailwind CSS, Socket.io-client, Axios, Framer Motion, html5-qrcode
- **Development**: ESLint, Vitest, Testing Library, TypeScript types

### 1.4 Environment Variables

#### Backend Environment Variables

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `DATABASE_URL` | ✅ Yes | PostgreSQL connection string | `postgresql://user:pass@host:5432/db?sslmode=require` |
| `NODE_ENV` | ✅ Yes | Environment mode | `production` |
| `PORT` | No | HTTP server port (default: 5000) | `8080` |
| `FRONTEND_URL` | ✅ Yes | Frontend origin for CORS | `https://tabletalk.app` |
| `LOG_LEVEL` | No | Logging verbosity | `info` |

**Security Note**: The `DATABASE_URL` contains sensitive credentials and should **never** be hardcoded. Use Digital Ocean's database component or encrypted environment variables.

#### Frontend Environment Variables

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `VITE_API_URL` | ✅ Yes | Backend API base URL | `/api` or `https://api.tabletalk.app/api` |

**Build-time Note**: Vite environment variables must be prefixed with `VITE_` and are embedded at build time. They are **not** server-side secrets.

### 1.5 Database Schema

**Tables**:

1. **sessions**
   - `session_id` (UUID, primary key)
   - `table_id` (VARCHAR) - Restaurant table identifier
   - `mode` (VARCHAR) - 'single' or 'dual'
   - `created_at`, `expires_at` (TIMESTAMP)
   - `current_question_index` (INTEGER)
   - `deck_seed` (VARCHAR) - For deterministic shuffling

2. **questions**
   - `question_id` (SERIAL, primary key)
   - `question_text` (TEXT)
   - `answer_text` (TEXT, nullable)
   - `category` (VARCHAR)
   - `difficulty` (VARCHAR) - 'easy', 'medium', 'deep'

3. **analytics_events**
   - `event_id` (UUID, primary key)
   - `session_id` (UUID, foreign key)
   - `event_type` (VARCHAR)
   - `event_data` (JSONB)
   - `timestamp` (TIMESTAMP)

**Migrations**: Located in `backend/database/migrations/`
- `001_phase1_upgrade.sql`
- `002_restrict_contexts.sql`
- `003_enable_mature_context.sql`

**Seed Data**: `backend/database/seeds/questions.sql` contains initial question sets.

### 1.6 External Services Required

1. **PostgreSQL Database** (Managed or Dev)
   - Minimum version: 14
   - SSL mode: Required for production
   - Extensions: `uuid-ossp`

2. **WebSocket Support** (for Socket.io)
   - Digital Ocean App Platform supports WebSockets natively
   - No special configuration required

3. **Static File Hosting** (for frontend)
   - Digital Ocean's static site component handles this automatically

---

## 2. Digital Ocean App Platform Configuration

### 2.1 Optimal App Spec Configuration

Digital Ocean App Platform uses an **app spec** (YAML file) to define your application's infrastructure. The optimal configuration for Table-Talk includes:

- **Backend Service**: Node.js 22 with Socket.io support
- **Frontend Static Site**: Vite-built React SPA
- **PostgreSQL Database**: Dev database or managed PostgreSQL
- **Health Checks**: Custom endpoint monitoring
- **Ingress Rules**: Route `/api` to backend, `/` to frontend

### 2.2 Resource Sizing Recommendations

#### For MVP / Low Traffic (< 1,000 sessions/day)

**Backend Service**:
- **Plan**: Basic
- **Instance Size**: `apps-s-1vcpu-512mb` or `apps-s-1vcpu-1gb`
- **Instance Count**: 1
- **Monthly Cost**: ~$5-12

**Frontend Static Site**:
- **Plan**: Static Site (Free tier available)
- **Monthly Cost**: $0-3

**Database**:
- **Option 1**: Dev Database (Free, single node, 1GB RAM)
- **Option 2**: Managed PostgreSQL Basic ($15/month, 1GB RAM, 10GB storage)

**Total Estimated Cost**: $5-27/month

#### For Production / Medium Traffic (1,000-10,000 sessions/day)

**Backend Service**:
- **Plan**: Professional
- **Instance Size**: `apps-s-2vcpu-4gb`
- **Instance Count**: 2 (for redundancy and load balancing)
- **Monthly Cost**: ~$24-48

**Frontend Static Site**:
- **Plan**: Static Site
- **Monthly Cost**: $3

**Database**:
- **Option**: Managed PostgreSQL (recommended)
- **Plan**: $15-35/month depending on size
- **Backup**: Automated daily backups included

**Total Estimated Cost**: $42-86/month

### 2.3 Buildpack Configuration

Digital Ocean automatically detects Node.js projects and uses the appropriate buildpack. For explicit control:

**Environment Slug**: `node-js` (auto-detected)

**Node.js Version**: Specified in `package.json`:
```json
{
  "engines": {
    "node": "22.x"
  }
}
```

**Build Stack**: Ubuntu 22.04 (recommended)

To explicitly set the build stack, add to `app-spec.yaml`:
```yaml
features:
  - buildpack-stack=ubuntu-22
```

### 2.4 Database Component Configuration

**Option 1: Dev Database** (Recommended for MVP/Testing)

```yaml
databases:
  - engine: PG
    name: table-talk-db
    version: "16"
```

**Characteristics**:
- Free tier available
- Single node (no high availability)
- 1GB RAM, 10GB storage
- Automatic backups: None
- Suitable for development and low-traffic production

**Option 2: Managed PostgreSQL** (Recommended for Production)

Create a managed database separately in Digital Ocean, then attach it:

```yaml
# No database component in spec; attach via UI or CLI
```

**Characteristics**:
- High availability with standby nodes
- Automated daily backups
- Scalable (1GB to 256GB RAM)
- Point-in-time recovery
- Trusted sources for security

**Connecting to Database**:

When you attach a database to your app, Digital Ocean provides environment variables:

- `${db.DATABASE_URL}` - Full connection string
- `${db.HOSTNAME}`, `${db.PORT}`, `${db.USERNAME}`, `${db.PASSWORD}`, `${db.DATABASE}` - Individual components

### 2.5 Environment Variables and Secrets

#### Backend Service Environment Variables

```yaml
envs:
  - key: NODE_ENV
    value: production
    
  - key: PORT
    value: "8080"
    
  - key: LOG_LEVEL
    value: info
    
  - key: FRONTEND_URL
    value: ${APP_URL}  # Magic variable for your app's URL
    
  - key: DATABASE_URL
    value: ${db.DATABASE_URL}  # Reference to attached database
    scope: RUN_TIME
    type: SECRET
```

**Important**: Mark `DATABASE_URL` as `SECRET` type to encrypt it.

#### Frontend Static Site Environment Variables

```yaml
envs:
  - key: VITE_API_URL
    value: "/api"  # Use relative path when frontend and backend share the same domain
    scope: BUILD_TIME
```

**Note**: For separate domains, use full URL: `https://api.tabletalk.app/api`

### 2.6 Health Checks Configuration

Digital Ocean health checks ensure your application is responsive.

**Backend Service Health Check**:

```yaml
health_check:
  http_path: /api/health
  initial_delay_seconds: 30
  period_seconds: 15
  timeout_seconds: 5
  success_threshold: 1
  failure_threshold: 3
```

**Explanation**:
- `initial_delay_seconds: 30` - Wait 30s after deployment before first check
- `period_seconds: 15` - Check every 15 seconds
- `timeout_seconds: 5` - Wait max 5 seconds for response
- `success_threshold: 1` - 1 successful check marks as healthy
- `failure_threshold: 3` - 3 failed checks triggers restart

**Backend Health Endpoint** (already implemented in `backend/index.js`):

```javascript
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});
```

### 2.7 Routing and Ingress Configuration

**Routing Strategy**: Single domain with path-based routing

```yaml
ingress:
  rules:
    # Route /api/* to backend service
    - component:
        name: backend
      match:
        path:
          prefix: /api
    
    # Route everything else to frontend
    - component:
        name: frontend
      match:
        path:
          prefix: /
```

**CORS Configuration** (optional, for enhanced security):

```yaml
ingress:
  rules:
    - component:
        name: frontend
      cors:
        allow_origins:
          - prefix: https://yourdomain.com
        allow_methods:
          - GET
          - POST
          - PATCH
          - OPTIONS
        allow_headers:
          - Content-Type
          - Authorization
      match:
        path:
          prefix: /
```

---

## 3. Deployment Strategy

### 3.1 Pre-Deployment Checklist

- [ ] GitHub repository access configured
- [ ] Digital Ocean account created with billing enabled
- [ ] Domain name purchased (optional but recommended)
- [ ] Environment variables documented
- [ ] Database migration scripts tested locally
- [ ] `.gitignore` excludes `.env`, `node_modules`, `dist`

### 3.2 Deployment Method 1: Using App Spec (Recommended)

#### Step 1: Prepare the Optimized App Spec

Use the `app-spec-optimized.yaml` file (see [Optimized App Spec](#optimized-app-spec) below).

Update the GitHub repository reference:
```yaml
github:
  repo: YOUR_GITHUB_USERNAME/table-talk  # Update this
  branch: main
  deploy_on_push: true
```

#### Step 2: Install Digital Ocean CLI (doctl)

**Windows (PowerShell)**:
```powershell
# Download from GitHub releases
Invoke-WebRequest -Uri "https://github.com/digitalocean/doctl/releases/latest/download/doctl-windows-amd64.zip" -OutFile "doctl.zip"
Expand-Archive -Path "doctl.zip" -DestinationPath "C:\Program Files\doctl"
# Add to PATH
```

**macOS/Linux**:
```bash
# macOS (Homebrew)
brew install doctl

# Linux (snap)
snap install doctl
```

**Authenticate**:
```bash
doctl auth init
# Follow prompts to enter your API token from cloud.digitalocean.com/account/api/tokens
```

#### Step 3: Create the App

```bash
doctl apps create --spec app-spec-optimized.yaml
```

**Expected Output**:
```
Notice: App created
ID                      Name         Default Ingress    Active Deployment ID    In Progress Deployment ID    Created At           Updated At
<app-id>                Table-Talk   <subdomain>        <deployment-id>         <deployment-id>              2026-02-03 23:00:00  2026-02-03 23:00:00
```

#### Step 4: Monitor Deployment

```bash
# Get app ID from previous step
doctl apps list

# Watch deployment progress
doctl apps get <app-id>

# View logs
doctl apps logs <app-id> --type BUILD
doctl apps logs <app-id> --type RUN
```

### 3.3 Deployment Method 2: Using Digital Ocean Control Panel

#### Step 1: Create App

1. Navigate to [cloud.digitalocean.com/apps](https://cloud.digitalocean.com/apps)
2. Click **"Create App"**
3. Choose **"GitHub"** as source
4. Authorize Digital Ocean to access your repository
5. Select the `table-talk` repository
6. Choose branch: `main`

#### Step 2: Configure Backend Service

1. **Name**: `backend`
2. **Source Directory**: `/backend`
3. **Build Command**: `npm ci`
4. **Run Command**: `npm start`
5. **HTTP Port**: `8080`
6. **Environment Variables**:
   - Add `NODE_ENV=production`
   - Add `LOG_LEVEL=info`
   - Add `PORT=8080`
   - Add `FRONTEND_URL=${APP_URL}`
   - Add `DATABASE_URL` (see database step below)

7. **Health Check**:
   - Path: `/api/health`
   - Initial Delay: `30` seconds
   - Period: `15` seconds

8. **Routes**: `/api`

#### Step 3: Configure Frontend Static Site

1. **Name**: `frontend`
2. **Source Directory**: `/frontend`
3. **Build Command**: `npm install && npm run build`
4. **Output Directory**: `dist`
5. **Environment Variables**:
   - Add `VITE_API_URL=/api`
6. **Routes**: `/`

#### Step 4: Add Database

1. In the app creation wizard, click **"Add Database"**
2. Choose **"Dev Database"** for testing or **"Managed Database"** for production
3. **Engine**: PostgreSQL
4. **Version**: 16
5. **Name**: `table-talk-db`

For **Managed Database**:
- Select plan (Basic $15/month or higher)
- Choose datacenter region (match your app region)
- Enable **Trusted Sources** (app will be added automatically)

6. The database URL will be automatically injected as `${db.DATABASE_URL}`

#### Step 5: Review and Deploy

1. Review all settings
2. Choose **Region**: NYC, SFO, or closest to your users
3. Click **"Create Resources"**

Deployment typically takes 5-10 minutes.

### 3.4 Database Migration Execution

After the app is deployed, you **must** run database migrations before the app will function correctly.

#### Option 1: Using the Console (Recommended for First Run)

1. In the Digital Ocean Control Panel, navigate to your app
2. Go to the **Backend** component
3. Click **"Console"** tab
4. Run the migration script:

```bash
node scripts/migrate.js
```

**Expected Output**:
```
🔄 Starting database migration...
📜 Running init.sql...
📜 Running 001_phase1_upgrade.sql...
📜 Running 002_restrict_contexts.sql...
📜 Running 003_enable_mature_context.sql...
✅ Schema upgraded.
🌱 Checking seed data...
✅ Seed data inserted.
🚀 Database setup complete!
```

#### Option 2: Using a Run Command Job (Automated)

Add a **Job** component to your `app-spec.yaml`:

```yaml
jobs:
  - name: db-migrate
    kind: PRE_DEPLOY
    github:
      repo: YOUR_USERNAME/table-talk
      branch: main
      deploy_on_push: true
    source_dir: backend
    run_command: node scripts/migrate.js
    envs:
      - key: DATABASE_URL
        value: ${db.DATABASE_URL}
```

This will run migrations automatically before each deployment.

#### Option 3: Using doctl CLI

```bash
# Get your app components
doctl apps list-components <app-id>

# Run command in backend component
doctl apps exec <app-id> --component backend -- node scripts/migrate.js
```

### 3.5 Scaling and Performance Optimizations

#### Vertical Scaling (Increase Resources)

```bash
# Update instance size
doctl apps update <app-id> --spec app-spec-optimized.yaml
```

In the spec, change:
```yaml
instance_size_slug: apps-s-2vcpu-4gb  # Upgrade from 512MB to 4GB
```

#### Horizontal Scaling (Add Instances)

```yaml
instance_count: 3  # Scale to 3 instances for load balancing
```

**Note**: Socket.io requires **sticky sessions** for horizontal scaling. Digital Ocean App Platform handles this automatically.

#### Database Performance

- **Connection Pooling**: Implemented in `backend/db.js` (max 20 connections)
- **Indexes**: Already defined in `init.sql` for `sessions.table_id` and `analytics_events.session_id`
- **Query Optimization**: Use `EXPLAIN ANALYZE` for slow queries

#### Frontend Optimizations

- **Vite Build**: Automatically includes code splitting, tree shaking, and minification
- **CDN**: Digital Ocean serves static sites via global CDN automatically
- **Caching**: Set appropriate cache headers in Vite config if needed

---

## 4. Post-Deployment Checklist

### 4.1 Health Verification

#### Backend Health Check

```bash
curl https://your-app-url.ondigitalocean.app/api/health
```

**Expected Response**:
```json
{"status":"ok"}
```

#### Database Connection Test

```bash
# From backend console
doctl apps exec <app-id> --component backend -- node -e "const db = require('./db'); db.query('SELECT NOW()').then(r => console.log(r.rows[0])).catch(e => console.error(e));"
```

#### Socket.io Connection Test

1. Open your frontend URL in a browser
2. Open browser DevTools > Network > WS (WebSocket)
3. Look for successful Socket.io connection
4. Check for `connect` event in console

### 4.2 Custom Domain Setup

#### Step 1: Add Domain to App

**Via CLI**:
```bash
doctl apps update <app-id> --spec app-spec-with-domain.yaml
```

In spec:
```yaml
domains:
  - domain: tabletalk.app
    type: PRIMARY
    zone: tabletalk.app
```

**Via UI**:
1. Go to App Settings > Domains
2. Click **"Add Domain"**
3. Enter `tabletalk.app`
4. Choose **"You manage your domain"**

#### Step 2: Configure DNS

Add the following DNS records at your domain registrar:

```
Type    Name    Value                               TTL
CNAME   @       your-app.ondigitalocean.app.       3600
CNAME   www     your-app.ondigitalocean.app.       3600
```

**Note**: Some registrars don't allow CNAME on root (@). Use A/ALIAS records if needed.

#### Step 3: Wait for SSL Certificate

Digital Ocean automatically provisions Let's Encrypt SSL certificates. This takes 5-15 minutes.

**Verify SSL**:
```bash
curl -I https://tabletalk.app
```

Look for `HTTP/2 200` and valid SSL.

### 4.3 Monitoring and Alerts

#### Built-in Metrics

Digital Ocean provides metrics for:
- CPU usage
- Memory usage
- Request count and latency
- Bandwidth

**Access**: App Platform > Metrics tab

#### Configure Alerts

Add to `app-spec.yaml`:
```yaml
alerts:
  - rule: DEPLOYMENT_FAILED
  - rule: DOMAIN_FAILED
  - rule: DEPLOYMENT_LIVE
```

**Via UI**:
1. Go to App Settings > Alerts
2. Click **"Add Alert"**
3. Choose:
   - `DEPLOYMENT_FAILED`
   - `DOMAIN_FAILED`
   - `DEPLOYMENT_LIVE`

Alerts are sent via email to your account.

#### Application Logging

**View logs**:
```bash
# Real-time logs
doctl apps logs <app-id> --follow

# Component-specific logs
doctl apps logs <app-id> --component backend --follow
```

**Structured Logging** (recommended for production):

Install:
```bash
npm install pino
```

Update `backend/index.js`:
```javascript
const pino = require('pino');
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

logger.info('Server started on port', PORT);
```

### 4.4 CI/CD with GitHub Integration

#### Automatic Deployments

Already configured if you set `deploy_on_push: true`:

```yaml
github:
  repo: YOUR_USERNAME/table-talk
  branch: main
  deploy_on_push: true
```

**How it works**:
1. Push code to `main` branch
2. Digital Ocean detects the push via webhook
3. Triggers automatic build and deployment
4. Runs health checks
5. Routes traffic to new deployment

#### Branch-Based Deployments

Create preview environments for branches:

```yaml
- name: backend-staging
  github:
    repo: YOUR_USERNAME/table-talk
    branch: staging
    deploy_on_push: true
```

#### Rollback on Failure

Digital Ocean keeps deployment history. To rollback:

**Via UI**:
1. Go to Deployments tab
2. Find last successful deployment
3. Click **"Redeploy"**

**Via CLI**:
```bash
doctl apps list-deployments <app-id>
doctl apps create-deployment <app-id> --deployment-id <previous-deployment-id>
```

---

## 5. Troubleshooting

### 5.1 Common Build Issues

#### Issue: `npm install` fails with dependency conflicts

**Symptom**:
```
npm ERR! ERESOLVE unable to resolve dependency tree
```

**Solution**:
```yaml
build_command: npm ci --legacy-peer-deps
```

Or update `package.json` to use compatible versions.

#### Issue: Vite build fails with memory error

**Symptom**:
```
FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
```

**Solution**:

Increase Node memory in build command:
```yaml
build_command: NODE_OPTIONS='--max-old-space-size=4096' npm install && npm run build
```

Or upgrade to larger build instance.

### 5.2 Database Connection Errors

#### Issue: `ECONNREFUSED` or `connection timeout`

**Symptom**:
```
Error: connect ECONNREFUSED
```

**Solutions**:

1. **Verify DATABASE_URL format**:
```bash
postgresql://username:password@host:port/database?sslmode=require
```

2. **Check Trusted Sources** (for managed databases):
   - Go to Database > Settings > Trusted Sources
   - Ensure your app is listed
   - Add manually if missing

3. **Verify SSL mode**:
```javascript
// backend/db.js
const client = new Client({
  connectionString: DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});
```

#### Issue: Migration script fails

**Symptom**:
```
❌ Error initializing database: relation "questions" already exists
```

**Solution**:

Migrations are idempotent. If you see this, the database is already initialized. Verify by checking:

```sql
-- Connect to database console
doctl databases connection <database-id>

-- Check tables
\dt
```

### 5.3 Socket.io Connection Issues

#### Issue: WebSocket connection fails in production

**Symptom** (Browser console):
```
WebSocket connection to 'wss://...' failed
```

**Solutions**:

1. **Verify backend is running**:
```bash
curl https://your-app.ondigitalocean.app/api/health
```

2. **Check CORS configuration**:
```javascript
// backend/index.js
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "*",
    methods: ["GET", "POST", "PATCH"]
  }
});
```

3. **Ensure frontend connects to correct URL**:
```javascript
// frontend - should use relative path or full URL
const socket = io('/');  // Relative path (recommended)
// OR
const socket = io('https://your-app.ondigitalocean.app');
```

#### Issue: Socket.io works in single instance but breaks with horizontal scaling

**Symptom**: Connections drop when requests hit different instances.

**Solution**:

Digital Ocean App Platform uses sticky sessions by default, but you may need Redis adapter for multi-instance Socket.io:

```bash
npm install @socket.io/redis-adapter redis
```

```javascript
const { createAdapter } = require("@socket.io/redis-adapter");
const { createClient } = require("redis");

const pubClient = createClient({ url: process.env.REDIS_URL });
const subClient = pubClient.duplicate();

io.adapter(createAdapter(pubClient, subClient));
```

Add Redis database to your app spec.

### 5.4 Frontend Routing Issues

#### Issue: Page refresh returns 404 on client-side routes

**Symptom**: `https://yourapp.com/session/123` works initially, but returns 404 on refresh.

**Solution**:

Digital Ocean static sites need a catchall route for SPAs. This should work by default, but if not, add:

```yaml
static_sites:
  - name: frontend
    catchall_document: index.html  # Fallback for SPA routing
```

### 5.5 Performance Issues

#### Issue: High response times (> 1 second)

**Diagnostic**:
```bash
# Check instance metrics
doctl apps get <app-id>

# View resource usage
# Go to App Platform > Metrics in UI
```

**Solutions**:

1. **Upgrade instance size**:
```yaml
instance_size_slug: apps-s-2vcpu-4gb
```

2. **Add more instances** (horizontal scaling):
```yaml
instance_count: 2
```

3. **Optimize database queries**:
   - Add indexes for frequently queried fields
   - Use connection pooling (already implemented)
   - Check for N+1 query problems

4. **Enable caching**:
   - Add Redis for session caching
   - Use HTTP caching headers for static assets

---

## Optimized App Spec

See the file `app-spec-optimized.yaml` in the repository root for a production-ready configuration with:

- Security best practices (no hardcoded credentials)
- Database component (dev or managed)
- Health checks and alerts
- Optimized build settings
- Proper environment variable management

---

## Additional Resources

- [Digital Ocean App Platform Documentation](https://docs.digitalocean.com/products/app-platform/)
- [App Spec Reference](https://docs.digitalocean.com/products/app-platform/reference/app-spec/)
- [doctl CLI Reference](https://docs.digitalocean.com/reference/doctl/)
- [Socket.io Documentation](https://socket.io/docs/v4/)
- [Node.js Best Practices](https://github.com/goldbergyoni/nodebestpractices)

---

## Support

For issues specific to Table-Talk deployment:
1. Check this guide's troubleshooting section
2. Review Digital Ocean App Platform logs
3. Consult the [Support Guidelines](SUPPORT.md)

For Digital Ocean platform issues:
- [Support Portal](https://cloud.digitalocean.com/support)
- [Community Q&A](https://www.digitalocean.com/community)
