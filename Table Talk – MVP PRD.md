Table Talk MVP

TRAE.AI Execution PRD (Vibe Coder Edition)

Purpose of This Document

This PRD is written for AI-assisted, rapid, high-signal development using TRAE.AI.
It prioritizes:

Clear intent over narrative

Deterministic behavior

Minimal ambiguity

Server-authoritative logic

Mobile-first delivery

This document is the single source of truth for build execution.

1. Product Intent (High-Level)

Table Talk is a QR-initiated, anonymous, mobile-first web app that facilitates structured, synchronized conversation using question decks at a physical table.

No accounts.
No PII.
No persistence beyond session logic and anonymous analytics.

2. Core User Flow (Golden Path)

User scans QR code

Backend creates anonymous session

User selects interaction mode:

Single-Phone

Dual-Phone

Question deck begins

Users reveal and advance questions

Session ends naturally or expires

This flow must work flawlessly before any polish.

3. Non-Negotiable Constraints (Read First)

No PII, ever

No authentication

No user profiles

No architecture decisions outside Platform Standard

All state is server-authoritative

Mobile-first, phone-only UX

Latency under 300ms for all actions

If a decision violates any of the above, it is incorrect.

4. Functional Requirements (Execution-Level)
4.1 Session Creation

QR scan triggers session creation

Backend generates anonymous session_id

Session state stored server-side

Rules

No cookies tied to identity

Session usable immediately

4.2 Mode Selection

Modes:

single_phone

dual_phone

Rules

Mode locked after selection

Dual-Phone requires second device join

Mode determines sync behavior

4.3 Question Engine

Load question deck from seed

Questions served sequentially

Reveal precedes “Next”

Rules

No skipping

No repeats per table per day

Server validates all state transitions

4.4 Dual-Phone Sync (Critical)

Both devices share same session state

Actions propagate in real time

Conflict Rule

Server-authoritative

First valid action wins

Duplicate actions are idempotent

4.5 Reconnect Handling

Device reconnect restores:

Current question

Reveal state

Mode

Defined Limits

Idle timeout: 30 minutes

Max session lifespan: 24 hours

4.6 Daily Deck Logic

Same table cannot see same question twice in one day

Reset occurs at server-local midnight

4.7 Anonymous Analytics

Log events only, no identity.

Minimum Events

session_started

mode_selected

question_advanced

session_completed

reconnect_occurred

Rules

No IP storage

No device fingerprinting

5. UX Requirements (Vibe Coder Friendly)

One primary action per screen

Thumb-friendly buttons

No dense text

Minimal transitions

Clear visual state for:

Waiting

Revealed

Synced

Disconnected

If UX competes with functionality, functionality wins.

6. Data Model (Conceptual, Not Prescriptive)

Entities:

Session

Question

DailyDeck

AnalyticsEvent

Relationships:

Session → many Questions

Session → many AnalyticsEvents

Retention:

Short-lived

Anonymous

Disposable

7. Technical Guardrails

Hosting: DigitalOcean App Platform

DB: DigitalOcean Managed PostgreSQL

Realtime: As defined in Platform Standard

Repo: Client-owned GitHub

Commits: Weekly minimum

No experimental stacks.
No unapproved services.

8. Performance Targets

<300ms interaction latency

Sync updates feel instantaneous

Reconnect restores state within 1 second

Performance regressions block acceptance.

9. Milestone Execution Order (TRAE-Friendly)
Phase 1: Core Loop First

Session creation

Mode selection

Single-Phone question loop

Phase 2: Sync Layer

Dual-Phone real-time sync

Conflict resolution

Reconnect logic

Phase 3: Constraints

Daily deck logic

Analytics

Privacy validation

Phase 4: Polish and Deploy

Mobile UX cleanup

QA

Production deploy

README

10. Acceptance Conditions (Binary)

The MVP is accepted if and only if:

Both modes work

Dual-Phone stays in sync

Reconnect works

No repeats per day

Analytics logs exist

No PII stored

Latency target met

Mobile UI is clean

Partial compliance is non-acceptance.

11. Explicit Out-of-Scope (Do Not Build)

Accounts

Logins

Payments

Admin dashboards

Custom theming

Localization

Notifications

12. How TRAE.AI Should Be Used

Generate code only to satisfy requirements above

Prefer simple, readable implementations

Avoid speculative features

Validate against acceptance checklist after each phase