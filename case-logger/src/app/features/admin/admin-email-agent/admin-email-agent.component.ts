import { Component, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { GraphSettings, GraphSettingsService } from '../../../core/services/graph-settings.service';
import { ToastService } from '../../../core/services/toast.service';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { SpinnerComponent } from '../../../shared/components/spinner/spinner.component';

@Component({
  selector: 'app-admin-email-agent',
  imports: [ReactiveFormsModule, IconComponent, SpinnerComponent, DatePipe],
  templateUrl: './admin-email-agent.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './admin-email-agent.component.scss',
})
export class AdminEmailAgentComponent {
  private readonly fb = inject(FormBuilder);
  private readonly graphSettingsService = inject(GraphSettingsService);
  private readonly toast = inject(ToastService);

  readonly loading = signal(true);
  readonly saving = signal(false);
  // The last value confirmed by the server — drives the read-only preview
  // table, kept separate from `form` so mid-edit changes never show there
  // until they're actually saved.
  readonly saved = signal<GraphSettings | null>(null);
  readonly errorMessage = signal('');

  readonly form = this.fb.nonNullable.group({
    tenantId: ['', Validators.required],
    clientId: ['', Validators.required],
    // Left blank = keep whatever secret is already stored — see
    // GraphSettingsInput's clientSecret doc.
    clientSecret: [''],
    mailbox: ['', [Validators.required, Validators.email]],
  });

  constructor() {
    this.load();
  }

  private async load() {
    this.loading.set(true);
    try {
      const settings = await this.graphSettingsService.get();
      this.form.patchValue({
        tenantId: settings.tenantId,
        clientId: settings.clientId,
        mailbox: settings.mailbox,
      });
      this.saved.set(settings);
    } catch {
      this.errorMessage.set('Could not load Graph API settings — try refreshing.');
    } finally {
      this.loading.set(false);
    }
  }

  async submit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    this.errorMessage.set('');
    try {
      const { tenantId, clientId, clientSecret, mailbox } = this.form.getRawValue();
      const updated = await this.graphSettingsService.update({
        tenantId,
        clientId,
        mailbox,
        ...(clientSecret ? { clientSecret } : {}),
      });
      this.saved.set(updated);
      this.form.patchValue({ clientSecret: '' });
      this.toast.success('Graph API settings saved.');
    } catch {
      this.errorMessage.set('Could not save — check the values and try again.');
      this.toast.error('Could not save Graph API settings.');
    } finally {
      this.saving.set(false);
    }
  }
}
