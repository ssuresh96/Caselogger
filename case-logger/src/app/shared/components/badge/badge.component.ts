import { Component, input } from '@angular/core';

export type BadgeTone = 'good' | 'warning' | 'serious' | 'critical' | 'info' | 'progress';

@Component({
  selector: 'app-badge',
  standalone: true,
  template: `<span class="badge" [class]="'badge-' + tone()">{{ label() }}</span>`,
  styles: `
    .badge {
      display: inline-flex;
      align-items: center;
      padding: 3px 10px;
      border-radius: 999px;
      font-size: 0.78rem;
      font-weight: 600;
      white-space: nowrap;
    }
    .badge-good {
      background: var(--status-good-tint);
      color: var(--status-good-text);
    }
    .badge-warning {
      background: var(--status-warning-tint);
      color: var(--status-warning-text);
    }
    .badge-serious {
      background: var(--status-serious-tint);
      color: var(--status-serious-text);
    }
    .badge-critical {
      background: var(--status-critical-tint);
      color: var(--status-critical-text);
    }
    .badge-info {
      background: var(--accent-tint);
      color: var(--accent-strong);
    }
    .badge-progress {
      background: var(--status-progress-tint);
      color: var(--status-progress-text);
    }
  `,
})
export class BadgeComponent {
  readonly tone = input<BadgeTone>('info');
  readonly label = input<string>('');
}
