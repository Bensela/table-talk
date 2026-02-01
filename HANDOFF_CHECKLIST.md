# Client Handoff Checklist

This document tracks the deliverables and tasks required for the successful handoff of the Table-Talk MVP.

## 1. Application Deployment
- [ ] **Backend**: Deployed to DigitalOcean App Platform (or verified locally).
- [ ] **Frontend**: Deployed to DigitalOcean App Platform (or verified locally).
- [ ] **Database**: Managed PostgreSQL instance configured and connected.
- [ ] **Domain**: `tabletalk.app` configured (DNS pointing to DigitalOcean).
- [ ] **SSL**: HTTPS enabled and verified.

## 2. Documentation
- [x] **README.md**: Overview, setup, and architecture.
- [x] **DEPLOYMENT.md**: Step-by-step production deployment guide.
- [x] **API.md**: Complete API endpoint reference.
- [x] **SUPPORT.md**: Guidelines for post-launch support.

## 3. Configuration & Secrets
- [x] **Environment Variables**: `.env.production.example` provided.
- [x] **App Spec**: `app-spec.yaml` created for infrastructure-as-code.
- [ ] **Credentials**: Transfer DigitalOcean and GitHub account ownership.

## 4. Data & Content
- [x] **Database Migrations**: Schema applied.
- [x] **Seed Data**: Initial questions loaded (Exploring, Established, Mature).
- [x] **QR Codes**: Generated for 10 tables (`backend/qrcodes/`).

## 5. Client Training
- [ ] **Walkthrough**: Demo of the user flow (Single & Dual Mode).
- [ ] **Admin Tasks**: How to generate new QR codes.
- [ ] **Support**: Review the 30-day/10-hour support policy.

## 6. Final Sign-off
- [ ] **Testing**: Client verifies critical flows on their device.
- [ ] **Acceptance**: Project accepted as complete.
- [ ] **Payment**: Final invoice processed.
