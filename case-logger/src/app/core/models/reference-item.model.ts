import { CaseReferenceType } from './case.model';

export type ReferenceKind = 'category' | 'product' | 'market' | 'status' | 'type';
export type ReferenceTone = 'good' | 'warning' | 'progress' | 'info' | 'serious' | 'critical';

export interface ReferenceItem {
  id: string;
  kind: ReferenceKind;
  name: string;
  value: string;
  active: boolean;
  order: number;
  tone: ReferenceTone | null;
  closesCase: boolean | null;
  // category only (plan §12/T12.7) — which of Bug/Task/Workorder a case in
  // this category may reference. null = all three allowed (the default).
  allowedReferenceTypes: CaseReferenceType[] | null;
  createdAt: string;
  updatedAt: string;
}
