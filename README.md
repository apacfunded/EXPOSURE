# Exposure

Expose a coin. Get Exposure. A pump.fun launchpad that pays creator fees to the holders who call your coin out.

Static site: `index.html` + `app.js`. Security headers live in `vercel.json`.

**Never commit secrets.** Wallet private keys and API keys go in Vercel project settings (Environment Variables) only.

## Layout
- `public/` the website
- `api/` backend (Vercel functions), `lib/` shared code, `supabase/schema.sql` database
- `.github/workflows/jobs.yml` background jobs, `tests/` (`node --test tests/*.test.js`)

Setup and go-live steps: [docs/SETUP.md](docs/SETUP.md)
