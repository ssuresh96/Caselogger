import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface GraphSettings {
  tenantId: string;
  clientId: string;
  hasClientSecret: boolean;
  mailbox: string;
  updatedAt: string | null;
}

export interface GraphSettingsInput {
  tenantId: string;
  clientId: string;
  // Omitted/blank = leave the stored secret unchanged — see
  // app/email_agent/graph_settings.py's update_graph_settings().
  clientSecret?: string;
  mailbox: string;
}

// TEMPORARY: no useMockAuth branch, same rationale as ImportService — this
// is an admin-only settings form for a backend integration, not something
// the prototype's mock mode needs to simulate.
@Injectable({ providedIn: 'root' })
export class GraphSettingsService {
  private readonly http = inject(HttpClient);

  async get(): Promise<GraphSettings> {
    return firstValueFrom(
      this.http.get<GraphSettings>(`${environment.apiUrl}/admin/email-agent/graph-settings`),
    );
  }

  async update(input: GraphSettingsInput): Promise<GraphSettings> {
    return firstValueFrom(
      this.http.put<GraphSettings>(`${environment.apiUrl}/admin/email-agent/graph-settings`, input),
    );
  }
}
