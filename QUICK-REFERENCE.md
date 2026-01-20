# Quick Reference Card - Keep This Open During Assessment

## 🚨 Critical Files

- `.env` - Add your Supabase DATABASE_URL here
- `sample-data/existing.csv` - First file to upload
- `sample-data/new-drop.csv` - Second file to upload (shows diffs)

## ⚡ Essential Commands

```bash
# Setup database (run once)
npm run db:push

# Test locally
npm run dev

# Check for errors
npm run typecheck

# Deploy (after pushing to GitHub)
# 1. Go to vercel.com
# 2. Import repo
# 3. Add DATABASE_URL env var
# 4. Deploy
```

## 🎯 Demo Script

1. **Show Empty State**
   - Visit app, show empty table

2. **Upload Existing Data**
   - Upload `existing.csv`
   - Show 6 showtimes appear

3. **Upload New Drop**
   - Upload `new-drop.csv`
   - **Preview Modal appears with:**
     - 1 Add (Kung Fu Panda 4)
     - 4 Updates (show field diffs)
     - 2 Archives (Wonka, Oppenheimer)

4. **Confirm Changes**
   - Click "Confirm Changes"
   - Table updates automatically

5. **Show Table Features**
   - Click column headers to sort
   - Use search box to filter
   - Point out active vs archived status

6. **Clear Schedule**
   - Click "Clear Schedule"
   - Confirm dialog
   - All become archived

## 📊 What Makes This Impressive

1. **Smart Matching**: "DUNE PART 2" matches "Dune: Part Two"
2. **Deduplication**: Duplicate rows automatically merged
3. **Field Diffs**: Shows exact changes (old → new)
4. **Type Safety**: Full TypeScript, no runtime errors
5. **Transaction Safety**: All changes atomic
6. **Modern Stack**: Next.js 15, tRPC, Prisma, Supabase
7. **Polish**: Dark theme, smooth UX, responsive

## 🗂️ Architecture in 3 Sentences

1. **Frontend**: Next.js 15 App Router with React components
2. **API**: tRPC for type-safe server functions
3. **Database**: PostgreSQL (Supabase) with Prisma ORM

## 🎨 Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Match by normalized title + time | Handles spelling variations |
| Archive vs delete | Maintains audit trail |
| Preview before apply | Prevents accidental data loss |
| Transaction-based updates | Ensures consistency |
| Status-based filtering | Easy to toggle active/archived |

## 🔧 Troubleshooting

| Problem | Solution |
|---------|----------|
| "Invalid database string" | Check DATABASE_URL in .env |
| "Property 'showtime' does not exist" | Run `npx prisma generate` |
| CSV parse error | Use sample CSV as template |
| Build fails on Vercel | Add DATABASE_URL env var |
| Changes not applying | Check browser console for errors |

## 📝 Talking Points

- "I used normalized title + start time as the unique constraint"
- "The diff engine computes field-level changes before applying"
- "All updates happen in a single transaction for consistency"
- "The normalization handles edge cases like 'Part Two' vs 'Part 2'"
- "Preview modal groups changes by type for easy review"
- "Table is fully sortable and filterable client-side"

## ⏱️ Time Budget

- **Local test**: 2 min
- **Push to GitHub**: 1 min
- **Vercel deploy**: 3 min
- **Production test**: 2 min
- **Polish README**: 2 min
- **Total**: ~10 min (leaves 50 min buffer)

## 🎓 Tech Stack Justification

- **Next.js 15**: Latest, fastest, production-ready
- **tRPC**: Type-safe APIs without codegen
- **Prisma**: Best-in-class TypeScript ORM
- **Supabase**: Managed PostgreSQL, instant setup
- **Tailwind**: Rapid styling, consistent design

## 🚀 Deployment URLs

- **GitHub**: https://github.com/daniel-bogart/scope-assessment-test
- **Vercel**: [Add after deployment]

## ✅ Pre-Flight Checklist

Before starting the assessment:

- [ ] Supabase project created
- [ ] DATABASE_URL in .env
- [ ] `npm run db:push` completed successfully
- [ ] Local test passed (upload existing.csv)
- [ ] Vercel account ready
- [ ] GitHub repo pushed

During assessment:

- [ ] Test production deployment
- [ ] Upload both CSV files to verify
- [ ] Update README with live URL
- [ ] Final commit and push

Good luck! You've got this! 🎯

