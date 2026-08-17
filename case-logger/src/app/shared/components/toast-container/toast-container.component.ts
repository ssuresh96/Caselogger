import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { animate, style, transition, trigger } from '@angular/animations';
import { ToastService, ToastVariant } from '../../../core/services/toast.service';
import { IconComponent } from '../icon/icon.component';

const VARIANT_ICON: Record<ToastVariant, string> = {
  success: 'check_circle',
  error: 'warning',
  info: 'info',
  warning: 'warning',
};

const VARIANT_TITLE: Record<ToastVariant, string> = {
  success: 'Success',
  error: 'Something went wrong',
  info: 'Heads up',
  warning: 'Warning',
};

@Component({
  selector: 'app-toast-container',
  imports: [IconComponent],
  template: `
    <div class="app-toast-stack" role="status" aria-live="polite">
      @for (toast of toastService.toasts(); track toast.id) {
        <div class="app-toast" [class]="'app-toast-' + toast.variant" [@toastEnter]>
          <div class="app-toast-row">
            <span class="app-toast-icon-badge">
              <app-icon [name]="iconFor(toast.variant)" />
            </span>
            <div class="app-toast-text">
              <span class="app-toast-title">{{ titleFor(toast.variant) }}</span>
              <span class="app-toast-message">{{ toast.message }}</span>
            </div>
            <button type="button" class="app-toast-close" (click)="toastService.dismiss(toast.id)" aria-label="Dismiss">
              <app-icon name="close" />
            </button>
          </div>
          <div class="app-toast-progress-track">
            <div class="app-toast-progress-fill" [style.animation-duration.ms]="toast.durationMs"></div>
          </div>
        </div>
      }
    </div>
  `,
  styleUrl: './toast-container.component.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
  animations: [
    trigger('toastEnter', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateX(24px)' }),
        animate('180ms ease-out', style({ opacity: 1, transform: 'translateX(0)' })),
      ]),
      transition(':leave', [
        animate('150ms ease-in', style({ opacity: 0, transform: 'translateX(24px)' })),
      ]),
    ]),
  ],
})
export class ToastContainerComponent {
  protected readonly toastService = inject(ToastService);

  iconFor(variant: ToastVariant): string {
    return VARIANT_ICON[variant];
  }

  titleFor(variant: ToastVariant): string {
    return VARIANT_TITLE[variant];
  }
}
