import { Injectable, inject } from '@angular/core';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { CaseIntakeComponent } from '../../features/case-intake/case-intake/case-intake.component';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../shared/components/confirm-dialog/confirm-dialog.component';

@Injectable({ providedIn: 'root' })
export class CaseDialogService {
  private readonly modalService = inject(NgbModal);

  openCreateCase() {
    const modalRef = this.modalService.open(CaseIntakeComponent, {
      size: 'lg',
      centered: true,
    });
    // Nothing currently awaits the created-case id, but an unhandled
    // rejection would otherwise log to the console every time the dialog
    // is dismissed (backdrop click / Escape / Cancel) — NgbModal rejects
    // `.result` on dismiss the way MatDialog's `afterClosed()` never did.
    modalRef.result.catch(() => undefined);
    return modalRef;
  }

  /** Warning popup before a (soft) delete, user-requested after using the
   * app — resolves true only if the user confirmed. */
  async confirmDeleteCase(caseId: string): Promise<boolean> {
    const modalRef = this.modalService.open(ConfirmDialogComponent, {
      size: 'sm',
      centered: true,
    });
    const data: ConfirmDialogData = {
      title: `Delete ${caseId}?`,
      message: `This removes ${caseId} from all case lists. It stays recoverable by an admin, but won't be visible anywhere in the app once deleted.`,
      confirmLabel: 'Delete Case',
      danger: true,
    };
    modalRef.componentInstance.data = data;
    try {
      return (await modalRef.result) === true;
    } catch {
      return false; // dismissed via backdrop/Escape — same as Cancel
    }
  }
}
