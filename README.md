# School Register

A student register, attendance tracker, and dropout/decline risk dashboard for
teachers and admins, backed by Supabase (Postgres) so data persists for real.

## 1. Create your Supabase project

1. Go to https://supabase.com, sign up (free tier is enough), and create a new project.
2. Wait for it to finish provisioning (~2 minutes).
3. Open **SQL Editor** in the left sidebar → **New query**.
4. Paste the entire contents of `supabase-schema.sql` (included in this project) and click **Run**.
   This creates the `teachers`, `students`, `attendance`, `grades`, and `settings` tables.
5. Open **Project Settings → API**. You'll need two values from this page:
   - **Project URL** (looks like `https://abcdefgh.supabase.co`)
   - **anon public** key (a long string — this is safe to use in client-side code)

## 2. Run it locally (optional, but good for testing first)

```bash
npm install
cp .env.example .env.local
# edit .env.local and paste in your Project URL and anon key
npm run dev
```

Open the URL it prints (usually `http://localhost:5173`). The first screen will
let you create the admin account — that gets saved into your Supabase `teachers`
table for real this time.

## 3. Push this project to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
```

Create a new empty repository on GitHub, then follow GitHub's instructions to
push (`git remote add origin ...`, `git push -u origin main`).

## 4. Deploy on Netlify

1. Go to https://app.netlify.com and sign up / log in.
2. **Add new site → Import an existing project → GitHub**, and pick this repo.
3. Netlify should auto-detect the build settings from `netlify.toml`
   (`npm run build`, publish folder `dist`) — you shouldn't need to change anything.
4. Before deploying, add your environment variables:
   **Site configuration → Environment variables → Add a variable**, and add:
   - `VITE_SUPABASE_URL` = your Project URL
   - `VITE_SUPABASE_ANON_KEY` = your anon public key
5. Click **Deploy**. After the build finishes you'll get a live URL like
   `random-name-123.netlify.app` — that's your working app.

## 5. Point a custom domain at it

Once you've bought a domain (Namecheap, GoDaddy, Google Domains, etc.):

1. In Netlify: **Domain settings → Add a domain** and enter your domain.
2. Netlify will show you either:
   - Nameservers to set at your registrar (easiest — Netlify manages DNS), or
   - A specific A record / CNAME to add at your registrar if you'd rather keep
     DNS there.
3. Follow whichever Netlify shows you. DNS changes can take anywhere from a
   few minutes to a few hours to propagate.
4. Netlify issues a free HTTPS certificate for your domain automatically once
   DNS is pointed correctly.

## Notes on security before real rollout

This app uses a lightweight custom login (a `teachers` table with plaintext
passwords, checked directly from the browser) rather than Supabase Auth, and
ships with Row Level Security turned off so it works immediately with just
the anon key. That's fine for testing with a small trusted staff, but before
using this with real student data long-term:

- Enable Supabase Auth (email/password) for teacher accounts instead of the
  custom table.
- Enable Row Level Security on every table and write policies keyed to
  `auth.uid()`, so class-level access is enforced by the database — right now
  it's only enforced by the app's UI, which a determined user could bypass by
  calling the Supabase API directly with the anon key.

`supabase-schema.sql` has more detail in its comments.
