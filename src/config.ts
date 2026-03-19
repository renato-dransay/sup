import { z } from 'zod';

const configSchema = z.object({
  slackBotToken: z.string().min(1, 'SLACK_BOT_TOKEN is required'),
  slackAppToken: z.string().optional(), // Optional for HTTP mode
  slackSigningSecret: z.string().min(1, 'SLACK_SIGNING_SECRET is required'),
  openAiApiKey: z.string().optional(),
  llmBaseUrl: z.string().optional(),
  llmModel: z.string().optional(),
  databaseUrl: z.string().default('file:./dev.db'),
  redisUrl: z.string().optional(),
  port: z.coerce.number().default(3000),
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  defaultTz: z.string().default('Asia/Kolkata'),
  summaryEnabled: z.coerce.boolean().default(true),
  collectionWindowMin: z.coerce.number().default(45),
  logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(): Config {
  const config = configSchema.parse({
    slackBotToken: process.env.SLACK_BOT_TOKEN,
    slackAppToken: process.env.SLACK_APP_TOKEN,
    slackSigningSecret: process.env.SLACK_SIGNING_SECRET,
    openAiApiKey: process.env.OPENAI_API_KEY,
    llmBaseUrl: process.env.LLM_BASE_URL,
    llmModel: process.env.LLM_MODEL,
    databaseUrl: process.env.DATABASE_URL,
    redisUrl: process.env.REDIS_URL,
    port: process.env.PORT,
    nodeEnv: process.env.NODE_ENV,
    defaultTz: process.env.DEFAULT_TZ,
    summaryEnabled: process.env.SUMMARY_ENABLED,
    collectionWindowMin: process.env.COLLECTION_WINDOW_MIN,
    logLevel: process.env.LOG_LEVEL,
  });

  return config;
}
