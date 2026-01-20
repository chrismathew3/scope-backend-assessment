# 🚀 Quick Start Guide

## 1-Minute Setup Checklist

### ✅ Pre-deployment

- [ ] Clone repo and run `npm install`
- [ ] Create Supabase project and get DATABASE_URL
- [ ] Add DATABASE_URL to `.env` file
- [ ] Run `npm run db:push` to create tables
- [ ] Test locally with `npm run dev` (optional)
- [ ] Test CSV upload with `sample-data/existing.csv`

### ✅ GitHub

```bash
git add .
git commit -m "Initial commit: Theater showtimes manager"
git push -u origin main
```

### ✅ Vercel Deployment

1. Go to vercel.com → New Project
2. Import GitHub repo
3. Add environment variable: `DATABASE_URL`
4. Deploy
5. Test live URL with sample CSV files

### ✅ Final Touches

- [ ] Add live URL to README.md
- [ ] Verify all features work on production
- [ ] Submit links (GitHub + Vercel)

## Key Features to Demonstrate

1. **CSV Upload**: Upload `sample-data/new-drop.csv`
2. **Preview**: Show the 3-section preview (adds, updates, archives)
3. **Field Diffs**: Point out the field-level changes (e.g., format: 2D → IMAX)
4. **Deduplication**: Note that duplicate Kung Fu Panda row becomes single entry
5. **Table Features**: Show sorting by clicking headers, search by title
6. **Clear Schedule**: Archive all showtimes with one click

## Sample Data Flow

```
1. Upload existing.csv → Creates 6 active showtimes
2. Upload new-drop.csv → Preview shows:
   ✅ 1 Add: Kung Fu Panda 4
   🔄 4 Updates: Spider-Man, Inside Out 2, Dune (2x)
   🗄️ 2 Archives: Wonka, Oppenheimer
3. Confirm → Changes applied
4. Table updates automatically
```

## Tech Highlights for Interview

- **Type Safety**: Full stack TypeScript with tRPC
- **Smart Matching**: Normalized title + start time uniqueness
- **Transaction Safety**: All changes in single DB transaction
- **Modern Stack**: Next.js 15 App Router, Prisma, Supabase
- **UX Polish**: Preview before apply, field-level diffs, real-time updates
- **Error Handling**: Graceful CSV parsing, deduplication, validation

## Time Spent Breakdown (Example)

- Schema & DB setup: 5 min
- Normalization & parsing logic: 10 min
- tRPC endpoints: 10 min
- Frontend components: 15 min
- Styling & polish: 10 min
- Deployment & docs: 10 min
- **Total**: ~60 min

