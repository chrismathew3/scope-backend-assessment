# Theater Showtimes Backend Assessment

This repository contains a frontend-only Next.js application with static JSON data. The backend logic has been intentionally removed so candidates can implement it as part of the assessment. The UI is wired to mock data and stubbed actions to illustrate the expected behaviors.

## Quick Start

1. Install dependencies

```bash
npm install
```

2. Create a `.env` file

```bash
cp .env.example .env
```

3. Add your database connection string

- `DATABASE_URL`

4. Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## FastAPI Scaffold

A minimal FastAPI app lives in `backend/app/main.py`.

Run it locally:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Then visit `http://localhost:8000/health`.

## What’s in the Frontend

- Static data lives in `src/data/assessment-data.ts`.
- Users are mocked client-side with a selector in the UI (admin vs non-admin).
- CSV upload, preview, and schedule mutation buttons are intentionally mocked.

## Backend Requirements (Implement These)

Build the backend for a website to ingest a partner CSV and reconcile it against the current schedule for a single theater that currently has hard coded JSON data.

The backend must support:

- Admin and non-admin views
  - Admin has full read/write access
  - Non-admin has read access to limited data
  - All users belong to some, none, or all theaters
  - Users can only see movies for theaters they belong to
  - Admin can update a movie status field that non-admins cannot update
- A database schema based on the given hardcoded JSON data
- Search at scale (hundreds of thousands of movies)
  - Search by movie name
  - Reasonable filters for other columns
  - Sort by reasonable columns
- CSV data cleaning on upload
  - At most one active showtime per unique movie + start time per theater
  - Minor differences (title spelling, auditorium rename) should update the same showtime
  - Missing showtimes in a new drop should be archived
  - Schedule must be persisted in the database

## Notes

- The frontend currently shows a callout indicating mock behavior. Replace mock logic with real API calls once the backend is implemented.
