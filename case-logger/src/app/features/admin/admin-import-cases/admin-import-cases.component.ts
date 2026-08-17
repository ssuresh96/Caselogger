import { Component, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { ImportResult, ImportService } from '../../../core/services/import.service';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { SpinnerComponent } from '../../../shared/components/spinner/spinner.component';
import { ToastService } from '../../../core/services/toast.service';

@Component({
  selector: 'app-admin-import-cases',
  imports: [IconComponent, SpinnerComponent],
  templateUrl: './admin-import-cases.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './admin-import-cases.component.scss',
})
export class AdminImportCasesComponent {
  private readonly importService = inject(ImportService);
  private readonly toast = inject(ToastService);

  readonly downloadingTemplate = signal(false);
  readonly downloadErrorMessage = signal('');
  readonly selectedFile = signal<File | null>(null);
  readonly importing = signal(false);
  readonly result = signal<ImportResult | null>(null);
  readonly errorMessage = signal('');

  async downloadTemplate() {
    this.downloadingTemplate.set(true);
    this.downloadErrorMessage.set('');
    try {
      await this.importService.downloadTemplate();
      this.toast.success('Template downloaded — check your browser’s downloads.');
    } catch {
      this.downloadErrorMessage.set('Could not download the template — try again.');
      this.toast.error('Could not download the template — try again.');
    } finally {
      this.downloadingTemplate.set(false);
    }
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    this.selectedFile.set(input.files?.[0] ?? null);
    this.result.set(null);
    this.errorMessage.set('');
  }

  async submitImport() {
    const file = this.selectedFile();
    if (!file) {
      return;
    }
    this.importing.set(true);
    this.errorMessage.set('');
    this.result.set(null);
    try {
      const result = await this.importService.importCases(file);
      this.result.set(result);
    } catch {
      this.errorMessage.set('Import failed — check the file is a valid .xlsx and try again.');
    } finally {
      this.importing.set(false);
    }
  }
}
