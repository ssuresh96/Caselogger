import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import {
  BehaviorSubject,
  Observable,
  catchError,
  firstValueFrom,
  map,
  of,
  switchMap,
  take,
} from 'rxjs';
import { Case, CaseStatus, CaseType, ReporterType } from '../models/case.model';
import { CaseActivityEntry } from '../models/case-activity-entry.model';
import { UserSummary } from '../models/user-summary.model';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';
import { MOCK_USERS } from './users.service';

export interface CreateCaseInput {
  reportedDate: string;
  reporterType: ReporterType;
  reporterName: string;
  customer: string;
  product: string;
  description: string;
  category: string;
  assignedTo: string; // user id
  status: CaseStatus;
  type: CaseType;
}

export interface UpdateCaseInput {
  reporterType?: ReporterType;
  reporterName?: string;
  customer?: string;
  product?: string;
  description?: string;
  category?: string;
  assignedTo?: string; // user id
  status?: CaseStatus;
  type?: CaseType;
  market?: string;
  remarks?: string;
  resolution?: string;
  bugNumber?: string | null;
  taskNumbers?: string[];
  workOrderNumbers?: string[];
}

export interface CaseListResponse {
  items: Case[];
  total: number;
}

export interface CaseListParams {
  page: number;
  pageSize: number;
  status?: string; // comma-separated for "one of" (e.g. "Open,InProgress,Pending")
  type?: string; // comma-separated
  search?: string;
  assignedTo?: string; // user id
}

function userByName(name: string): UserSummary {
  const found = MOCK_USERS.find((u) => u.name === name);
  if (!found) {
    throw new Error(`Unknown mock user: ${name}`);
  }
  return found;
}

type SeedInput = Pick<
  Case,
  'caseId' | 'customer' | 'product' | 'category' | 'description' | 'status'
> & {
  assignedTo: string; // name, resolved to a MOCK_USERS entry
  reportedDate?: string;
  type?: CaseType;
  market?: string;
};

function seed(input: SeedInput): Omit<Case, 'id'> {
  const reportedDate = input.reportedDate ?? '2025-05-10T10:00:00Z';
  const assignedTo = userByName(input.assignedTo);
  return {
    caseId: input.caseId,
    reportedDate,
    reporterType: 'Internal',
    reporterName: assignedTo.name,
    customer: input.customer,
    product: input.product,
    category: input.category,
    description: input.description,
    assignedTo,
    status: input.status,
    type: input.type ?? 'Support',
    market: input.market ?? 'UAE',
    remarks: '',
    resolution: '',
    bugNumber: null,
    taskNumbers: [],
    workOrderNumbers: [],
    dateOfClosure: input.status === 'Resolved' ? reportedDate : null,
    linkedImplementationId: null,
    createdAt: reportedDate,
    updatedAt: reportedDate,
    createdBy: assignedTo,
    updatedBy: assignedTo,
  };
}

const SEED_CASES: Array<Omit<Case, 'id'>> = [
  seed({
    caseId: 'CAS-2025-00124',
    description: 'Payment gateway timeout issue during checkout',
    customer: 'Travco LLC',
    product: 'AOS',
    category: 'AOS-Payment Gateway',
    status: 'Open',
    assignedTo: 'Neeraj Sharma',
    reportedDate: '2025-05-13T10:30:00Z',
  }),
  seed({
    caseId: 'CAS-2025-00123',
    description: 'Unable to generate itinerary for multi-city booking',
    customer: 'Transworld Air',
    product: 'AQC',
    category: 'Other Support Cases',
    status: 'InProgress',
    assignedTo: 'Priya Menon',
    reportedDate: '2025-05-13T09:15:00Z',
  }),
  seed({
    caseId: 'CAS-2025-00122',
    description: 'Login issue for subadmin account',
    customer: 'Weefly',
    product: 'AOS',
    category: 'AOS-General Support',
    status: 'Pending',
    assignedTo: 'Subin Suresh',
    reportedDate: '2025-05-12T16:45:00Z',
  }),
  seed({
    caseId: 'CAS-2025-00121',
    description: 'Fare mismatch in search results vs booking screen',
    customer: 'Yasalam',
    product: 'AQC',
    category: 'AOS-Customer Config Mismatch',
    status: 'Resolved',
    assignedTo: 'Arjun Nair',
    reportedDate: '2025-05-12T11:20:00Z',
  }),
  seed({
    caseId: 'CAS-2025-00120',
    description: 'Error while booking with NDC supplier',
    customer: 'Apniticket',
    product: 'CDSR',
    category: 'AOS Dev BUG',
    status: 'Open',
    assignedTo: 'Neeraj Sharma',
    reportedDate: '2025-05-12T10:05:00Z',
  }),
  seed({
    caseId: 'CAS-2025-00119',
    description: 'Refund not initiated after cancellation',
    customer: 'Travco LLC',
    product: 'AOS',
    category: 'AOS-Ticket Pending',
    status: 'InProgress',
    assignedTo: 'Fatima Al Sayed',
    reportedDate: '2025-05-11T15:30:00Z',
  }),
  seed({
    caseId: 'CAS-2025-00118',
    description: 'Payment declined but amount debited from customer',
    customer: 'Weefly',
    product: 'AOS',
    category: 'AOS-Payment Gateway',
    status: 'Open',
    assignedTo: 'Subin Suresh',
    reportedDate: '2025-05-11T13:10:00Z',
  }),
  seed({
    caseId: 'CAS-2025-00117',
    description: 'AOS deactivation request for closed branch',
    customer: 'Zenith Travels',
    product: 'AOS',
    category: 'AOS-User Deactivated',
    status: 'Pending',
    assignedTo: 'Priya Menon',
    type: 'Deactivation',
    reportedDate: '2025-05-11T09:40:00Z',
  }),
  seed({
    caseId: 'CAS-2025-00116',
    description: 'MPE report export failing for large date range',
    customer: 'Nomad Bookings',
    product: 'MPE',
    category: 'Other Support Cases',
    status: 'InProgress',
    assignedTo: 'Arjun Nair',
    reportedDate: '2025-05-10T17:05:00Z',
  }),
  seed({
    caseId: 'CAS-2025-00115',
    description: 'Duplicate bookings created on payment retry',
    customer: 'Skyline Tours',
    product: 'RPP',
    category: 'AOS Dev BUG',
    status: 'Resolved',
    assignedTo: 'Neeraj Sharma',
    reportedDate: '2025-05-10T14:25:00Z',
  }),
  seed({
    caseId: 'CAS-2025-00114',
    description: 'Training needed on new FO workflow',
    customer: 'BlueSky Holidays',
    product: 'FO',
    category: 'AOS-Training',
    status: 'Open',
    assignedTo: 'Fatima Al Sayed',
    reportedDate: '2025-05-10T11:00:00Z',
  }),
  seed({
    caseId: 'CAS-2025-00113',
    description: 'AVH price cache not refreshing after update',
    customer: 'Continental Travels',
    product: 'AVH',
    category: 'AOS-How to do',
    status: 'Pending',
    assignedTo: 'Subin Suresh',
    reportedDate: '2025-05-09T16:20:00Z',
  }),
  seed({
    caseId: 'CAS-2025-00112',
    description: 'Feature request: bulk itinerary download',
    customer: 'Travco LLC',
    product: 'AQC',
    category: 'Other Support Cases',
    status: 'Open',
    assignedTo: 'Priya Menon',
    reportedDate: '2025-05-09T10:50:00Z',
  }),
  seed({
    caseId: 'CAS-2025-00111',
    description: 'Customer config mismatch after migration',
    customer: 'Weefly',
    product: 'AOS',
    category: 'AOS-Customer Config Mismatch',
    status: 'InProgress',
    assignedTo: 'Neeraj Sharma',
    reportedDate: '2025-05-09T09:15:00Z',
  }),
  seed({
    caseId: 'CAS-2025-00110',
    description: 'Ticket pending confirmation beyond SLA',
    customer: 'Yasalam',
    product: 'AOS',
    category: 'AOS-Ticket Pending',
    status: 'Resolved',
    assignedTo: 'Arjun Nair',
    reportedDate: '2025-05-08T15:40:00Z',
  }),
  seed({
    caseId: 'CAS-2025-00109',
    description: 'Schedule change not reflected for customer',
    customer: 'Apniticket',
    product: 'RPP',
    category: 'AOS-Task',
    status: 'Open',
    assignedTo: 'Fatima Al Sayed',
    reportedDate: '2025-05-08T12:30:00Z',
  }),
  seed({
    caseId: 'CAS-2025-00108',
    description: 'Unable to reset password for new agent',
    customer: 'Zenith Travels',
    product: 'AOS',
    category: 'AOS-General Support',
    status: 'Pending',
    assignedTo: 'Subin Suresh',
    reportedDate: '2025-05-08T09:05:00Z',
  }),
  seed({
    caseId: 'CAS-2025-00107',
    description: 'Productivity suite crashing on report generation',
    customer: 'Nomad Bookings',
    product: 'Productivity suite',
    category: 'Other Support Cases',
    status: 'InProgress',
    assignedTo: 'Priya Menon',
    reportedDate: '2025-05-07T16:00:00Z',
  }),
  seed({
    caseId: 'CAS-2025-00106',
    description: 'Gulf QC Neo validation errors on submit',
    customer: 'Skyline Tours',
    product: 'Gulf QC Neo',
    category: 'AOS Dev BUG',
    status: 'Resolved',
    assignedTo: 'Neeraj Sharma',
    reportedDate: '2025-05-07T13:20:00Z',
  }),
  seed({
    caseId: 'CAS-2025-00105',
    description: 'General support request for onboarding',
    customer: 'BlueSky Holidays',
    product: 'AOS',
    category: 'AOS-General Support',
    status: 'Open',
    assignedTo: 'Arjun Nair',
    reportedDate: '2025-05-07T10:45:00Z',
  }),
  seed({
    caseId: 'CAS-2025-00104',
    description: 'CLC sync delayed by several hours',
    customer: 'Continental Travels',
    product: 'CLC',
    category: 'Other Support Cases',
    status: 'Pending',
    assignedTo: 'Fatima Al Sayed',
    reportedDate: '2025-05-07T09:30:00Z',
  }),
  seed({
    caseId: 'CAS-2025-00103',
    description: 'AOS query cases piling up unassigned',
    customer: 'Travco LLC',
    product: 'AOS',
    category: 'AOS-Queries',
    status: 'InProgress',
    assignedTo: 'Subin Suresh',
    reportedDate: '2025-05-07T08:50:00Z',
  }),
  seed({
    caseId: 'CAS-2025-00102',
    description: 'Profiles not saving default preferences',
    customer: 'Weefly',
    product: 'Profiles',
    category: 'Other Support Cases',
    status: 'Resolved',
    assignedTo: 'Priya Menon',
    reportedDate: '2025-05-07T08:10:00Z',
  }),
  seed({
    caseId: 'CAS-2025-00101',
    description: 'OC implementation kickoff request',
    customer: 'Zenith Travels',
    product: 'AOS',
    category: 'AOS-General Support',
    status: 'Open',
    assignedTo: 'Neeraj Sharma',
    type: 'Implementation',
    reportedDate: '2025-05-07T07:45:00Z',
  }),
];

let demoSeq = SEED_CASES.length + 101;
let mockActivitySeq = 0;

// Mirrors the backend's `_FIELD_LABELS` (app/cases/service.py) so mock-mode
// activity diffing reads the same as the real API — plan §12/T12.2.
const MOCK_FIELD_LABELS: Partial<Record<keyof UpdateCaseInput, string>> = {
  customer: 'Customer',
  product: 'Product',
  category: 'Category',
  description: 'Description',
  market: 'Market',
  type: 'Imp/Supp',
  reporterType: 'Reported By Type',
  reporterName: 'Reported By Name',
  remarks: 'Remarks',
  resolution: 'Resolution',
  bugNumber: 'Bug Number',
  taskNumbers: 'Task Numbers',
  workOrderNumbers: 'WO Numbers',
};

@Injectable({ providedIn: 'root' })
export class CaseService {
  private readonly http = inject(HttpClient);
  private readonly authService = inject(AuthService);
  private readonly mockMode = environment.useMockAuth;

  // TEMPORARY (prototype-only): in-memory case store used while useMockAuth
  // is on, so the UI is fully clickable without a running API/MongoDB.
  private readonly mockCases$ = new BehaviorSubject<Case[]>(
    SEED_CASES.map((c, i) => ({ ...c, id: `mock-${i}` })),
  );

  // TEMPORARY (prototype-only): in-memory activity log, keyed by case id —
  // mirrors the real `activity_log` collection for mock mode (plan §12).
  private readonly mockActivity$ = new BehaviorSubject<Record<string, CaseActivityEntry[]>>({});

  // Real mode has no live/streaming query the way the old Firestore version
  // did — this trigger makes list()/getById() refetch after any write, so
  // the UI still feels reactive across components without a state library.
  private readonly refresh$ = new BehaviorSubject<void>(undefined);

  private currentUserSummary(): UserSummary {
    let summary: UserSummary = { id: 'demo-user', name: 'Demo User', email: '' };
    this.authService.currentUser$.pipe(take(1)).subscribe((u) => {
      if (u) {
        summary = { id: u.uid, name: u.displayName ?? 'Demo User', email: u.email ?? '' };
      }
    });
    return summary;
  }

  private logMockActivity(caseId: string, changeSummary: string, entryType: 'system' | 'comment' = 'system') {
    const entry: CaseActivityEntry = {
      id: `mock-activity-${mockActivitySeq++}`,
      caseId,
      user: this.currentUserSummary(),
      entryType,
      changeSummary,
      createdAt: new Date().toISOString(),
    };
    const all = this.mockActivity$.value;
    this.mockActivity$.next({ ...all, [caseId]: [...(all[caseId] ?? []), entry] });
  }

  /** Server-side paginated/filtered list (plan T2.8) — the case volume after
   * the Phase 5 Excel migration (3000+ real cases) made client-side
   * pagination over a single capped fetch actively misleading. */
  list(params: CaseListParams): Observable<CaseListResponse> {
    if (this.mockMode) {
      return this.mockCases$.pipe(
        map((cases) => {
          const statuses = params.status ? params.status.split(',') : null;
          const types = params.type ? params.type.split(',') : null;
          const term = params.search?.trim().toLowerCase();
          const filtered = cases
            .filter((c) => (statuses ? statuses.includes(c.status) : true))
            .filter((c) => (types ? types.includes(c.type) : true))
            .filter((c) => (params.assignedTo ? c.assignedTo.id === params.assignedTo : true))
            .filter((c) =>
              term
                ? c.description.toLowerCase().includes(term) ||
                  c.customer.toLowerCase().includes(term) ||
                  c.caseId.toLowerCase().includes(term)
                : true,
            )
            .sort((a, b) => new Date(b.reportedDate).getTime() - new Date(a.reportedDate).getTime());
          const start = (params.page - 1) * params.pageSize;
          return { items: filtered.slice(start, start + params.pageSize), total: filtered.length };
        }),
      );
    }
    return this.refresh$.pipe(
      switchMap(() =>
        this.http
          .get<CaseListResponse>(`${environment.apiUrl}/cases`, {
            params: {
              page: params.page,
              pageSize: params.pageSize,
              ...(params.status ? { status: params.status } : {}),
              ...(params.type ? { type: params.type } : {}),
              ...(params.search ? { search: params.search } : {}),
              ...(params.assignedTo ? { assignedTo: params.assignedTo } : {}),
            },
          })
          .pipe(catchError(() => of({ items: [], total: 0 } as CaseListResponse))),
      ),
    );
  }

  getById(id: string): Observable<Case | undefined> {
    if (this.mockMode) {
      return this.mockCases$.pipe(map((cases) => cases.find((c) => c.id === id)));
    }
    return this.refresh$.pipe(
      switchMap(() =>
        this.http.get<Case>(`${environment.apiUrl}/cases/${id}`).pipe(catchError(() => of(undefined))),
      ),
    );
  }

  async create(input: CreateCaseInput): Promise<string> {
    if (this.mockMode) {
      const caseId = `CASE-2026-${String(demoSeq++).padStart(6, '0')}`;
      const now = new Date().toISOString();
      const assignedTo = MOCK_USERS.find((u) => u.id === input.assignedTo) ?? MOCK_USERS[0];
      const newCase: Case = {
        id: `mock-new-${Date.now()}`,
        caseId,
        reportedDate: input.reportedDate,
        reporterType: input.reporterType,
        reporterName: input.reporterName,
        customer: input.customer,
        product: input.product,
        category: input.category,
        description: input.description,
        assignedTo,
        status: input.status,
        type: input.type,
        market: '',
        remarks: '',
        resolution: '',
        bugNumber: null,
        taskNumbers: [],
        workOrderNumbers: [],
        dateOfClosure: input.status === 'Resolved' ? now : null,
        linkedImplementationId: null,
        createdBy: assignedTo,
        updatedBy: assignedTo,
        createdAt: now,
        updatedAt: now,
      };
      this.mockCases$.next([newCase, ...this.mockCases$.value]);
      this.logMockActivity(newCase.id, `Case created and assigned to ${assignedTo.name}`);
      return newCase.id;
    }

    const created = await firstValueFrom(this.http.post<Case>(`${environment.apiUrl}/cases`, input));
    this.refresh$.next();
    return created.id;
  }

  async update(id: string, patch: UpdateCaseInput): Promise<void> {
    if (this.mockMode) {
      const existing = this.mockCases$.value.find((c) => c.id === id);
      this.mockCases$.next(
        this.mockCases$.value.map((c) => {
          if (c.id !== id) {
            return c;
          }
          const assignedTo = patch.assignedTo
            ? (MOCK_USERS.find((u) => u.id === patch.assignedTo) ?? c.assignedTo)
            : c.assignedTo;
          const now = new Date().toISOString();
          const wasClosed = c.status === 'Resolved';
          const isClosed = (patch.status ?? c.status) === 'Resolved';
          return {
            ...c,
            ...patch,
            assignedTo,
            dateOfClosure: isClosed && !wasClosed ? now : !isClosed ? null : c.dateOfClosure,
            updatedAt: now,
          };
        }),
      );
      if (existing) {
        this.logMockUpdateDiff(existing, patch);
      }
      return;
    }

    await firstValueFrom(this.http.patch<Case>(`${environment.apiUrl}/cases/${id}`, patch));
    this.refresh$.next();
  }

  /** One activity entry per changed field — mirrors the backend's
   * `_log_update_diff()` (app/cases/service.py) for mock mode. */
  private logMockUpdateDiff(existing: Case, patch: UpdateCaseInput) {
    for (const [field, newValue] of Object.entries(patch) as [keyof UpdateCaseInput, unknown][]) {
      const oldValue = (existing as unknown as Record<string, unknown>)[field];
      if (JSON.stringify(oldValue) === JSON.stringify(newValue)) {
        continue;
      }
      if (field === 'status') {
        this.logMockActivity(existing.id, `Status changed from ${existing.status} to ${newValue}`);
      } else if (field === 'assignedTo') {
        const assignee = MOCK_USERS.find((u) => u.id === newValue);
        this.logMockActivity(existing.id, `Reassigned to ${assignee ? assignee.name : 'Unknown User'}`);
      } else if (MOCK_FIELD_LABELS[field]) {
        this.logMockActivity(existing.id, `${MOCK_FIELD_LABELS[field]} updated`);
      }
    }
  }

  /** Newest first, same ordering as the real API — plan §12/T12.3. */
  listActivity(caseId: string): Observable<CaseActivityEntry[]> {
    if (this.mockMode) {
      return this.mockActivity$.pipe(
        map((all) =>
          (all[caseId] ?? [])
            .slice()
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
        ),
      );
    }
    return this.refresh$.pipe(
      switchMap(() =>
        this.http
          .get<CaseActivityEntry[]>(`${environment.apiUrl}/cases/${caseId}/activity`)
          .pipe(catchError(() => of([] as CaseActivityEntry[]))),
      ),
    );
  }

  async postComment(caseId: string, message: string): Promise<void> {
    if (this.mockMode) {
      this.logMockActivity(caseId, message, 'comment');
      return;
    }
    await firstValueFrom(
      this.http.post<CaseActivityEntry>(`${environment.apiUrl}/cases/${caseId}/activity`, { message }),
    );
    this.refresh$.next();
  }

  /** Soft delete, user-requested after using the app — the case disappears
   * from list()/getById() but the backend never physically removes it. */
  async delete(id: string): Promise<void> {
    if (this.mockMode) {
      this.mockCases$.next(this.mockCases$.value.filter((c) => c.id !== id));
      return;
    }
    await firstValueFrom(this.http.delete<void>(`${environment.apiUrl}/cases/${id}`));
    this.refresh$.next();
  }
}
