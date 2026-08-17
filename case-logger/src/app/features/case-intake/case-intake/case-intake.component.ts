import { Component, effect, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { CaseService } from '../../../core/services/case.service';
import { AdminUser, UsersService } from '../../../core/services/users.service';
import { ReferenceDataService } from '../../../core/services/reference-data.service';
import { CaseStatus, CaseType, ReporterType } from '../../../core/models/case.model';
import { ReferenceItem } from '../../../core/models/reference-item.model';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { SpinnerComponent } from '../../../shared/components/spinner/spinner.component';
import { SelectComponent } from '../../../shared/components/select/select.component';
import { DatePickerComponent } from '../../../shared/components/date-picker/date-picker.component';
import { ToastService } from '../../../core/services/toast.service';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function toIsoDateTime(dateInput: string): string {
  return new Date(`${dateInput}T00:00:00`).toISOString();
}

@Component({
  selector: 'app-case-intake',
  imports: [ReactiveFormsModule, IconComponent, SpinnerComponent, SelectComponent, DatePickerComponent],
  templateUrl: './case-intake.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './case-intake.component.scss',
})
export class CaseIntakeComponent {
  private readonly fb = inject(FormBuilder);
  private readonly caseService = inject(CaseService);
  private readonly usersService = inject(UsersService);
  private readonly referenceData = inject(ReferenceDataService);
  private readonly activeModal = inject(NgbActiveModal);
  private readonly toast = inject(ToastService);

  private readonly allReferenceItems = toSignal(this.referenceData.list(undefined, true), {
    initialValue: [] as ReferenceItem[],
  });

  readonly categories = () => this.allReferenceItems().filter((i) => i.kind === 'category');
  readonly products = () => this.allReferenceItems().filter((i) => i.kind === 'product');
  readonly statuses = () => this.allReferenceItems().filter((i) => i.kind === 'status');
  readonly types = () => this.allReferenceItems().filter((i) => i.kind === 'type');

  readonly categoryOptions = () => this.categories().map((c) => ({ value: c.value, label: c.name }));
  readonly productOptions = () => this.products().map((p) => ({ value: p.value, label: p.name }));
  readonly userOptions = () => this.users().map((u) => ({ value: u.id, label: u.name }));

  readonly users = toSignal(this.usersService.list(), { initialValue: [] as AdminUser[] });
  readonly submitting = signal(false);

  readonly reporterTypes: ReporterType[] = ['Customer', 'Internal'];

  readonly form = this.fb.nonNullable.group({
    reportedDate: [todayIso(), Validators.required],
    reporterType: ['Customer' as ReporterType, Validators.required],
    reporterName: ['', Validators.required],
    customer: ['', Validators.required],
    product: ['', Validators.required],
    description: ['', Validators.required],
    category: ['', Validators.required],
    assignedTo: ['', Validators.required],
    status: ['' as CaseStatus | '', Validators.required],
    type: ['' as CaseType | '', Validators.required],
  });

  constructor() {
    // Pre-select the first option once each list loads.
    effect(() => {
      const users = this.users();
      if (users.length > 0 && !this.form.controls.assignedTo.value) {
        this.form.controls.assignedTo.setValue(users[0].id);
      }
    });
    effect(() => {
      const statuses = this.statuses();
      if (statuses.length > 0 && !this.form.controls.status.value) {
        this.form.controls.status.setValue(statuses[0].value as CaseStatus);
      }
      const types = this.types();
      if (types.length > 0 && !this.form.controls.type.value) {
        this.form.controls.type.setValue(types[0].value as CaseType);
      }
    });
  }

  close() {
    this.activeModal.dismiss();
  }

  async submit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    const value = this.form.getRawValue();

    try {
      const id = await this.caseService.create({
        reportedDate: toIsoDateTime(value.reportedDate),
        reporterType: value.reporterType,
        reporterName: value.reporterName,
        customer: value.customer,
        product: value.product,
        description: value.description,
        category: value.category,
        assignedTo: value.assignedTo,
        status: value.status as CaseStatus,
        type: value.type as CaseType,
      });
      this.toast.success('Case created.');
      this.activeModal.close(id);
    } catch {
      this.toast.error('Could not create the case — try again.');
    } finally {
      this.submitting.set(false);
    }
  }
}
