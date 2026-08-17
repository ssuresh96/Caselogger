import { UserSummary } from './user-summary.model';

export type CaseStatus = 'Open' | 'InProgress' | 'Pending' | 'Resolved';
export type CaseType = 'Implementation' | 'Support' | 'Deactivation' | 'Escalation';
export type ReporterType = 'Customer' | 'Internal';
export type CaseReferenceType = 'Bug' | 'Task' | 'Workorder';
export type CaseSource = 'manual' | 'import' | 'email';

export interface Case {
  id: string;
  caseId: string;
  reportedDate: string;
  reporterType: ReporterType;
  reporterName: string;
  customer: string;
  product: string;
  category: string;
  description: string;
  assignedTo: UserSummary;
  status: CaseStatus;
  type: CaseType;
  market: string;
  remarks: string;
  resolution: string;
  bugNumber: string | null;
  taskNumbers: string[];
  workOrderNumbers: string[];
  dateOfClosure: string | null;
  linkedImplementationId: string | null;
  source: CaseSource;
  emailConversationId: string | null;
  createdBy: UserSummary;
  updatedBy: UserSummary;
  createdAt: string;
  updatedAt: string;
}
