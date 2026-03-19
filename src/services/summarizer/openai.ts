import OpenAI from 'openai';
import { SummarizerProvider, SummaryResult } from './provider.js';
import { logger } from '../../utils/logger.js';

export class OpenAISummarizer implements SummarizerProvider {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, baseURL?: string, model?: string) {
    this.client = new OpenAI({ apiKey, ...(baseURL && { baseURL }) });
    this.model = model || 'gpt-4o';
  }

  async generateSummary(
    entries: Array<{
      userId: string;
      yesterday: string;
      today: string;
      blockers?: string;
      notes?: string;
    }>
  ): Promise<SummaryResult> {
    try {
      const standupText = entries
        .map(
          (entry) =>
            `User ${entry.userId}:\nYesterday: ${entry.yesterday}\nToday: ${entry.today}\nBlockers: ${entry.blockers || 'None'}\nNotes: ${entry.notes || 'None'}`
        )
        .join('\n\n');

      const prompt = `You are analyzing a team stand-up. Please provide:
1. Highlights (key accomplishments and progress)
2. Blockers & Risks (issues that need attention)
3. Action Items (next steps and dependencies)

Stand-up data:
${standupText}

Format your response as:
HIGHLIGHTS:
[bullet points]

BLOCKERS:
[bullet points]

ACTION_ITEMS:
[bullet points]

Keep it concise and under 2000 characters total.`;

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant that summarizes team stand-ups concisely.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.7,
        max_tokens: 800,
      });

      const content = response.choices[0]?.message?.content || '';
      return this.parseSummary(content);
    } catch (error) {
      logger.error({ error }, 'Failed to generate AI summary');
      throw error;
    }
  }

  private parseSummary(content: string): SummaryResult {
    const highlightsMatch = content.match(/HIGHLIGHTS:(.*?)(?=BLOCKERS:|$)/s);
    const blockersMatch = content.match(/BLOCKERS:(.*?)(?=ACTION_ITEMS:|$)/s);
    const actionItemsMatch = content.match(/ACTION_ITEMS:(.*?)$/s);

    return {
      highlights: highlightsMatch?.[1]?.trim() || 'No highlights available.',
      blockers: blockersMatch?.[1]?.trim() || 'No blockers reported.',
      actionItems: actionItemsMatch?.[1]?.trim() || 'No action items identified.',
    };
  }
}

export function createSummarizer(apiKey?: string, baseURL?: string, model?: string): SummarizerProvider | null {
  if (!apiKey) {
    logger.warn('OpenAI API key not provided, summaries will be disabled');
    return null;
  }

  return new OpenAISummarizer(apiKey, baseURL, model);
}
