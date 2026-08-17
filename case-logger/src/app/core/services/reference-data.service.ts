import { Injectable, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, catchError, firstValueFrom, map, of, switchMap } from 'rxjs';
import { ReferenceItem, ReferenceKind, ReferenceTone } from '../models/reference-item.model';
import { CaseReferenceType } from '../models/case.model';
import { BadgeTone } from '../../shared/components/badge/badge.component';
import { environment } from '../../../environments/environment';

export interface ReferenceItemInput {
  kind: ReferenceKind;
  name: string;
  value: string;
  active?: boolean;
  order?: number;
  tone?: ReferenceTone | null;
  closesCase?: boolean | null;
  allowedReferenceTypes?: CaseReferenceType[] | null;
}

export interface ReferenceItemPatch {
  name?: string;
  value?: string;
  active?: boolean;
  order?: number;
  tone?: ReferenceTone | null;
  closesCase?: boolean | null;
  allowedReferenceTypes?: CaseReferenceType[] | null;
}

const ALL_REFERENCE_TYPES: CaseReferenceType[] = ['Bug', 'Task', 'Workorder'];

// TEMPORARY (prototype-only): mirrors the real API's seed script
// (api/scripts/seed_reference_data.py) so mock mode's Admin Panel and
// Create Case dropdowns behave the same as the real backend.
let mockSeq = 0;
function mockItem(
  kind: ReferenceKind,
  name: string,
  order: number,
  extra: Partial<ReferenceItem> = {},
): ReferenceItem {
  const now = new Date().toISOString();
  return {
    id: `mock-ref-${kind}-${mockSeq++}`,
    kind,
    name,
    value: extra.value ?? name,
    active: true,
    order,
    tone: extra.tone ?? null,
    closesCase: extra.closesCase ?? null,
    allowedReferenceTypes: extra.allowedReferenceTypes ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

const MOCK_REFERENCE_ITEMS: ReferenceItem[] = [
  mockItem('status', 'Open', 0, { value: 'Open', tone: 'info', closesCase: false }),
  mockItem('status', 'In Progress', 1, { value: 'InProgress', tone: 'progress', closesCase: false }),
  mockItem('status', 'Pending', 2, { value: 'Pending', tone: 'warning', closesCase: false }),
  mockItem('status', 'Resolved', 3, { value: 'Resolved', tone: 'good', closesCase: true }),

  mockItem('type', 'Support', 0, { value: 'Support', tone: 'info' }),
  mockItem('type', 'Implementation', 1, { value: 'Implementation', tone: 'progress' }),
  mockItem('type', 'Deactivation', 2, { value: 'Deactivation', tone: 'serious' }),
  mockItem('type', 'Escalation', 3, { value: 'Escalation', tone: 'critical' }),

  // "Other Support Cases" only offers Workorder (plan §12/T12.7); every
  // other category defaults to all three (allowedReferenceTypes: null).
  mockItem('category', 'Other Support Cases', 0, { allowedReferenceTypes: ['Workorder'] }),
  ...[
    'AOS-Queries',
    'AOS Dev BUG',
    'AOS-General Support',
    'AOS-How to do',
    'AOS-Customer Config Mismatch',
    'AOS-Training',
    'AOS-Task',
    'AOS-Payment Gateway',
    'AOS-Ticket Pending',
    'AOS-User Deactivated',
  ].map((name, i) => mockItem('category', name, i + 1)),

  ...['AOS', 'AQC', 'CDSR', 'FO', 'MPE', 'RPP', 'AVH'].map((name, i) => mockItem('product', name, i)),

  ...['UAE', 'Saudi Arabia', 'Nigeria', 'Kenya', 'Egypt', 'Qatar', 'Oman'].map((name, i) =>
    mockItem('market', name, i),
  ),
];

@Injectable({ providedIn: 'root' })
export class ReferenceDataService {
  private readonly http = inject(HttpClient);
  private readonly mockMode = environment.useMockAuth;

  private readonly mockItems$ = new BehaviorSubject<ReferenceItem[]>(MOCK_REFERENCE_ITEMS);
  private readonly refresh$ = new BehaviorSubject<void>(undefined);

  private readonly all$: Observable<ReferenceItem[]> = this.mockMode
    ? this.mockItems$.asObservable()
    : this.refresh$.pipe(
        switchMap(() =>
          this.http
            .get<ReferenceItem[]>(`${environment.apiUrl}/reference-data`)
            .pipe(catchError(() => of([]))),
        ),
      );

  // Cached synchronous snapshot — backs the tone/label lookup methods below,
  // which components call as plain functions in templates (matches the
  // existing statusTone()/typeTone() call pattern from case-display.util.ts).
  private readonly snapshot = toSignal(this.all$, { initialValue: [] as ReferenceItem[] });

  list(kind?: ReferenceKind, activeOnly = false): Observable<ReferenceItem[]> {
    return this.all$.pipe(
      map((items) =>
        items
          .filter((i) => (kind ? i.kind === kind : true))
          .filter((i) => (activeOnly ? i.active : true))
          .sort((a, b) => a.order - b.order),
      ),
    );
  }

  async create(input: ReferenceItemInput): Promise<ReferenceItem> {
    if (this.mockMode) {
      const item = mockItem(input.kind, input.name, input.order ?? 0, {
        value: input.value,
        tone: input.tone ?? null,
        closesCase: input.closesCase ?? null,
        allowedReferenceTypes: input.allowedReferenceTypes ?? null,
      });
      this.mockItems$.next([...this.mockItems$.value, item]);
      return item;
    }
    const created = await firstValueFrom(
      this.http.post<ReferenceItem>(`${environment.apiUrl}/reference-data`, input),
    );
    this.refresh$.next();
    return created;
  }

  async update(id: string, patch: ReferenceItemPatch): Promise<ReferenceItem> {
    if (this.mockMode) {
      let updated: ReferenceItem | undefined;
      this.mockItems$.next(
        this.mockItems$.value.map((item) => {
          if (item.id !== id) {
            return item;
          }
          updated = { ...item, ...patch, updatedAt: new Date().toISOString() };
          return updated;
        }),
      );
      return updated!;
    }
    const result = await firstValueFrom(
      this.http.patch<ReferenceItem>(`${environment.apiUrl}/reference-data/${id}`, patch),
    );
    this.refresh$.next();
    return result;
  }

  async delete(id: string): Promise<void> {
    if (this.mockMode) {
      this.mockItems$.next(this.mockItems$.value.filter((item) => item.id !== id));
      return;
    }
    await firstValueFrom(this.http.delete<void>(`${environment.apiUrl}/reference-data/${id}`));
    this.refresh$.next();
  }

  // --- Synchronous badge tone/label helpers, with a hardcoded fallback so
  // badges render sensibly even before reference data has loaded. ---

  statusLabel(value: string): string {
    return this.snapshot().find((i) => i.kind === 'status' && i.value === value)?.name ?? value;
  }

  statusTone(value: string): BadgeTone {
    const fromData = this.snapshot().find((i) => i.kind === 'status' && i.value === value)?.tone;
    return (fromData ?? FALLBACK_STATUS_TONE[value] ?? 'info') as BadgeTone;
  }

  typeTone(value: string): BadgeTone {
    const fromData = this.snapshot().find((i) => i.kind === 'type' && i.value === value)?.tone;
    return (fromData ?? FALLBACK_TYPE_TONE[value] ?? 'info') as BadgeTone;
  }

  typeLabel(value: string): string {
    return this.snapshot().find((i) => i.kind === 'type' && i.value === value)?.name ?? value;
  }

  /** Which of Bug/Task/Workorder a case in this category may reference
   * (plan §12/T12.7) — null on the category ReferenceItem means all three. */
  allowedReferenceTypes(categoryValue: string): CaseReferenceType[] {
    const category = this.snapshot().find((i) => i.kind === 'category' && i.value === categoryValue);
    return category?.allowedReferenceTypes ?? ALL_REFERENCE_TYPES;
  }
}

const FALLBACK_STATUS_TONE: Record<string, BadgeTone> = {
  Open: 'info',
  InProgress: 'progress',
  Pending: 'warning',
  Resolved: 'good',
};

const FALLBACK_TYPE_TONE: Record<string, BadgeTone> = {
  Support: 'info',
  Implementation: 'progress',
  Deactivation: 'serious',
  Escalation: 'critical',
};
