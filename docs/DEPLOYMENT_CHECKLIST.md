# Digital Ocean Deployment Checklist

Quick reference for deploying and maintaining Table-Talk on Digital Ocean App Platform.

---

## 📋 Pre-Deployment

- [ ] **GitHub repository** is accessible and up to date
- [ ] **Digital Ocean account** created with billing enabled
- [ ] **API token** generated (for CLI access)
- [ ] **doctl CLI** installed and authenticated
- [ ] **Environment variables** documented and ready
- [ ] **Database migrations** tested locally
- [ ] **.gitignore** excludes `.env`, `node_modules`, `dist`
- [ ] **Domain name** ready (optional but recommended)

---

## 🚀 Initial Deployment

### Method 1: Using App Spec (Recommended)

- [ ] Update `app-spec-optimized.yaml` with your GitHub repo
  ```yaml
  github:
    repo: YOUR_USERNAME/table-talk
  ```
- [ ] Create app via CLI:
  ```bash
  doctl apps create --spec app-spec-optimized.yaml
  ```
- [ ] OR upload spec via [Digital Ocean Control Panel](https://cloud.digitalocean.com/apps)

### Method 2: Using Control Panel

- [ ] Navigate to [Apps](https://cloud.digitalocean.com/apps)
- [ ] Click **Create App** > **GitHub**
- [ ] Authorize and select `table-talk` repository
- [ ] Configure **Backend Service**:
  - Source dir: `backend`
  - Build: `npm ci`
  - Run: `npm start`
  - Port: `8080`
  - Route: `/api`
- [ ] Configure **Frontend Static Site**:
  - Source dir: `frontend`
  - Build: `npm install && npm run build`
  - Output: `dist`
  - Route: `/`
- [ ] Add **PostgreSQL Database** (dev or managed)
- [ ] Review and deploy

---

## 🗄️ Database Setup

- [ ] Wait for initial deployment to complete
- [ ] Access **Backend Console** in Digital Ocean UI
- [ ] Run migrations:
  ```bash
  node scripts/migrate.js
  ```
- [ ] Verify success (should see "Database setup complete!")
- [ ] Alternative: Use PRE_DEPLOY job (see `app-spec-optimized.yaml`)

---

## ✅ Post-Deployment Validation

### Health Checks

- [ ] Backend health endpoint:
  ```bash
  curl https://your-app.ondigitalocean.app/api/health
  # Should return: {"status":"ok"}
  ```

- [ ] Frontend loads successfully in browser

- [ ] WebSocket connection successful:
  - Open DevTools > Network > WS
  - Look for Socket.io connection

### Functionality Tests

- [ ] Scan QR code (generate via backend console if needed)
- [ ] Create session (single or dual mode)
- [ ] Questions load correctly
- [ ] Dual-phone sync works (if applicable)
- [ ] Analytics events logged

---

## 🌐 Custom Domain (Optional)

- [ ] Add domain in App Platform UI:
  - Go to **Settings > Domains**
  - Click **Add Domain**
  - Enter your domain (e.g., `tabletalk.app`)

- [ ] Configure DNS at your registrar:
  ```
  Type    Name    Value                               TTL
  CNAME   @       your-app.ondigitalocean.app.       3600
  CNAME   www     your-app.ondigitalocean.app.       3600
  ```

- [ ] Wait for SSL certificate (5-15 minutes)

- [ ] Verify HTTPS works:
  ```bash
  curl -I https://tabletalk.app
  ```

---

## 📊 Monitoring & Alerts

- [ ] Configure deployment alerts (already in optimized spec):
  - `DEPLOYMENT_FAILED`
  - `DOMAIN_FAILED`
  - `DEPLOYMENT_LIVE`

- [ ] Review metrics in App Platform dashboard:
  - CPU usage
  - Memory usage
  - Request latency
  - Bandwidth

- [ ] Set up log monitoring:
  ```bash
  doctl apps logs <app-id> --follow
  ```

---

## 🔄 CI/CD Verification

- [ ] Push a small change to `main` branch
- [ ] Verify automatic deployment triggers
- [ ] Monitor deployment progress in UI or CLI
- [ ] Verify health checks pass
- [ ] Test that changes are live

---

## 🔧 Environment Variables Checklist

### Backend Service

- [ ] `NODE_ENV=production`
- [ ] `PORT=8080`
- [ ] `LOG_LEVEL=info`
- [ ] `FRONTEND_URL=${APP_URL}`
- [ ] `DATABASE_URL=${db.DATABASE_URL}` (marked as SECRET)

### Frontend Static Site

- [ ] `VITE_API_URL=/api`

---

## 🚨 Troubleshooting Quick Checks

### Build Fails

- [ ] Check build logs: `doctl apps logs <app-id> --type BUILD`
- [ ] Verify Node.js version in `package.json` engines
- [ ] Check for dependency conflicts in `package-lock.json`

### Database Connection Fails

- [ ] Verify `DATABASE_URL` format includes `?sslmode=require`
- [ ] Check **Trusted Sources** in database settings
- [ ] Confirm database is in same region as app

### Socket.io Not Connecting

- [ ] Verify backend is running: `curl /api/health`
- [ ] Check CORS settings include `FRONTEND_URL`
- [ ] Ensure frontend uses correct WebSocket URL

### 404 on Frontend Routes

- [ ] Verify `catchall_document: index.html` in static site config
- [ ] Check build output includes `index.html` in `dist/`

---

## 📈 Scaling Checklist (When Traffic Increases)

### Vertical Scaling

- [ ] Upgrade instance size in app spec:
  ```yaml
  instance_size_slug: apps-s-2vcpu-4gb
  ```
- [ ] Redeploy with updated spec

### Horizontal Scaling

- [ ] Increase instance count:
  ```yaml
  instance_count: 2  # or 3
  ```
- [ ] Verify sticky sessions work (auto-enabled)
- [ ] Consider Redis adapter for Socket.io if issues

### Database Scaling

- [ ] Upgrade from dev to managed database
- [ ] Choose appropriate plan (Basic, Professional, etc.)
- [ ] Enable automated backups
- [ ] Add standby node for high availability

---

## 🔄 Rollback Procedure

If deployment introduces issues:

1. **Via UI**:
   - [ ] Go to **Deployments** tab
   - [ ] Find last successful deployment
   - [ ] Click **Redeploy**

2. **Via CLI**:
   ```bash
   doctl apps list-deployments <app-id>
   doctl apps create-deployment <app-id> --deployment-id <prev-id>
   ```

3. **Revert code**:
   ```bash
   git revert <commit-sha>
   git push origin main
   ```

---

## 🛡️ Security Checklist

- [ ] All secrets marked as `type: SECRET` in app spec
- [ ] No hardcoded credentials in code or config files
- [ ] Database has trusted sources enabled
- [ ] SSL/HTTPS enabled on custom domains
- [ ] CORS configured to only allow your frontend domain
- [ ] `.env` files excluded from git

---

## 📚 Quick Reference

**App Platform Dashboard**: https://cloud.digitalocean.com/apps

**View Logs**:
```bash
doctl apps logs <app-id> --follow
```

**Get App Info**:
```bash
doctl apps get <app-id>
```

**Update App**:
```bash
doctl apps update <app-id> --spec app-spec-optimized.yaml
```

**Run Command in Console**:
```bash
doctl apps exec <app-id> --component backend -- <command>
```

**List Deployments**:
```bash
doctl apps list-deployments <app-id>
```

---

## 📞 Support Resources

- [Deployment Guide](DIGITALOCEAN_DEPLOYMENT_GUIDE.md) - Full documentation
- [Digital Ocean Docs](https://docs.digitalocean.com/products/app-platform/)
- [App Spec Reference](https://docs.digitalocean.com/products/app-platform/reference/app-spec/)
- [Support Portal](https://cloud.digitalocean.com/support)
