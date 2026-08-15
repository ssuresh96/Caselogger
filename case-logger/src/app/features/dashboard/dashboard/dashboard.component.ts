import { Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { combineLatest, map, switchMap, tap } from 'rxjs';
import { CaseService } from '../../../core/services/case.service';
import { AuthService } from '../../../core/services/auth.service';
import { CaseDialogService } from '../../../core/services/case-dialog.service';
import { ReferenceDataService } from '../../../core/services/reference-data.service';
import { BadgeComponent } from '../../../shared/components/badge/badge.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { SpinnerComponent } from '../../../shared/components/spinner/spinner.component';
import { LineChartComponent, LineSeries } from '../../../shared/components/charts/line-chart.component';
import { DonutChartComponent, DonutSegment } from '../../../shared/components/charts/donut-chart.component';
import { Case, CaseType } from '../../../core/models/case.model';

// Number of independent data sources the dashboard waits on before it stops
// showing the loading state — one per stat card/chart/table below (myOpen,
// allOpen, pending, resolved, typeDonut, recentCases).
const SOURCE_COUNT = 6;

// "Open" = not yet resolved — matches the statuses shown in the status filter
// dropdown minus "Resolved".
const OPEN_STATUSES = 'Open,InProgress,Pending';
const CASE_TYPES: CaseType[] = ['Support', 'Implementation', 'Deactivation', 'Escalation'];
const TYPE_COLORS: Record<CaseType, string> = {
  Support: 'var(--series-blue)',
  Implementation: 'var(--series-orange)',
  Deactivation: 'var(--series-aqua)',
  Escalation: 'var(--series-yellow)',
};

@Component({
  selector: 'app-dashboard',
  imports: [
    RouterLink,
    DatePipe,
    IconComponent,
    SpinnerComponent,
    BadgeComponent,
    LineChartComponent,
    DonutChartComponent,
  ],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent {
  private readonly caseService = inject(CaseService);
  private readonly authService = inject(AuthService);
  private readonly caseDialogService = inject(CaseDialogService);
  readonly referenceData = inject(ReferenceDataService);

  readonly currentUser = toSignal(this.authService.currentUser$, { initialValue: null });

  readonly firstName = computed(() => this.currentUser()?.displayName?.split(' ')[0] ?? 'there');

  // Counts as sources finish their first emission — once every source has
  // reported in, `loading` flips to false and stays there (a page refresh
  // is the only way back to a "loading" dashboard, so this doesn't need to
  // reset).
  private readonly loadedSourceCount = signal(0);
  readonly loading = computed(() => this.loadedSourceCount() < SOURCE_COUNT);
  private markSourceLoaded() {
    this.loadedSourceCount.update((count) => count + 1);
  }

  // Counts come from the paginated /cases endpoint's `total` field (a
  // pageSize:1 request just to read the count) rather than pulling case
  // rows client-side — after the Phase 5 migration there are 3000+ real
  // cases, far more than any single page can hold.
  readonly myOpenCount = toSignal(
    toObservable(this.currentUser).pipe(
      switchMap((user) =>
        user
          ? this.caseService
              .list({ page: 1, pageSize: 1, status: OPEN_STATUSES, assignedTo: user.uid })
              .pipe(map((r) => r.total))
          : [0],
      ),
      tap(() => this.markSourceLoaded()),
    ),
    { initialValue: 0 },
  );

  readonly allOpenCount = toSignal(
    this.caseService
      .list({ page: 1, pageSize: 1, status: OPEN_STATUSES })
      .pipe(map((r) => r.total), tap(() => this.markSourceLoaded())),
    { initialValue: 0 },
  );

  readonly pendingCount = toSignal(
    this.caseService
      .list({ page: 1, pageSize: 1, status: 'Pending' })
      .pipe(map((r) => r.total), tap(() => this.markSourceLoaded())),
    { initialValue: 0 },
  );

  readonly resolvedCount = toSignal(
    this.caseService
      .list({ page: 1, pageSize: 1, status: 'Resolved' })
      .pipe(map((r) => r.total), tap(() => this.markSourceLoaded())),
    { initialValue: 0 },
  );

  readonly typeDonut = toSignal(
    combineLatest(
      CASE_TYPES.map((type) =>
        this.caseService
          .list({ page: 1, pageSize: 1, status: OPEN_STATUSES, type })
          .pipe(map((r): DonutSegment => ({ label: type, value: r.total, color: TYPE_COLORS[type] }))),
      ),
    ).pipe(tap(() => this.markSourceLoaded())),
    { initialValue: CASE_TYPES.map((t) => ({ label: t, value: 0, color: TYPE_COLORS[t] })) },
  );

  readonly recentCases = toSignal(
    this.caseService
      .list({ page: 1, pageSize: 5 })
      .pipe(map((r) => r.items), tap(() => this.markSourceLoaded())),
    { initialValue: [] as Case[] },
  );

  // Kept as a static illustrative range (real per-day open/resolved
  // bucketing would need a dedicated backend endpoint, out of scope for
  // this pass — see plan notes).
  readonly caseOverviewLabels = ['Day -6', 'Day -5', 'Day -4', 'Day -3', 'Day -2', 'Day -1', 'Today'];
  readonly caseOverviewSeries: LineSeries[] = [
    { name: 'Opened', color: 'var(--series-blue)', values: [0, 0, 0, 0, 0, 0, 0] },
    { name: 'Resolved', color: 'var(--series-aqua)', values: [0, 0, 0, 0, 0, 0, 0] },
  ];

  openCreateCase() {
    this.caseDialogService.openCreateCase();
  }
}
