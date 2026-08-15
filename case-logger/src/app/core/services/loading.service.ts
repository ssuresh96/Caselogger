import { Injectable, computed, signal } from '@angular/core';

// Tracks in-flight HTTP requests (see loading.interceptor.ts) so the root
// loading bar can show/hide without every component wiring its own flag.
@Injectable({ providedIn: 'root' })
export class LoadingService {
  private readonly pending = signal(0);

  readonly isLoading = computed(() => this.pending() > 0);

  start() {
    this.pending.update((count) => count + 1);
  }

  stop() {
    this.pending.update((count) => Math.max(0, count - 1));
  }
}
