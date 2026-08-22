---
title: Mira — Spending Tracker
description: A local-first spending tracker PWA with a custom sync engine, built with Vue 3 / Quasar on the front and FastAPI + PostgreSQL on the back.
image: /projects/mira/hero.webp
lang: en
order: 1
tags: ['Full-stack', 'Vue 3', 'TypeScript', 'FastAPI', 'PostgreSQL', 'PWA']
---

Mira is a mobile-first spending tracker I designed, built, and deployed end-to-end. It's **local-first**: every interaction works instantly against IndexedDB on the device — even fully offline — and a custom sync engine reconciles changes with the server when you're back online.

<p class="project-cta-row">
  <a class="project-cta" href="https://mira-spending-tracker.vercel.app/" target="_blank" rel="noopener noreferrer">Try Mira live&nbsp;↗</a>
</p>

It's a PWA, so you can install it as an app straight from the browser — add it to your home screen on mobile or install it from the address bar on desktop.

<video class="project-video" autoplay loop muted playsinline poster="/projects/mira/home.webp">
  <source src="/projects/mira/mira-tour.mp4" type="video/mp4" />
</video>

## Features

- **Month overview** — income, expenses, and leftover at a glance with a category donut chart
- **Fast input** — log an expense in seconds, with categories and subcategories
- **Multi-currency** — 19 supported currencies; every transaction keeps its own currency, and monthly summaries are broken down per currency instead of being lossily converted
- **Recurring transactions** — rent, salary, subscriptions generated from recurrence rules (stop / resume / delete a series)
- **Reports** — income vs. expenses and top categories over 3M / 6M / 1Y / 2Y / YTD ranges
- **Custom categories** — icons, subcategories, and drag-and-drop reordering
- **Installable PWA** — offline-capable service worker, home-screen install, dark & light themes, English / Japanese UI

## How it works

The frontend is **Vue 3 + Quasar (TypeScript)** with Pinia for state and Chart.js for visualizations. All reads and writes go to **IndexedDB (Dexie)** first, so the UI never waits on the network.

The backend is **FastAPI + PostgreSQL**, packaged with Docker and deployed to Oracle Cloud with a GitHub Actions pipeline. A delta **sync protocol** pushes unsynced local changes (including soft-delete tombstones) and pulls remote changes with a sync token, surfacing conflicts in a review dialog.

An account is **optional**: everything works without signing up, since all data lives on the device. Creating an account (email + password) is only needed to back up your data and sync it across devices.

## Screenshots

<div class="project-shots">
  <figure><img src="/projects/mira/home.webp" alt="Home — monthly overview with donut chart" loading="lazy" /><figcaption>Home</figcaption></figure>
  <figure><img src="/projects/mira/report.webp" alt="Report — income vs expenses over 6 months" loading="lazy" /><figcaption>Reports</figcaption></figure>
  <figure><img src="/projects/mira/transactions.webp" alt="Transactions list with search and monthly summary" loading="lazy" /><figcaption>Transactions</figcaption></figure>
  <figure><img src="/projects/mira/recurring.webp" alt="Recurring transactions management" loading="lazy" /><figcaption>Recurring</figcaption></figure>
  <figure><img src="/projects/mira/categories.webp" alt="Category management with drag-and-drop" loading="lazy" /><figcaption>Categories</figcaption></figure>
  <figure><img src="/projects/mira/input.webp" alt="Expense input form" loading="lazy" /><figcaption>Input</figcaption></figure>
</div>

*Screenshots show demo data.*

<details class="dev-notes">
<summary>Under the hood — technical notes for developers</summary>

### Local-first data layer

- Four Dexie (IndexedDB) tables — `categories`, `subcategories`, `series`, `expenses` — are the single source of truth for the UI; no read or write ever waits on the network.
- Every row carries a client-generated ID, an `updated_at` timestamp, a soft-delete tombstone (`is_deleted`), and sync bookkeeping flags (`is_synced`, `is_new`).
- Deletes are tombstoned rather than removed, so they replicate to other devices instead of silently resurrecting.

### Sync engine

- Delta sync against the FastAPI backend: push all unsynced rows (tombstones included), then pull remote changes incrementally using a sync token — no full-table transfers.
- The server acknowledges pushed rows, which flips `is_synced` locally; `is_new` lets the sync-result dialog distinguish "added" from "modified".
- Conflicts — for example a row referencing a parent the server never received — are surfaced in a review dialog instead of failing silently.

### Auth

- Email + password signup / login; passwords are hashed server-side with **Argon2** (via `pwdlib`), never stored in plain text.
- **JWT pair**: a short-lived access token (15 min) authenticates API requests, and a long-lived refresh token silently obtains new access tokens — so users stay signed in without re-entering credentials.
- The access token lives in `sessionStorage`, the refresh token in `localStorage`; an axios interceptor attaches the Bearer header and, on a 401, performs a **single-flight refresh** (concurrent failed requests queue up and retry with the new token instead of each refreshing separately). If the refresh itself fails, tokens are cleared and the user is signed out.
- Auth only gates the sync API — the app itself never locks you out of your local data.

### Recurring transactions

- A `series` row stores the recurrence rule (interval, unit, start / end date); occurrences are materialized as ordinary expense rows linked back via `series_local_id`.
- Because occurrences are plain rows, they show up in every report, filter, and sync path with zero special-casing; stopping a series just truncates its future occurrences.

### Multi-currency model

- The currency (one of 19 supported) is stored per transaction, not globally — so a trip abroad can be logged in the local currency alongside home-currency expenses.
- Summaries group by currency rather than converting at some arbitrary exchange rate, keeping every displayed number exact.

### PWA

- Workbox service worker with precaching plus runtime caching strategies; a custom install banner and full icon set (maskable Android icons, iOS home-screen icons, splash screens).
- Dev / prod split: development runs as a plain SPA (no service worker interfering with hot reload), while the release build ships the full PWA.

### Stack & deployment

- **Frontend:** Vue 3 + TypeScript, Quasar, Pinia, Tailwind, Chart.js, vue-i18n (English / Japanese) — deployed to Vercel.
- **Backend:** FastAPI + PostgreSQL, containerized with Docker, running on Oracle Cloud, auto-deployed by GitHub Actions; sync endpoints covered by pytest.

</details>
