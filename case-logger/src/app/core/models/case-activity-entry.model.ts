import { UserSummary } from './user-summary.model';

export type CaseActivityEntryType = 'system' | 'comment';

export interface CaseActivityEntry {
  id: string;
  caseId: string;
  user: UserSummary;
  entryType: CaseActivityEntryType;
  changeSummary: string;
  createdAt: string;
}
