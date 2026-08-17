import { Component, computed, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { DatePipe } from '@angular/common';
import { NgbDropdownModule } from '@ng-bootstrap/ng-bootstrap';
import { combineLatest, debounceTime, distinctUntilChanged, map, switchMap, tap } from 'rxjs';
import { CaseListResponse, CaseService } from '../../../core/services/case.service';
import { AuthService } from '../../../core/services/auth.service';
import { CaseDialogService } from '../../../core/services/case-dialog.service';
import { ReferenceDataService } from '../../../core/services/reference-data.service';
import { AdminUser, UsersService } from '../../../core/services/users.service';
import { CaseStatus } from '../../../core/models/case.model';
import { BadgeComponent } from '../../../shared/components/badge/badge.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { SpinnerComponent } from '../../../shared/components/spinner/spinner.component';
import { ToastService } from '../../../core/services/toast.service';

const PAGE_SIZE = 20;
const EMPTY_RESPONSE: CaseListResponse = { items: [], total: 0 };

@Component({
  selector: 'app-case-list',
  imports: [DatePipe, IconComponent, SpinnerComponent, NgbDropdownModule, BadgeComponent],
  templateUrl: './case-list.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './case-list.component.scss',
})
export class CaseListComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly caseService = inject(CaseService);
  private readonly authService = inject(AuthService);
  private readonly caseDialogService = inject(CaseDialogService);
  private readonly usersService = inject(UsersService);
  private readonly toast = inject(ToastService);
  readonly referenceData = inject(ReferenceDataService);

  readonly scope = (this.route.snapshot.data['scope'] as 'mine' | 'all') ?? 'all';

  readonly currentUser = toSignal(this.authService.currentUser$, { initialValue: null });

  // "Assigned To" and "Product" dropdown options — Assigned To only matters
  // for the "All Cases" view (scope 'mine' is implicitly locked to self).
  readonly assignableUsers = toSignal(this.usersService.list(), { initialValue: [] as AdminUser[] });
  readonly productOptions = toSignal(
    this.referenceData.list('product', true).pipe(map((items) => items.map((i) => i.value))),
    { initialValue: [] as string[] },
  );

  readonly search = signal('');
  readonly statusFilter = signal<CaseStatus | 'all'>('all');
  readonly productFilter = signal<string>('all');
  readonly assignedToFilter = signal<string>('all');
  readonly reportedFrom = signal('');
  readonly reportedTo = signal('');
  readonly page = signal(1);

  readonly statusOptions: CaseStatus[] = ['Open', 'InProgress', 'Pending', 'Resolved'];

  private readonly search$ = toObservable(this.search).pipe(debounceTime(300), distinctUntilChanged());
  private readonly page$ = toObservable(this.page);
  private readonly status$ = toObservable(this.statusFilter);
  private readonly product$ = toObservable(this.productFilter);
  private readonly reportedFrom$ = toObservable(this.reportedFrom);
  private readonly reportedTo$ = toObservable(this.reportedTo);
  private readonly assignedTo$ = combineLatest([
    toObservable(this.currentUser),
    toObservable(this.assignedToFilter),
  ]).pipe(
    map(([user, filterValue]) =>
      this.scope === 'mine' ? (user?.uid ?? undefined) : filterValue === 'all' ? undefined : filterValue,
    ),
  );

  private readonly loadingSignal = signal(true);
  readonly loading = this.loadingSignal.asReadonly();

  private readonly response = toSignal(
    combineLatest([
      this.page$,
      this.status$,
      this.search$,
      this.assignedTo$,
      this.product$,
      this.reportedFrom$,
      this.reportedTo$,
    ]).pipe(
      tap(() => this.loadingSignal.set(true)),
      switchMap(([page, status, search, assignedTo, product, reportedFrom, reportedTo]) =>
        this.caseService
          .list({
            page,
            pageSize: PAGE_SIZE,
            status: status === 'all' ? undefined : status,
            search: search || undefined,
            assignedTo,
            product: product === 'all' ? undefined : product,
            reportedDateFrom: reportedFrom || undefined,
            reportedDateTo: reportedTo || undefined,
          })
          .pipe(tap(() => this.loadingSignal.set(false))),
      ),
    ),
    { initialValue: EMPTY_RESPONSE },
  );

  readonly pageCases = computed(() => this.response().items);
  readonly total = computed(() => this.response().total);
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / PAGE_SIZE)));

  readonly skeletonRows = [172, 132, 208, 116, 156, 148];
  readonly hasActiveFilters = computed(
    () =>
      this.search().trim().length > 0 ||
      this.statusFilter() !== 'all' ||
      this.productFilter() !== 'all' ||
      (this.scope === 'all' && this.assignedToFilter() !== 'all') ||
      this.reportedFrom() !== '' ||
      this.reportedTo() !== '',
  );

  clearFilters() {
    this.search.set('');
    this.statusFilter.set('all');
    this.productFilter.set('all');
    this.assignedToFilter.set('all');
    this.reportedFrom.set('');
    this.reportedTo.set('');
    this.page.set(1);
  }

  readonly rangeStart = computed(() => (this.total() === 0 ? 0 : (this.page() - 1) * PAGE_SIZE + 1));
  readonly rangeEnd = computed(() => Math.min(this.total(), (this.page() - 1) * PAGE_SIZE + PAGE_SIZE));

  // A window of page buttons around the current page — with 3000+ real
  // cases (169+ pages post-migration), listing every page number is unusable.
  readonly pageNumbers = computed(() => {
    const total = this.totalPages();
    const current = this.page();
    const windowSize = 5;
    let start = Math.max(1, current - Math.floor(windowSize / 2));
    const end = Math.min(total, start + windowSize - 1);
    start = Math.max(1, end - windowSize + 1);
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  });

  updateSearch(value: string) {
    this.search.set(value);
    this.page.set(1);
  }

  updateStatus(value: string) {
    this.statusFilter.set(value as CaseStatus | 'all');
    this.page.set(1);
  }

  updateProduct(value: string) {
    this.productFilter.set(value);
    this.page.set(1);
  }

  updateAssignedTo(value: string) {
    this.assignedToFilter.set(value);
    this.page.set(1);
  }

  updateReportedFrom(value: string) {
    this.reportedFrom.set(value);
    this.page.set(1);
  }

  updateReportedTo(value: string) {
    this.reportedTo.set(value);
    this.page.set(1);
  }

  goToPage(page: number) {
    this.page.set(page);
  }

  prevPage() {
    this.page.update((p) => Math.max(1, p - 1));
  }

  nextPage() {
    this.page.update((p) => Math.min(this.totalPages(), p + 1));
  }

  openCreateCase() {
    this.caseDialogService.openCreateCase();
  }

  editCase(id: string) {
    this.router.navigate(['/cases', id], { queryParams: { edit: '1' } });
  }

  async deleteCase(id: string, caseId: string) {
    const confirmed = await this.caseDialogService.confirmDeleteCase(caseId);
    if (!confirmed) {
      return;
    }
    try {
      await this.caseService.delete(id);
      this.toast.success(`${caseId} deleted.`);
    } catch {
      this.toast.error(`Could not delete ${caseId} — try again.`);
    }
  }
}
