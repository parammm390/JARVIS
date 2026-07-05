# FINNOR Agency Website

A premium, modern, production-grade Next.js website for FINNOR, an AI automation agency focused on inbound call handling.

## Tech Stack
- **Framework:** Next.js (App Router)
- **Styling:** Tailwind CSS + shadcn/ui
- **Animations:** Framer Motion
- **Icons:** lucide-react
- **Database/Backend:** Supabase

## Setup Instructions

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment Variables
Copy the example environment file and add your Supabase credentials:
```bash
cp .env.example .env.local
```
Fill in the credentials in `.env.local`:
- `NEXT_PUBLIC_SUPABASE_URL`: Your Supabase Project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Your Supabase anon key (safe for browser)
- `SUPABASE_URL`: Your Supabase Project URL for server-side lead writes
- `SUPABASE_SERVICE_ROLE_KEY`: Your Supabase service role key (kept secret on the server)
- `GEMINI_API_KEY`: Optional, server-side only, used by `/api/generate-demo` for conservative profile personalization
- `GEMINI_MODEL`: Optional, defaults to `gemini-2.5-flash-lite`
- `NEXT_PUBLIC_VAPI_PUBLIC_KEY`: Optional, enables the live browser voice demo
- `NEXT_PUBLIC_VAPI_ASSISTANT_ID`: Optional, reusable Vapi assistant for the dispatch demo
- `VAPI_WEBHOOK_SECRET`: Optional, protects `/api/voice/webhook` when configured in Vapi
- `NEXT_PUBLIC_DEMO_MOCK_MODE`: Set to `true` to force polished mock mode
- `LEAD_NOTIFY_WEBHOOK_URL`: Optional webhook for demo-generated notifications
- `GMAIL_USER` and `GMAIL_APP_PASSWORD`: Optional, used by the contact form email notification

### 3. Run Locally
```bash
npm run dev
```
Navigate to [http://localhost:3000](http://localhost:3000).

## Supabase Setup
1. Create a new project in [Supabase](https://supabase.com).
2. Go to the SQL Editor and paste the contents of `supabase/schema.sql` to create the `leads` and `demo_leads` tables.
3. Configure your API keys in the `.env.local` file.
4. _(Optional but recommended)_ Setup Row Level Security (RLS) policies as commented in the schema.

## Editing Content
Brand information, copy, links, and text are managed centrally.
- **Brand name, tagline, email, links:** Edit `src/config/site.ts`.
- **Page Sections:** Edit the individual components in `src/components/sections/`.
- **Contact Form:** Logic is handled in `src/app/api/contact/route.ts` and UI in `src/components/sections/ContactForm.tsx`.

## Personalized Demo
The premium dispatch demo is available at `/demo`.

- **Route:** `src/app/demo/page.tsx`
- **Client experience:** `src/components/demo/`
- **API endpoint:** `src/app/api/generate-demo/route.ts`
- **Lead APIs:** `src/app/api/demo-leads/route.ts` and `src/app/api/demo-leads/update/route.ts`
- **Scraping:** `src/lib/scrape/scrape-site.ts`
- **Profile extraction:** `src/lib/llm/gemini.ts`
- **Voice prompt builder:** `src/lib/llm/prompt-builder.ts`
- **Supabase lead writes:** `src/lib/leads/supabase.ts`
- **Backend readiness:** `src/app/api/health/route.ts`
- **Voice webhook:** `src/app/api/voice/webhook/route.ts`

The endpoint reads a company website with bounded timeouts, public-host guardrails, and a short list of likely dispatch pages. It marks unknown facts as unknown and falls back to a generic after-hours emergency dispatch workflow when scraping or LLM summarization is unavailable.

For Vapi, use one reusable assistant and reference the dynamic variables passed by the browser call:
- `{{ companyName }}`
- `{{ websiteUrl }}`
- `{{ companySummary }}`
- `{{ detectedServices }}`
- `{{ dispatchAngle }}`
- `{{ safeDemoScenario }}`
- `{{ voicePrompt }}`
- `{{ techAlertPreview }}`
- `{{ crmPreview }}`

The browser also sends the safe system context into the live call. If Vapi keys are not configured, the page reports that voice is not configured instead of failing silently.

## Lifecycle Demo
The customer lifecycle demo is available at `/demo/lifecycle`.

- **Route:** `src/app/demo/lifecycle/page.tsx`
- **Client experience:** `src/components/lifecycle/`
- **Water lookup API:** `src/app/api/lifecycle/water/route.ts`
- **Diagnosis API:** `src/app/api/lifecycle/diagnose/route.ts`
- **Scenario math:** `src/lib/lifecycle/`
- **Narrative layer:** `src/lib/llm/lifecycle-diagnosis.ts`

The flow takes a service-area ZIP, pricing tier, household size, services, and concern. It pulls public water data, computes sizing and quote logic locally, optionally uses Gemini for the narrative layer, and falls back to deterministic copy when Gemini is unavailable.

Before publishing, call `/api/health` locally or in preview. `readyForProduction` should be `true` after Gemini, Supabase, and Vapi browser credentials are configured. Configure Vapi to send call events to `/api/voice/webhook` and set the same `VAPI_WEBHOOK_SECRET` in Vercel and Vapi.

## Deployment
This project is optimized for deployment on Vercel.

1. Push your repository to GitHub.
2. Import the project into your Vercel dashboard.
3. Add your Environment Variables during the Vercel setup (`GEMINI_API_KEY`, `GEMINI_MODEL`, `NEXT_PUBLIC_VAPI_PUBLIC_KEY`, `NEXT_PUBLIC_VAPI_ASSISTANT_ID`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_DEMO_MOCK_MODE`, and optional `LEAD_NOTIFY_WEBHOOK_URL`).
4. Click Deploy.

If the Vercel CLI is already linked, deploy from the project root:
```bash
npx vercel --prod
```
