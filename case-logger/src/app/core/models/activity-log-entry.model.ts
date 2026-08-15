export type ActivityType = 'Documentation' | 'Testing' | 'Training';

export interface ActivityLogEntry {
  id?: string;
  date: string;
  type: ActivityType;
  note: string;
  loggedBy: string;
  createdAt: string;
}
