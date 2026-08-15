import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, of } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface MixRow {
  label: string;
  cases: number;
  share: number;
}

export interface MonthlyReport {
  month: string;
  totalCases: number;
  aosCases: number;
  aosShare: number;
  pending: number;
  closeRate: number;
  implClosed: number;
  deactivations: number;
  pendingPct: number;
  categoryMix: MixRow[];
  productMix: MixRow[];
}

export interface TeamWorkloadRow {
  member: string;
  assigned: number;
  closed: number;
  pending: number;
  closeRate: number;
}

const EMPTY_REPORT = (month: string): MonthlyReport => ({
  month,
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
});

@Injectable({ providedIn: 'root' })
export class ReportsService {
  private readonly http = inject(HttpClient);

  getMonthly(month: string): Observable<MonthlyReport> {
    return this.http
      .get<MonthlyReport>(`${environment.apiUrl}/reports/monthly`, { params: { month } })
      .pipe(catchError(() => of(EMPTY_REPORT(month))));
  }

  getTeamWorkload(month: string): Observable<TeamWorkloadRow[]> {
    return this.http
      .get<TeamWorkloadRow[]>(`${environment.apiUrl}/reports/team-workload`, { params: { month } })
      .pipe(catchError(() => of([])));
  }
}
