import { Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { DecimalPipe } from '@angular/common';
import { forkJoin, map, switchMap } from 'rxjs';
import { DonutChartComponent, DonutSegment } from '../../shared/components/charts/donut-chart.component';
import { LineChartComponent, LineSeries } from '../../shared/components/charts/line-chart.component';
import { BarChartComponent } from '../../shared/components/charts/bar-chart.component';
import { MonthlyReport, ReportsService, TeamWorkloadRow } from '../../core/services/reports.service';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { MonthPickerComponent } from '../../shared/components/month-picker/month-picker.component';

type ReportView = 'monthly' | 'case-volume' | 'workload' | 'category-product' | 'team-workload';

const VIEW_TITLES: Record<ReportView, string> = {
  monthly: 'Monthly Dashboard',
  'case-volume': 'Case Volume',
  workload: 'Workload',
  'category-product': 'Category & Product',
  'team-workload': 'Team Workload',
};

// First month with real migrated case data (plan Phase 5). The multi-month
// trend/matrix sections below are computed live from /reports/monthly and
// /reports/team-workload for every month from here through whichever month
// is selected — no more hard-coded historical arrays.
const HISTORY_START = '2026-01';

interface MonthTrendRow {
  month: string;
  label: string;
  totalCases: number;
  aosCases: number;
  pending: number;
  closeRate: number;
  implClosed: number;
  deactivations: number;
  momChange: string;
  pendingPct: number;
}

interface TeamMonthRow {
  member: string;
  months: number[];
  total: number;
}

const EMPTY_REPORT: MonthlyReport = {
  month: '',
  totalCases: 0,
  aosCases: 0,
  aosShare: 0,
  pending: 0,
  closeRate: 0,
  implClosed: 0,
  deactivations: 0,
  pendingPct: 0,
  categoryMix: [],
  productMix: [],
};

function currentMonthStr(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function previousMonthStr(month: string): string {
  const [year, mon] = month.split('-').map(Number);
  const prevDate = new Date(Date.UTC(year, mon - 2, 1));
  return `${prevDate.getUTCFullYear()}-${String(prevDate.getUTCMonth() + 1).padStart(2, '0')}`;
}

function formatMonthLabel(month: string): string {
  if (!month) return '';
  const [year, mon] = month.split('-').map(Number);
  return new Date(Date.UTC(year, mon - 1, 1)).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function formatMonthShort(month: string): string {
  const [year, mon] = month.split('-').map(Number);
  return new Date(Date.UTC(year, mon - 1, 1)).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
}

function formatDelta(current: number, previous: number, suffix: string): string {
  if (previous === 0) return '-';
  const diff = current - previous;
  const sign = diff > 0 ? '+' : '';
  return `${sign}${diff.toFixed(1)}${suffix}`;
}

/** Inclusive "YYYY-MM" range from `start` through `end`. */
function monthRange(start: string, end: string): string[] {
  const [startY, startM] = start.split('-').map(Number);
  const [endY, endM] = end.split('-').map(Number);
  const months: string[] = [];
  let y = startY;
  let m = startM;
  while (y < endY || (y === endY && m <= endM)) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return months;
}

function pivotTeamHistory(monthly: TeamWorkloadRow[][]): TeamMonthRow[] {
  const members = new Set<string>();
  monthly.forEach((rows) => rows.forEach((r) => members.add(r.member)));
  return Array.from(members)
    .map((member) => {
      const months = monthly.map((rows) => rows.find((r) => r.member === member)?.assigned ?? 0);
      return { member, months, total: months.reduce((a, b) => a + b, 0) };
    })
    .sort((a, b) => b.total - a.total);
}

@Component({
  selector: 'app-reports',
  imports: [DecimalPipe, IconComponent, DonutChartComponent, LineChartComponent, BarChartComponent, MonthPickerComponent],
  templateUrl: './reports.component.html',
  styleUrl: './reports.component.scss',
})
export class ReportsComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly reportsService = inject(ReportsService);

  readonly view = toSignal(
    this.route.paramMap.pipe(map((params) => (params.get('view') as ReportView) ?? 'monthly')),
    { initialValue: 'monthly' as ReportView },
  );

  readonly pageTitle = computed(() => `Support Case Analysis — ${VIEW_TITLES[this.view()]}`);

  readonly historyStart = HISTORY_START;
  readonly historyStartLabel = formatMonthLabel(HISTORY_START);

  readonly selectedMonth = signal(currentMonthStr());
  readonly selectedMonthLabel = computed(() => formatMonthLabel(this.selectedMonth()));

  private readonly previousMonth = computed(() => previousMonthStr(this.selectedMonth()));

  readonly liveReport = toSignal(
    toObservable(this.selectedMonth).pipe(switchMap((month) => this.reportsService.getMonthly(month))),
    { initialValue: EMPTY_REPORT },
  );

  readonly previousReport = toSignal(
    toObservable(this.previousMonth).pipe(switchMap((month) => this.reportsService.getMonthly(month))),
    { initialValue: EMPTY_REPORT },
  );

  readonly liveWorkload = toSignal(
    toObservable(this.selectedMonth).pipe(switchMap((month) => this.reportsService.getTeamWorkload(month))),
    { initialValue: [] as TeamWorkloadRow[] },
  );

  readonly totalCasesDelta = computed(() => {
    const previous = this.previousReport().totalCases;
    if (previous === 0) return '-';
    const pct = ((this.liveReport().totalCases - previous) / previous) * 100;
    const sign = pct > 0 ? '+' : '';
    return `${sign}${pct.toFixed(1)}%`;
  });

  readonly aosShareDelta = computed(() => formatDelta(this.liveReport().aosShare, this.previousReport().aosShare, ' pp'));
  readonly closeRateDelta = computed(() => formatDelta(this.liveReport().closeRate, this.previousReport().closeRate, ' pp'));
  readonly pendingDelta = computed(() => {
    const diff = this.liveReport().pending - this.previousReport().pending;
    const sign = diff > 0 ? '+' : '';
    return `${sign}${diff}`;
  });

  readonly statusDonut = computed<DonutSegment[]>(() => {
    const report = this.liveReport();
    const closed = Math.round((report.closeRate / 100) * report.totalCases);
    return [
      { label: 'Closed', value: closed, color: 'var(--status-good)' },
      { label: 'Pending', value: report.pending, color: 'var(--status-warning)' },
    ];
  });

  // --- Multi-month trend (live, Jan 2026 through the selected month) ---
  private readonly historyMonths = computed(() => monthRange(HISTORY_START, this.selectedMonth()));

  private readonly historyReports = toSignal(
    toObservable(this.historyMonths).pipe(
      switchMap((months) => forkJoin(months.map((m) => this.reportsService.getMonthly(m)))),
    ),
    { initialValue: [] as MonthlyReport[] },
  );

  private readonly historyTeamWorkload = toSignal(
    toObservable(this.historyMonths).pipe(
      switchMap((months) => forkJoin(months.map((m) => this.reportsService.getTeamWorkload(m)))),
    ),
    { initialValue: [] as TeamWorkloadRow[][] },
  );

  readonly months = computed<MonthTrendRow[]>(() => {
    const reports = this.historyReports();
    return reports.map((r, i): MonthTrendRow => {
      const prevTotal = i > 0 ? reports[i - 1].totalCases : 0;
      const momChange = i === 0 || prevTotal === 0 ? '-' : `${(((r.totalCases - prevTotal) / prevTotal) * 100).toFixed(1)}%`;
      return {
        month: r.month,
        label: formatMonthShort(r.month),
        totalCases: r.totalCases,
        aosCases: r.aosCases,
        pending: r.pending,
        closeRate: r.closeRate,
        implClosed: r.implClosed,
        deactivations: r.deactivations,
        momChange,
        pendingPct: r.pendingPct,
      };
    });
  });

  readonly teamWorkload = computed(() => pivotTeamHistory(this.historyTeamWorkload()));
  readonly teamMonths = computed(() => this.historyMonths().map(formatMonthShort));
  readonly teamMonthTotals = computed(() => this.historyReports().map((r) => r.totalCases));
  readonly teamGrandTotal = computed(() => this.teamMonthTotals().reduce((a, b) => a + b, 0));

  readonly totalCasesTrend = computed(() => this.months().map((m) => m.totalCases));
  readonly closeRateTrend = computed<LineSeries[]>(() => [
    { name: 'Close Rate %', color: 'var(--series-aqua)', values: this.months().map((m) => Math.round(m.closeRate)) },
  ]);
  readonly monthLabels = computed(() => this.months().map((m) => m.label));
}
