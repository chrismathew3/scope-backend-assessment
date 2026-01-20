# Setup Checklist - Before You Start the Timer!

## ⏱️ Pre-Assessment Setup (Do this BEFORE starting the 60-minute timer)

### 1. Supabase Setup (5 minutes)
- [ ] Go to https://supabase.com and create account
- [ ] Create a new project (name it whatever you want)
- [ ] Wait for database to provision (~2 minutes)
- [ ] Go to Project Settings → Database → Connection String
- [ ] Copy the **URI** (not the session pooler) connection string
- [ ] Create `.env` file in project root:

```bash
DATABASE_URL="postgresql://postgres:[YOUR-PASSWORD]@[YOUR-REF].supabase.co:5432/postgres?pgbouncer=true&connection_limit=1"
```

**Important**: Replace `[YOUR-PASSWORD]` and `[YOUR-REF]` with actual values from Supabase!

### 2. Test Database Connection (2 minutes)

```bash
npm run db:push
```

You should see: ✅ "Your database is now in sync with your Prisma schema"

If it fails:
- Check DATABASE_URL is correct
- Ensure no typos in .env file
- Make sure you're using the URI format

### 3. Test the App Locally (3 minutes)

```bash
npm run dev
```

- Open http://localhost:3000
- You should see "Theater Showtimes Manager" page
- Try uploading `sample-data/existing.csv`
- Verify 6 showtimes appear in the table

If it works, you're ready! ✅

### 4. Setup Vercel Account (2 minutes)
- [ ] Go to https://vercel.com and sign up/login
- [ ] Connect your GitHub account
- [ ] Ensure your GitHub repo is pushed

## 🚀 During the Assessment (Deployment)

When you're ready to deploy during your 60 minutes:

1. **Push to GitHub** (30 seconds)
```bash
git add .
git commit -m "Complete theater showtimes app"
git push
```

2. **Deploy on Vercel** (2 minutes)
- Go to vercel.com → New Project
- Import your GitHub repo
- Add environment variable:
  - Name: `DATABASE_URL`
  - Value: [Paste your Supabase URL]
- Click Deploy

3. **Test Production** (1 minute)
- Visit your Vercel URL
- Upload `sample-data/existing.csv`
- Upload `sample-data/new-drop.csv`
- Verify preview and confirm changes work

4. **Update README** (30 seconds)
- Add your live Vercel URL to README.md
- Commit and push

Done! 🎉

## 📊 What to Demo

Show these features to demonstrate quality:

1. **CSV Upload with Preview**
   - Upload `new-drop.csv`
   - Point out the 3 sections: Adds, Updates, Archives
   - Highlight field-level diffs (e.g., "format: 2D → IMAX")

2. **Smart Deduplication**
   - Note that duplicate Kung Fu Panda row becomes single entry

3. **Title Normalization**
   - Show how "DUNE PART 2" matches "Dune: Part Two"
   - Different spacing/casing treated as same movie

4. **Table Features**
   - Click column headers to sort
   - Use search bar to filter
   - Show archived vs active status

5. **Architecture**
   - Type-safe end-to-end (TypeScript + tRPC)
   - Transaction-based updates for data consistency
   - Modern stack (Next.js 15, Prisma, Supabase)

## 🎯 Time Management

- Database + code ready: **0 minutes** (done pre-assessment)
- Test locally: **2 minutes**
- Deploy to Vercel: **3 minutes**
- Test production: **2 minutes**
- Polish README: **3 minutes**
- **Buffer time**: **50 minutes** for other requirements or polish

## ⚠️ Troubleshooting

**Build fails on Vercel:**
- Make sure DATABASE_URL is added to environment variables
- Redeploy after adding env vars

**CSV parsing errors:**
- Ensure CSV has all required columns
- Check date formats are ISO 8601
- Use sample CSV files as templates

**Database connection errors:**
- Verify DATABASE_URL is correct
- Check Supabase project is not paused
- Ensure password special characters are URL-encoded if needed

