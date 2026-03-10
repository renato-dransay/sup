export interface SummaryResult {
  highlights: string;
  blockers: string;
  actionItems: string;
}

export interface SummarizerProvider {
  generateSummary(
    entries: Array<{
      userId: string;
      yesterday: string;
      today: string;
      blockers?: string;
      notes?: string;
    }>
  ): Promise<SummaryResult>;
}
