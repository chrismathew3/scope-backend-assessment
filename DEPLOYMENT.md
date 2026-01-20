# Quick Deployment Guide

## ⚡ Fast Deploy (5 minutes)

### Step 1: Database Setup (2 min)

1. Go to [Supabase](https://supabase.com)
2. Create new project
3. Wait for database to provision
4. Go to Settings → Database → Connection String
5. Copy the "URI" connection string
6. Create `.env` file in project root:

```env
DATABASE_URL="postgresql://postgres:[PASSWORD]@[REF].supabase.co:5432/postgres?pgbouncer=true&connection_limit=1"
```

### Step 2: Push Schema (1 min)

```bash
npm run db:push
```

### Step 3: Test Locally (Optional)

```bash
npm run dev
```

Open http://localhost:3000 and test with sample CSV files.

### Step 4: Deploy to Vercel (2 min)

#### Option A: CLI (Fastest)

```bash
npm i -g vercel
vercel login
vercel
```

When prompted:
- Set up and deploy: **Yes**
- Which scope: **Your account**
- Link to existing project: **No**
- Project name: **scope-movie-assessment** (or your choice)
- Directory: **./` (default)**
- Override settings: **No**

Add environment variable:

```bash
vercel env add DATABASE_URL
```

Paste your DATABASE_URL when prompted, select "Production".

Redeploy:

```bash
vercel --prod
```

#### Option B: Web UI

1. Push code to GitHub:

```bash
git add .
git commit -m "Complete theater showtimes app"
git push -u origin main
```

2. Go to [Vercel](https://vercel.com)
3. Click "Add New Project"
4. Import your GitHub repo
5. Add environment variable:
   - Name: `DATABASE_URL`
   - Value: Your Supabase connection string
6. Click "Deploy"

### Step 5: Update README

Add your deployed URL to the README.md file.

## ✅ Verify Deployment

1. Visit your Vercel URL
2. Upload `sample-data/existing.csv`
3. Check that 6 showtimes appear
4. Upload `sample-data/new-drop.csv`
5. Verify preview shows:
   - 1 add (Kung Fu Panda 4)
   - 4 updates
   - 2 archives (Wonka, Oppenheimer)
6. Confirm changes
7. Check updated table

## 🐛 Common Issues

**Database connection fails:**
- Check DATABASE_URL is added in Vercel environment variables
- Ensure you're using the "URI" format from Supabase (not the pooler format for session mode)
- Redeploy after adding env vars

**Build fails:**
- Check all dependencies are in package.json
- Verify Node version is 20+ in Vercel settings

**CSV parsing errors:**
- Ensure CSV has all required columns
- Check that dates are in ISO format
- Use sample CSV files as reference

