import { Component, Input, inject, ChangeDetectionStrategy } from '@angular/core';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { IconComponent } from '../icon/icon.component';

export interface ConfirmDialogData {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

@Component({
  selector: 'app-confirm-dialog',
  imports: [IconComponent],
  templateUrl: './confirm-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './confirm-dialog.component.scss',
})
export class ConfirmDialogComponent {
  // Set directly on the component instance by CaseDialogService after
  // opening it via NgbModal — ng-bootstrap has no DI-token equivalent of
  // Material's MAT_DIALOG_DATA, the opener just assigns `componentInstance`
  // properties instead.
  @Input() data!: ConfirmDialogData;

  private readonly activeModal = inject(NgbActiveModal);

  cancel() {
    this.activeModal.close(false);
  }

  confirm() {
    this.activeModal.close(true);
  }
}
