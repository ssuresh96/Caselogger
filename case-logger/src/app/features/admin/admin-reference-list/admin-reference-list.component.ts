import { Component, computed, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { map } from 'rxjs';
import { ReferenceDataService } from '../../../core/services/reference-data.service';
import { ReferenceItem, ReferenceKind, ReferenceTone } from '../../../core/models/reference-item.model';
import { CaseReferenceType } from '../../../core/models/case.model';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { SpinnerComponent } from '../../../shared/components/spinner/spinner.component';
import { ToastService } from '../../../core/services/toast.service';
import {
  ConfirmDialogComponent,
  ConfirmDialogData,
} from '../../../shared/components/confirm-dialog/confirm-dialog.component';

const KIND_META: Record<ReferenceKind, { title: string; singular: string; hasToneAndClose: boolean }> = {
  category: { title: 'Categories', singular: 'Category', hasToneAndClose: false },
  product: { title: 'Products', singular: 'Product', hasToneAndClose: false },
  market: { title: 'Markets', singular: 'Market', hasToneAndClose: false },
  status: { title: 'Statuses', singular: 'Status', hasToneAndClose: true },
  type: { title: 'Types (Imp/Supp)', singular: 'Type', hasToneAndClose: true },
};

const TONES: ReferenceTone[] = ['info', 'progress', 'warning', 'serious', 'critical', 'good'];

@Component({
  selector: 'app-admin-reference-list',
  imports: [ReactiveFormsModule, IconComponent, SpinnerComponent],
  templateUrl: './admin-reference-list.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './admin-reference-list.component.scss',
})
export class AdminReferenceListComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly referenceData = inject(ReferenceDataService);
  private readonly fb = inject(FormBuilder);
  private readonly toast = inject(ToastService);
  private readonly modalService = inject(NgbModal);

  readonly deletingId = signal<string | null>(null);

  readonly tones = TONES;

  readonly kind = toSignal(
    this.route.paramMap.pipe(map((params) => (params.get('kind') as ReferenceKind) ?? 'category')),
    { initialValue: 'category' as ReferenceKind },
  );

  readonly meta = computed(() => KIND_META[this.kind()]);

  // Always the full current dataset; filtered client-side by `kind` so
  // switching tabs doesn't need a fresh HTTP round-trip.
  readonly allItems = toSignal(this.referenceData.list(), { initialValue: [] as ReferenceItem[] });

  readonly visibleItems = computed(() =>
    [...this.allItems()].filter((i) => i.kind === this.kind()).sort((a, b) => a.order - b.order),
  );

  readonly showAddForm = signal(false);
  readonly submitting = signal(false);

  readonly form = this.fb.nonNullable.group({
    name: ['', Validators.required],
    tone: ['info' as ReferenceTone],
    closesCase: [false],
    // Category only (plan §12/T12.7) — which of Bug/Task/Workorder a case
    // in this category may reference. All three checked = the default
    // (stored as null, not an explicit 3-item list — see submitAdd()).
    bugAllowed: [true],
    taskAllowed: [true],
    woAllowed: [true],
  });

  toggleAddForm() {
    this.showAddForm.update((v) => !v);
    this.form.reset({
      name: '',
      tone: 'info',
      closesCase: false,
      bugAllowed: true,
      taskAllowed: true,
      woAllowed: true,
    });
  }

  async submitAdd() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    const value = this.form.getRawValue();
    const nextOrder = this.visibleItems().length;
    try {
      await this.referenceData.create({
        kind: this.kind(),
        name: value.name,
        value: value.name,
        order: nextOrder,
        tone: this.meta().hasToneAndClose ? value.tone : null,
        closesCase: this.meta().hasToneAndClose && this.kind() === 'status' ? value.closesCase : null,
        allowedReferenceTypes: this.kind() === 'category' ? this.allowedTypesFromForm(value) : null,
      });
      this.showAddForm.set(false);
      this.toast.success(`${this.meta().singular} added.`);
    } catch {
      this.toast.error(`Could not add ${this.meta().singular.toLowerCase()} — try again.`);
    } finally {
      this.submitting.set(false);
    }
  }

  private allowedTypesFromForm(value: {
    bugAllowed: boolean;
    taskAllowed: boolean;
    woAllowed: boolean;
  }): CaseReferenceType[] | null {
    if (value.bugAllowed && value.taskAllowed && value.woAllowed) {
      return null; // all three = the default, stored as null (T12.7)
    }
    const types: CaseReferenceType[] = [];
    if (value.bugAllowed) types.push('Bug');
    if (value.taskAllowed) types.push('Task');
    if (value.woAllowed) types.push('Workorder');
    return types;
  }

  async toggleActive(item: ReferenceItem) {
    try {
      await this.referenceData.update(item.id, { active: !item.active });
      this.toast.success(`${item.name} is now ${item.active ? 'inactive' : 'active'}.`);
    } catch {
      this.toast.error(`Could not update ${item.name} — try again.`);
    }
  }

  async deleteItem(item: ReferenceItem) {
    const modalRef = this.modalService.open(ConfirmDialogComponent, { size: 'sm', centered: true });
    const data: ConfirmDialogData = {
      title: `Delete "${item.name}"?`,
      message: `This permanently removes it — there's no undo. Limited to 10 ${this.meta().title.toLowerCase()} deletes per day.`,
      confirmLabel: `Delete ${this.meta().singular}`,
      danger: true,
    };
    modalRef.componentInstance.data = data;
    let confirmed: boolean;
    try {
      confirmed = (await modalRef.result) === true;
    } catch {
      confirmed = false; // dismissed via backdrop/Escape — same as Cancel
    }
    if (!confirmed) {
      return;
    }

    this.deletingId.set(item.id);
    try {
      await this.referenceData.delete(item.id);
      this.toast.success(`${item.name} deleted.`);
    } catch (err) {
      if (err instanceof HttpErrorResponse && err.status === 429) {
        this.toast.error(`Daily delete limit reached for ${this.meta().title.toLowerCase()} — try again tomorrow.`);
      } else {
        this.toast.error(`Could not delete ${item.name} — try again.`);
      }
    } finally {
      this.deletingId.set(null);
    }
  }
}
