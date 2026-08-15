export type ReferenceDataKind = 'categories' | 'products' | 'markets' | 'teamMembers';

export interface ReferenceDataItem {
  id?: string;
  name: string;
  active: boolean;
  aliasesMerged?: string[];
  createdAt?: unknown;
}
