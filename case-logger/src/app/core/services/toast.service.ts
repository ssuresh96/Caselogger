import { Injectable, signal } from '@angular/core';

export type ToastVariant = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: number;
  message: string;
  variant: ToastVariant;
  durationMs: number;
}

const DEFAULT_DURATION_MS = 4500;
const ERROR_DURATION_MS = 6500;

@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly toastsSignal = signal<Toast[]>([]);
  readonly toasts = this.toastsSignal.asReadonly();

  private nextId = 1;

  success(message: string) {
    this.show(message, 'success', DEFAULT_DURATION_MS);
  }

  error(message: string) {
    this.show(message, 'error', ERROR_DURATION_MS);
  }

  info(message: string) {
    this.show(message, 'info', DEFAULT_DURATION_MS);
  }

  warning(message: string) {
    this.show(message, 'warning', DEFAULT_DURATION_MS);
  }

  dismiss(id: number) {
    this.toastsSignal.update((toasts) => toasts.filter((t) => t.id !== id));
  }

  private show(message: string, variant: ToastVariant, durationMs: number) {
    const id = this.nextId++;
    this.toastsSignal.update((toasts) => [...toasts, { id, message, variant, durationMs }]);
    setTimeout(() => this.dismiss(id), durationMs);
  }
}
