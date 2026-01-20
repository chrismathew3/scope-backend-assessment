# Theater Showtimes Manager

A full-stack admin web application for managing theater showtimes with CSV ingestion, intelligent reconciliation, and preview capabilities.

## 🎯 Overview

This application enables theater administrators to:
- Upload partner CSV files with showtime data
- Preview changes before applying (adds, updates, archives)
- View field-level diffs for updated showtimes
- Filter and sort the current schedule
- Handle messy data (inconsistent casing, whitespace, duplicates, spelling variations)

## 🚀 Quick Start

### Prerequisites

- Node.js 20+ 
- PostgreSQL database (or Supabase account)

### Installation

1. **Clone the repository**
```bash
git clone <your-repo-url>
cd scope-movie-assessment
```

2. **Install dependencies**
```bash
npm install
```

3. **Set up environment variables**

Create a `.env` file in the root directory:

```env
# Database (use your Supabase or PostgreSQL connection string)
DATABASE_URL="postgresql://user:password@host:port/database?pgbouncer=true&connection_limit=1"

# NextAuth Secret (generate with: openssl rand -base64 32)
NEXTAUTH_SECRET="your-generated-secret-here"
```

4. **Initialize the database**
```bash
npx prisma generate
npx prisma db push
```

5. **Run the development server**
```bash
npm run dev
```

6. **Open the app**

Navigate to [http://localhost:3000](http://localhost:3000)

## 🧪 Testing the Application

### Step 1: Create an Account

1. Go to [http://localhost:3000/signup](http://localhost:3000/signup)
2. Sign up with an email ending in `@scopelabs.com` (only allowed domain)
3. Example: `admin@scopelabs.com` / `password123`

### Step 2: Test CSV Ingestion & Reconciliation

The application comes with two sample CSV files in the `sample-data/` folder:

- **`existing.csv`** - Initial showtime schedule
- **`new-drop.csv`** - Updated schedule with messy data (different casing, whitespace, duplicates)

#### Test Scenario:

1. **Upload the "existing" dataset**
   - Click "Upload CSV"
   - Select `sample-data/existing.csv`
   - Click "Confirm Changes" to load the initial 6 showtimes

2. **Upload the "new drop" dataset**
   - Click "Upload CSV" again
   - Select `sample-data/new-drop.csv`
   - Review the preview screen

#### Expected Preview Results:

**✅ 1 New Showtime**
- Kung Fu Panda 4 — Mar 15, 11:30 AM (deduplicated from 2 identical rows in CSV)

**✅ 4 Updated Showtimes**
- **Spider‑Man: Homecoming** 
  - Auditorium: `Auditorium 1` → `Aud 1`
  - Title normalized from `"  Spider Man - Homecoming  "` (with extra spaces/hyphens)
  - Last Updated timestamp changed

- **Inside Out 2**
  - Auditorium: `Auditorium 2` → `Auditorium Two`
  - Title normalized from `"Inside   Out  2"` (extra spaces)
  - Last Updated timestamp changed

- **Dune: Part Two** (1:00 PM showing)
  - Format: `2D` → `IMAX`
  - Auditorium: `Auditorium 1` → `Auditorium 1 (Laser)`
  - Title matched from `"DUNE PART 2"` (different casing/punctuation)
  - Last Updated timestamp changed

- **Dune: Part Two** (3:45 PM showing)
  - Title normalized from `"Dune: Part Two  "` (trailing spaces)
  - Last Updated timestamp changed

**✅ 2 Archived Showtimes**
- Wonka — not present in new drop
- Oppenheimer — not present in new drop

3. **Confirm the changes**
   - Click "Confirm Changes"
   - Table should now show 5 active + 2 archived showtimes

4. **Test filtering and sorting**
   - Filter by Status: Active / Archived / All
   - Filter by Format: IMAX, 2D, 3D
   - Sort by: Movie Title, Start Time, Format, etc.
   - Search by movie title in the search box

5. **Test Clear Schedule**
   - Click "Clear Schedule" button
   - All showtimes should be removed
   - Re-upload CSVs to restore data

## 🏗️ Architecture & Design Decisions

### Technology Stack

- **Framework**: Next.js 15.5 (App Router with Turbopack)
- **Language**: TypeScript
- **Database**: PostgreSQL (via Supabase)
- **ORM**: Prisma
- **API**: tRPC for type-safe client-server communication
- **Auth**: NextAuth.js with JWT sessions
- **Styling**: Tailwind CSS

### Key Design Decisions

#### 1. **Normalization Strategy**

Movie titles are normalized using a robust algorithm in `src/lib/normalize.ts`:

```typescript
normalizeTitle("Spider‑Man: Homecoming") 
  === normalizeTitle("  Spider Man - Homecoming  ")
  === "spider man homecoming"
```

- Converts to lowercase
- Removes all punctuation (replacing with spaces)
- Normalizes "Part Two" → "part 2", "Part Three" → "part 3"
- Trims whitespace

#### 2. **Unique Constraint**

The database enforces uniqueness on `(normalizedTitle, startTime)`:
- Prevents duplicate showtimes for the same movie at the same time
- Enables intelligent matching during CSV reconciliation

#### 3. **Reconciliation Logic**

The system uses a three-way diff algorithm:
1. **Match**: Showtimes with identical `(normalizedTitle, startTime)`
2. **Add**: Showtimes in new CSV but not in database
3. **Update**: Matched showtimes with different fields
4. **Archive**: Showtimes in database but not in new CSV

**Important**: When updating, the original `movieTitle` is preserved for consistency (not overwritten with raw CSV data).

#### 4. **Preview Before Apply**

All changes are calculated client-side before committing to the database, allowing users to review and understand the impact.

#### 5. **Database Connection**

Uses PgBouncer transaction mode (`?pgbouncer=true`) to avoid prepared statement conflicts with Supabase in development.

## 📁 Project Structure

```
scope-movie-assessment/
├── src/
│   ├── app/                    # Next.js App Router pages
│   │   ├── page.tsx           # Main showtime table
│   │   ├── login/             # Login page
│   │   ├── signup/            # Signup page
│   │   └── api/               # API routes
│   ├── server/
│   │   ├── api/
│   │   │   └── routers/
│   │   │       └── showtime.ts # Showtime tRPC router
│   │   ├── auth.ts            # NextAuth configuration
│   │   └── db.ts              # Prisma client
│   ├── lib/
│   │   ├── normalize.ts       # Title normalization logic
│   │   ├── csv-parser.ts      # CSV parsing & deduplication
│   │   └── email-validation.ts
│   └── components/            # React components
├── prisma/
│   └── schema.prisma          # Database schema
├── sample-data/
│   ├── existing.csv           # Initial dataset
│   └── new-drop.csv          # Updated dataset (messy)
└── README.md
```

## 🔐 Authentication

- Email restriction: Only `@scopelabs.com` emails allowed
- Passwords hashed with bcryptjs
- JWT-based sessions via NextAuth.js

## 🛠️ Available Scripts

```bash
# Development server
npm run dev

# Production build
npm run build

# Start production server
npm start

# Database commands
npx prisma generate      # Generate Prisma Client
npx prisma db push       # Push schema to database
npx prisma studio        # Open database GUI

# Code quality
npm run lint             # Run ESLint
npm run typecheck        # Run TypeScript compiler check
```

## 🐛 Troubleshooting

### "Prepared statement already exists" error

This is a known development issue with Prisma + Supabase + hot reload. Solutions:

1. Add `?pgbouncer=true&connection_limit=1` to your `DATABASE_URL`
2. Or simply refresh the page - the error typically resolves after one retry

### Database connection issues

- Ensure your `DATABASE_URL` uses `postgresql://` protocol (not `postgres://`)
- Check that your database is accessible and credentials are correct
- For Supabase, use the "Transaction" pooler connection string (port 6543)

### Authentication issues

- Ensure `NEXTAUTH_SECRET` is set in `.env`
- Clear browser cookies if experiencing session issues

## 📊 Database Schema

```prisma
model Showtime {
  id              String   @id @default(cuid())
  theaterName     String
  movieTitle      String          // Original title from CSV
  normalizedTitle String          // Normalized for matching
  auditorium      String
  startTime       DateTime
  endTime         DateTime
  language        String
  format          String
  rating          String
  lastUpdated     DateTime
  status          String   @default("active")
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([normalizedTitle, startTime])
}
```

## 🎓 Learning Outcomes

This project demonstrates:

- ✅ Full-stack TypeScript development with type safety end-to-end
- ✅ Intelligent data reconciliation with fuzzy matching
- ✅ Preview patterns for safe data mutations
- ✅ Real-world messy data handling
- ✅ Modern Next.js patterns (App Router, Server Components, Server Actions)
- ✅ Database design with Prisma ORM
- ✅ Authentication and authorization
- ✅ tRPC for type-safe APIs

## 📝 Notes

- The application handles CSV deduplication automatically
- Archived showtimes remain in the database but are hidden by default
- The reconciliation logic is deterministic and repeatable
- All timestamps are stored in UTC and converted to local time for display

## 🚢 Deployment

Deploy to Vercel:

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel

# Set environment variables in Vercel dashboard
# - DATABASE_URL
# - NEXTAUTH_SECRET
```

---

**Built for the Scope Labs Full Stack Engineering Challenge**
