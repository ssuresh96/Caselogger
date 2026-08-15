import { Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { tap } from 'rxjs';
import { NgbDropdownModule } from '@ng-bootstrap/ng-bootstrap';
import { CaseService } from '../../../core/services/case.service';
import { ReferenceDataService } from '../../../core/services/reference-data.service';
import { AdminUser, UsersService } from '../../../core/services/users.service';
import { BadgeComponent } from '../../../shared/components/badge/badge.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { SpinnerComponent } from '../../../shared/components/spinner/spinner.component';
import { SelectComponent } from '../../../shared/components/select/select.component';
import { StatusSelectComponent, StatusOption } from '../../../shared/components/status-select/status-select.component';
import { ToastService } from '../../../core/services/toast.service';
import { CaseReferenceType, CaseStatus, CaseType, ReporterType } from '../../../core/models/case.model';
import { ReferenceItem } from '../../../core/models/reference-item.model';
import { CaseActivityEntry } from '../../../core/models/case-activity-entry.model';

type TabId = 'details' | 'activity';

const TITLE_MAX_LENGTH = 72;

@Component({
  selector: 'app-case-detail',
  imports: [
    RouterLink,
    DatePipe,
    FormsModule,
    ReactiveFormsModule,
    IconComponent,
    SpinnerComponent,
    NgbDropdownModule,
    BadgeComponent,
    SelectComponent,
    StatusSelectComponent,
  ],
  templateUrl: './case-detail.component.html',
  styleUrl: './case-detail.component.scss',
})
export class CaseDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly caseService = inject(CaseService);
  private readonly usersService = inject(UsersService);
  private readonly fb = inject(FormBuilder);
  private readonly toast = inject(ToastService);
  readonly referenceData = inject(ReferenceDataService);

  readonly statusOptions: CaseStatus[] = ['Open', 'InProgress', 'Pending', 'Resolved'];
  readonly reporterTypes: ReporterType[] = ['Customer', 'Internal'];

  private readonly caseId = this.route.snapshot.paramMap.get('id') ?? '';

  // getById() resolves a 404/error to `undefined` (see case.service.ts), the
  // same value item() starts with before the fetch completes — so a plain
  // `@if (item())` can't tell "still loading" apart from "genuinely not
  // found" and would flash the not-found state on every navigation here.
  // This tracks the fetch itself instead.
  private readonly loadingSignal = signal(true);
  readonly loading = this.loadingSignal.asReadonly();
  readonly item = toSignal(
    this.caseService.getById(this.caseId).pipe(tap(() => this.loadingSignal.set(false))),
    { initialValue: undefined },
  );

  // Entering via the case-list row's "Edit" action (?edit=1) jumps straight
  // into edit mode once the case has loaded, instead of landing read-only
  // and requiring a second click.
  private readonly autoEdit = this.route.snapshot.queryParamMap.get('edit') === '1';
  private autoEditApplied = false;

  constructor() {
    effect(() => {
      const current = this.item();
      if (current && this.autoEdit && !this.autoEditApplied) {
        this.autoEditApplied = true;
        this.startEdit();
      }
    });
  }

  private readonly allReferenceItems = toSignal(this.referenceData.list(undefined, true), {
    initialValue: [] as ReferenceItem[],
  });
  readonly categories = () => this.allReferenceItems().filter((i) => i.kind === 'category');
  readonly products = () => this.allReferenceItems().filter((i) => i.kind === 'product');
  readonly types = () => this.allReferenceItems().filter((i) => i.kind === 'type');
  readonly users = toSignal(this.usersService.list(), { initialValue: [] as AdminUser[] });

  readonly categoryOptions = () => this.categories().map((c) => ({ value: c.value, label: c.name }));
  readonly productOptions = () => this.products().map((p) => ({ value: p.value, label: p.name }));
  readonly typeOptions = () => this.types().map((t) => ({ value: t.value, label: t.name }));
  readonly userOptions = () => this.users().map((u) => ({ value: u.id, label: u.name }));

  readonly statusSelectOptions = (): StatusOption[] =>
    this.statusOptions.map((status) => ({
      value: status,
      label: this.referenceData.statusLabel(status),
      tone: this.referenceData.statusTone(status),
    }));

  readonly activeTab = signal<TabId>('details');
  readonly commentDraft = signal('');
  readonly postingComment = signal(false);

  // Real activity feed (plan §12/Part A) — replaces the old hardcoded
  // "Neeraj Sharma" placeholder entries with the case's actual system/
  // comment history. `listActivity()` shares the same `refresh$` trigger as
  // the rest of CaseService, so it refetches after any edit or comment.
  readonly activity = toSignal(this.caseService.listActivity(this.caseId), {
    initialValue: [] as CaseActivityEntry[],
  });

  readonly initials = computed(() => initialsOf(this.item()?.assignedTo?.name ?? ''));

  readonly title = computed(() => {
    const description = this.item()?.description ?? '';
    if (description.length <= TITLE_MAX_LENGTH) {
      return description;
    }
    return `${description.slice(0, TITLE_MAX_LENGTH).trimEnd()}…`;
  });

  // --- Inline field editing (plan §10) — no separate route/modal, the
  // whole thing happens on this one page. ---
  readonly isEditing = signal(false);
  readonly savingEdit = signal(false);

  readonly editForm = this.fb.nonNullable.group({
    reporterType: ['Customer' as ReporterType, Validators.required],
    reporterName: ['', Validators.required],
    customer: ['', Validators.required],
    product: ['', Validators.required],
    category: ['', Validators.required],
    description: ['', Validators.required],
    market: [''],
    type: ['' as CaseType | '', Validators.required],
    assignedTo: ['', Validators.required],
  });

  // --- Bug/Task/Workorder reference numbers (plan §12/T12.7) — its own
  // always-visible card + preview/edit toggle, same pattern as Remarks
  // (T12.8) rather than being buried inside the general "Edit" flow.
  // Category-conditional via `allowedTypes`, keyed off the case's actual
  // current category (this card is independent of the general edit form). ---
  readonly allowedTypes = computed<CaseReferenceType[]>(() =>
    this.referenceData.allowedReferenceTypes(this.item()?.category ?? ''),
  );
  readonly bugAllowed = computed(() => this.allowedTypes().includes('Bug'));
  readonly taskAllowed = computed(() => this.allowedTypes().includes('Task'));
  readonly woAllowed = computed(() => this.allowedTypes().includes('Workorder'));

  readonly referenceHintText = computed(() => {
    const allowed = this.allowedTypes();
    if (allowed.length === 3) {
      return 'This category accepts Bug, Task and WO numbers.';
    }
    if (allowed.length === 1) {
      return `This category accepts ${allowed[0]} numbers only.`;
    }
    return `This category accepts ${allowed.join(', ')} numbers.`;
  });

  readonly isEditingReferenceNumbers = signal(false);
  readonly savingReferenceNumbers = signal(false);
  readonly bugEnabled = signal(false);
  readonly bugNumberDraft = signal('');
  readonly taskEnabled = signal(false);
  readonly taskNumbersDraft = signal<string[]>([]);
  readonly newTaskNumber = signal('');
  readonly woEnabled = signal(false);
  readonly workOrderNumbersDraft = signal<string[]>([]);
  readonly newWorkOrderNumber = signal('');

  startEditReferenceNumbers() {
    const c = this.item();
    if (!c) {
      return;
    }
    this.bugEnabled.set(!!c.bugNumber);
    this.bugNumberDraft.set(c.bugNumber ?? '');
    this.taskEnabled.set(c.taskNumbers.length > 0);
    this.taskNumbersDraft.set([...c.taskNumbers]);
    this.newTaskNumber.set('');
    this.woEnabled.set(c.workOrderNumbers.length > 0);
    this.workOrderNumbersDraft.set([...c.workOrderNumbers]);
    this.newWorkOrderNumber.set('');
    this.isEditingReferenceNumbers.set(true);
  }

  cancelEditReferenceNumbers() {
    this.isEditingReferenceNumbers.set(false);
  }

  async saveReferenceNumbers() {
    const c = this.item();
    if (!c?.id) {
      return;
    }
    this.savingReferenceNumbers.set(true);
    try {
      const allowed = this.allowedTypes();
      await this.caseService.update(c.id, {
        bugNumber: allowed.includes('Bug') && this.bugEnabled() ? this.bugNumberDraft().trim() || null : null,
        taskNumbers: allowed.includes('Task') && this.taskEnabled() ? this.taskNumbersDraft() : [],
        workOrderNumbers: allowed.includes('Workorder') && this.woEnabled() ? this.workOrderNumbersDraft() : [],
      });
      this.isEditingReferenceNumbers.set(false);
      this.toast.success('Bug/Task/Workorder numbers saved.');
    } catch {
      this.toast.error('Could not save Bug/Task/Workorder numbers — try again.');
    } finally {
      this.savingReferenceNumbers.set(false);
    }
  }

  addTaskNumber() {
    const value = this.newTaskNumber().trim();
    if (!value) {
      return;
    }
    this.taskNumbersDraft.update((numbers) => [...numbers, value]);
    this.newTaskNumber.set('');
  }

  removeTaskNumber(index: number) {
    this.taskNumbersDraft.update((numbers) => numbers.filter((_, i) => i !== index));
  }

  addWorkOrderNumber() {
    const value = this.newWorkOrderNumber().trim();
    if (!value) {
      return;
    }
    this.workOrderNumbersDraft.update((numbers) => [...numbers, value]);
    this.newWorkOrderNumber.set('');
  }

  removeWorkOrderNumber(index: number) {
    this.workOrderNumbersDraft.update((numbers) => numbers.filter((_, i) => i !== index));
  }

  // --- Remarks — its own preview/edit toggle (plan §12/T12.8), separate
  // from the general "Edit" flow above. Plain-text preview with line breaks
  // preserved (T12.9) — see `.remarks-preview { white-space: pre-wrap }`. ---
  readonly isEditingRemarks = signal(false);
  readonly remarksDraft = signal('');
  readonly savingRemarks = signal(false);
  readonly remarksDirty = computed(() => this.remarksDraft() !== (this.item()?.remarks ?? ''));

  startEditRemarks() {
    this.remarksDraft.set(this.item()?.remarks ?? '');
    this.isEditingRemarks.set(true);
  }

  cancelEditRemarks() {
    this.isEditingRemarks.set(false);
  }

  entryInitials(name: string): string {
    return initialsOf(name);
  }

  setTab(tab: TabId) {
    this.activeTab.set(tab);
  }

  async updateStatus(status: string) {
    if (!this.item()?.id) {
      return;
    }
    try {
      await this.caseService.update(this.item()!.id!, { status: status as CaseStatus });
      this.toast.success(`Status changed to ${status}.`);
    } catch {
      this.toast.error('Could not change status — try again.');
    }
  }

  startEdit() {
    const c = this.item();
    if (!c) {
      return;
    }
    this.editForm.setValue({
      reporterType: c.reporterType,
      reporterName: c.reporterName,
      customer: c.customer,
      product: c.product,
      category: c.category,
      description: c.description,
      market: c.market,
      type: c.type,
      assignedTo: c.assignedTo.id,
    });
    this.isEditing.set(true);
  }

  cancelEdit() {
    this.isEditing.set(false);
  }

  async saveEdit() {
    const c = this.item();
    if (!c?.id || this.editForm.invalid) {
      this.editForm.markAllAsTouched();
      return;
    }
    this.savingEdit.set(true);
    try {
      const value = this.editForm.getRawValue();
      await this.caseService.update(c.id, {
        reporterType: value.reporterType,
        reporterName: value.reporterName,
        customer: value.customer,
        product: value.product,
        category: value.category,
        description: value.description,
        market: value.market,
        type: value.type as CaseType,
        assignedTo: value.assignedTo,
      });
      this.isEditing.set(false);
      this.toast.success('Case updated.');
    } catch {
      this.toast.error('Could not save changes — try again.');
    } finally {
      this.savingEdit.set(false);
    }
  }

  async saveRemarks() {
    const c = this.item();
    if (!c?.id) {
      return;
    }
    this.savingRemarks.set(true);
    try {
      await this.caseService.update(c.id, { remarks: this.remarksDraft() });
      this.isEditingRemarks.set(false);
      this.toast.success('Remarks saved.');
    } catch {
      this.toast.error('Could not save remarks — try again.');
    } finally {
      this.savingRemarks.set(false);
    }
  }

  async postComment() {
    const message = this.commentDraft().trim();
    const caseId = this.item()?.id;
    if (!message || !caseId) {
      return;
    }
    this.postingComment.set(true);
    try {
      await this.caseService.postComment(caseId, message);
      this.commentDraft.set('');
    } catch {
      this.toast.error('Could not post comment — try again.');
    } finally {
      this.postingComment.set(false);
    }
  }
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1] : '';
  return (first.charAt(0) + last.charAt(0)).toUpperCase();
}
