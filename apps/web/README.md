# Athene AI Core

Enterprise Multi-Agent Orchestration Platform — Next.js frontend with Clerk auth and Nango integrations.

## Prerequisites

- **Node.js** v20+
- **pnpm** v9+ — install with `npm install -g pnpm`
- Access to the team's Clerk and Nango dev credentials (ask the project lead)

## Setup

**1. Clone the repo**

```bash
git clone https://github.com/LisaxDsouza/Athene-test-review.git
cd Athene-test-review
```

**2. Install dependencies**

```bash
pnpm install
```

**3. Configure environment variables**

Create a `.env.local` file in the project root:

```env
# Clerk — get these from the Clerk dashboard (Development environment)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...

# Clerk redirect config (copy as-is)
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/
NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/onboarding
NEXT_PUBLIC_CLERK_AFTER_SIGN_OUT_URL=/sign-in

# Nango — get the secret key from the Nango dashboard
NANGO_SECRET_KEY=...
```

Ask the project lead for the shared dev values for these keys.

**4. Run the dev server**

```bash
cd apps/web/
pnpm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Project Structure

```
app/
  (auth)/          # Sign in / sign up pages (Clerk)
  (dashboard)/     # Protected app — sidebar layout
    page.tsx       # Command Center (/)
    chat/          # Athene Intelligence chat (/chat)
    agents/        # Agent Fleet (/agents)
    sources/       # Knowledge Base (/sources)
    integrations/  # Nango OAuth integrations (/integrations)
    teams/         # Teams & access control (/teams)
    settings/      # Workspace settings (/settings)
  onboarding/      # Org setup + integration wizard
  api/nango/       # Nango session token endpoint
components/ui/     # Shared UI components
lib/utils.ts       # cn() utility
middleware.ts      # Clerk auth guard
```

## Tech Stack

| Layer | Library |
|-------|---------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript 5 |
| Styling | Tailwind CSS 4 |
| UI primitives | shadcn / Base UI + CVA |
| Auth | Clerk 7 (multi-tenant orgs) |
| Integrations | Nango 0.69 (OAuth) |

## Current State

This is a UI-complete MVP. All data is mocked — there is no database or backend CRUD yet. The only real API endpoint is `/api/nango/session` for generating Nango connection tokens.

## Common Scripts

```bash
pnpm dev      # Start dev server (localhost:3000)
pnpm build    # Production build
pnpm start    # Start production server
pnpm lint     # Run ESLint
```

## Contributing Workflow

We follow a **branch-based Pull Request** workflow for contributions. Here is how you can contribute:

1. **Clone the Repository**
   Clone the repository to your local machine (as described in the Setup section).

2. **Create a Feature Branch**
   Create a new branch for your feature or bugfix off of the main branch:
   ```bash
   git checkout -b feature/your-feature-name
   ```

3. **Make Changes and Test**
   Make your code changes, and ensure the app runs correctly by starting the dev server (`pnpm dev`) and running the linter (`pnpm lint`).

4. **Commit and Push**
   Commit your changes with clear, descriptive messages and push your branch to the remote repository:
   ```bash
   git add .
   git commit -m "feat: add your feature description"
   git push origin feature/your-feature-name
   ```

5. **Submit a Pull Request (PR)**
   Go to the repository on GitHub and click **"New Pull Request"**. 
   - Set the base branch to `main`.
   - Set the compare branch to your newly pushed feature branch.
   - Provide a clear description of your changes and submit the PR for review. Once approved by the maintainers, your changes will be merged into the main branch!
