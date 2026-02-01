# Deployment Guide

This guide outlines the steps to deploy Table-Talk to the DigitalOcean App Platform.

## Prerequisites

- DigitalOcean account with billing enabled
- GitHub repository access (`easymssolutions/table-talk`)
- Domain name (e.g., `tabletalk.app`) - Optional but recommended

## Deployment via App Spec (Recommended)

The repository includes an `app-spec.yaml` file that defines the entire infrastructure.

1.  **Install `doctl`** (DigitalOcean CLI) or use the Control Panel.
2.  **Create App**:
    *   **CLI**: `doctl apps create --spec app-spec.yaml`
    *   **UI**: Go to Apps -> Create App -> Upload `app-spec.yaml`.

3.  **Review Configuration**:
    *   Ensure the `github` repo details match your fork.
    *   Check `envs` values.

## Manual Deployment Steps

If you prefer to configure manually via the UI:

### 1. Database
*   Create a **Managed PostgreSQL** database (Version 14+).
*   Note the connection string.
*   Enable "Trusted Sources" and add the App Platform once created.

### 2. Backend Service
*   **Source**: GitHub (`backend` directory).
*   **Build Command**: `npm install`
*   **Run Command**: `npm start`
*   **HTTP Port**: `8080`
*   **Environment Variables**:
    *   `DATABASE_URL`: `${db.DATABASE_URL}` (Magic variable if attached) or connection string.
    *   `NODE_ENV`: `production`
    *   `FRONTEND_URL`: URL of the frontend app (e.g., `https://tabletalk.app`).

### 3. Frontend Static Site
*   **Source**: GitHub (`frontend` directory).
*   **Build Command**: `npm install && npm run build`
*   **Output Directory**: `dist`
*   **Environment Variables**:
    *   `VITE_API_URL`: URL of the backend app (e.g., `https://api.tabletalk.app/api`).

## Post-Deployment Setup

1.  **Database Migration & Seeding**:
    *   Access the backend console via DigitalOcean UI.
    *   Run: `node scripts/migrate.js`
    *   Run: `node scripts/seed.js`

2.  **Domain Configuration**:
    *   Go to App Settings -> Domains.
    *   Add `tabletalk.app` (Frontend).
    *   Add `api.tabletalk.app` (Backend) - *Optional, or route /api via frontend proxy rules*.

## Troubleshooting

*   **Build Fails**: Check `npm install` logs. Ensure `package.json` dependencies are correct.
*   **Database Connection Error**: Verify `DATABASE_URL` and Trusted Sources.
*   **CORS Errors**: Ensure `FRONTEND_URL` in backend env matches the actual frontend domain.

## Rollback

DigitalOcean keeps a history of deployments.
1.  Go to App -> Deployments.
2.  Find the last successful build.
3.  Click "Re-deploy".
