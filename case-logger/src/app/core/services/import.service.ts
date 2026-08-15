import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface ImportRowError {
  row: number;
  reason: string;
}

export interface ImportResult {
  totalRows: number;
  imported: number;
  rejected: ImportRowError[];
}

// TEMPORARY: no useMockAuth branch here, unlike the rest of core/services —
// mocking an .xlsx round-trip (real file bytes in and out) needs a fake
// binary file, not fake in-memory data, so it isn't worth building for a
// prototype-only mode nothing in this project actually runs against.
@Injectable({ providedIn: 'root' })
export class ImportService {
  private readonly http = inject(HttpClient);

  async downloadTemplate(): Promise<void> {
    const blob = await firstValueFrom(
      this.http.get(`${environment.apiUrl}/admin/import/cases/template`, { responseType: 'blob' }),
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'case-import-template.xlsx';
    link.click();
    URL.revokeObjectURL(url);
  }

  async importCases(file: File): Promise<ImportResult> {
    const formData = new FormData();
    formData.append('file', file);
    return firstValueFrom(
      this.http.post<ImportResult>(`${environment.apiUrl}/admin/import/cases`, formData),
    );
  }
}
