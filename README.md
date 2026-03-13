# SUP (Stand UP) Slack Bot

A Slack bot that automates daily stand-ups for distributed teams. It collects
updates asynchronously via DMs, compiles them into organized summaries, and
optionally generates AI insights using OpenAI.

## What it does

The bot handles the entire stand-up workflow:

1. **Scheduled Collection**: At your configured time (e.g., 9:30 AM), the bot DMs all opted-in team members
2. **Easy Submission**: Team members fill out a simple modal with yesterday's work, today's plan, and any blockers
3. **Automatic Compilation**: After a collection window, the bot posts a compiled message to your channel
4. **AI Summaries**: Optionally generates highlights, blockers, and action items using OpenAI

This eliminates the need for synchronous stand-up meetings while keeping
everyone informed.

## Key Features

- **Timezone-aware scheduling** - Works across global teams
- **Async-first** - No meetings, no interruptions
- **Opt-in/opt-out** - Team members control their participation
- **AI-powered summaries** - Get insights from OpenAI (optional)
- **Manual triggers** - Run stand-ups on-demand with `/standup-today`
- **HTTP mode** - Fast, reliable, production-ready
- **Deadline reminders** - Clear submission deadline plus 15-minute and 5-minute reminders for non-submitters

## Commands

- `/standup-init` - Initial setup (configure channel, time, timezone)
- `/standup-config` - Update configuration
- `/standup-today` - Trigger immediate stand-up collection
- `/standup-summary` - Regenerate AI summary for today
- `/standup-status` - View current configuration and your opt-in status
- `/standup-optin` - Start participating in stand-ups
- `/standup-optout` - Stop participating in stand-ups

## Tech Stack

Built with TypeScript and designed for production use:

- **Slack Bolt** - Slack app framework (HTTP mode)
- **Fastify** - Fast HTTP server
- **Prisma + SQLite** - Database and ORM
- **OpenAI** - AI summary generation
- **node-cron** - Scheduled jobs
- **Pino** - Structured logging
- **Docker** - Containerized deployment

## Setup

### Prerequisites

- Node.js 20+
- Slack workspace with admin access
- OpenAI API key (optional, for AI summaries)

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   pnpm install
   ```

3. Set up environment variables:
   ```bash
   cp .env.example .env
   ```

   Required variables:
   ```
   SLACK_BOT_TOKEN=xoxb-...
   SLACK_SIGNING_SECRET=...
   OPENAI_API_KEY=sk-...  # Optional
   ```

4. Run database migrations:
   ```bash
   pnpm migrate
   ```

5. Start the development server:
   ```bash
   pnpm dev
   ```

### Slack App Configuration

1. Create a new Slack app at https://api.slack.com/apps
2. Use the manifest in `docs/manifest.yaml` as a starting point
3. Update these settings:
   - **Event Subscriptions**: `https://your-domain.com/slack/events`
   - **Interactivity**: `https://your-domain.com/slack/events`
   - **Slash Commands**: Point all commands to `/slack/events`

4. Install the app to your workspace
5. Copy the Bot Token and Signing Secret to your `.env` file

### Deployment

The project includes Docker support:

```bash
docker compose up -d
```

For production, deploy to any platform that supports Docker (Render, Railway,
Fly.io, etc.) or use the included GitHub Actions workflow.

## Configuration

Environment variables:

```bash
# Required
SLACK_BOT_TOKEN=xoxb-your-token
SLACK_SIGNING_SECRET=your-secret

# Optional
OPENAI_API_KEY=sk-your-key          # For AI summaries
DATABASE_URL=file:./prod.db         # Default: file:./dev.db
PORT=3000                           # Default: 3000
COLLECTION_WINDOW_MIN=45            # Default: 45 minutes
SUMMARY_ENABLED=true                # Default: true
DEFAULT_TZ=Asia/Kolkata             # Default: Asia/Kolkata
```

## Development

```bash
# Install dependencies
pnpm install

# Run dev server with hot reload
pnpm dev

# Build for production
pnpm build

# Run production build
pnpm start

# Run tests
pnpm test

# Lint and format
pnpm lint
pnpm format
```

## Engineering Guardrails

- Behavior-changing work must ship with automated tests and pass `pnpm test`,
  `pnpm typecheck`, and `pnpm lint` before merge.
- Schema changes must use Prisma migrations under `prisma/migrations/`.
- Scheduler changes must preserve timezone-aware, idempotent stand-up execution.
- OpenAI summarization is optional; core stand-up collection and compilation must
  continue to work when AI is disabled or unavailable.
- Late submissions are stored for traceability and excluded from same-day
  compiled summaries.

## How it works

### Database Schema

The bot uses Prisma with SQLite (easily swappable to PostgreSQL/MySQL):

- **Workspace** - Team settings (channel, timezone, schedule)
- **Member** - User opt-in status per workspace
- **Standup** - Daily stand-up sessions
- **Entry** - Individual user submissions
- **JobLock** - Distributed lock for cron jobs

### Scheduling

Stand-ups are scheduled using node-cron based on your configured time and
timezone. The bot:

1. Triggers collection at the specified time
2. Waits for the collection window (default: 45 minutes)
3. Compiles all submissions into a single message
4. Posts to the configured channel
5. Generates and posts AI summary (if enabled)

### Performance

The bot includes several optimizations:

- **In-memory caching** - Workspace and user data cached for 30-60 seconds
- **Parallel queries** - Uses `Promise.all` for concurrent operations
- **HTTP mode** - Faster than Socket Mode (2-3x improvement)
- **Connection pooling** - Efficient database connections

## Contributing

Contributions are welcome. Please open an issue first to discuss what you'd like
to change, and include the validation commands you ran for behavior-changing
updates.
