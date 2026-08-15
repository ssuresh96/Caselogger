export interface Implementation {
  id?: string;
  customer: string;
  product: string;
  description: string;
  assignedTo: string;
  status: string;
  dateOfClosure: string | null;
  reqId: string;
  linkedCaseId: string | null;
  createdAt: string;
  updatedAt: string;
}
