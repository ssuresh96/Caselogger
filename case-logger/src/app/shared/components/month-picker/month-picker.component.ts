import { Component, ElementRef, HostListener, computed, inject, input, model, signal, viewChild } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { IconComponent } from '../icon/icon.component';

interface MonthCell {
  index: number; // 0-11
  label: string;
  value: string; // YYYY-MM
  disabled: boolean;
  selected: boolean;
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function currentMonthValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
}

// Month-grid picker replacing native <input type="month"> for the Reports
// period selector. Plain [(value)] two-way binding (not CVA/reactive-forms)
// since the caller already drives a signal directly, same as the native
// input's (change) handler it replaces.
@Component({
  selector: 'app-month-picker',
  imports: [IconComponent],
  template: `
    <div class="mp-shell" [class.mp-open]="open()">
      <button #trigger type="button" class="mp-trigger" (click)="toggle()" [attr.aria-expanded]="open()">
        {{ triggerLabel() }}
        <app-icon name="calendar_month" />
      </button>

      @if (open()) {
        <div class="mp-panel" [style.top.px]="panelPosition().top" [style.left.px]="panelPosition().left">
          <div class="mp-nav">
            <button type="button" class="mp-nav-btn" (click)="prevYear()" aria-label="Previous year">
              <app-icon name="chevron_left" />
            </button>
            <span class="mp-year-label">{{ viewYear() }}</span>
            <button
              type="button"
              class="mp-nav-btn"
              (click)="nextYear()"
              [disabled]="viewYear() >= currentYear"
              aria-label="Next year"
            >
              <app-icon name="chevron_right" />
            </button>
          </div>

          <div class="mp-grid">
            @for (cell of cells(); track cell.index) {
              <button
                type="button"
                class="mp-cell"
                [class.mp-cell-selected]="cell.selected"
                [disabled]="cell.disabled"
                (click)="select(cell)"
              >
                {{ cell.label }}
              </button>
            }
          </div>

          <div class="mp-footer">
            <span>Months with no data yet are disabled</span>
            <button type="button" class="mp-link" (click)="goThisMonth()">This month</button>
          </div>
        </div>
      }
    </div>
  `,
  styleUrl: './month-picker.component.scss',
})
export class MonthPickerComponent {
  private readonly elRef = inject(ElementRef<HTMLElement>);
  private readonly document = inject(DOCUMENT);
  private readonly trigger = viewChild<ElementRef<HTMLElement>>('trigger');

  readonly value = model.required<string>();
  readonly minValue = input<string | null>(null);

  readonly currentYear = new Date().getFullYear();
  readonly open = signal(false);
  readonly viewYear = signal(new Date().getFullYear());

  // Fixed-viewport position, right-aligned under the trigger — panel width
  // is 260px (see .mp-panel), matching the CSS `right: 0` alignment it replaces.
  readonly panelPosition = signal({ top: 0, left: 0 });

  private readonly closeOnScroll = () => this.closePanel();

  readonly triggerLabel = computed(() => {
    const [y, m] = this.value().split('-').map(Number);
    return `${MONTH_LABELS[m - 1]} ${y}`;
  });

  readonly cells = computed<MonthCell[]>(() => {
    const year = this.viewYear();
    const selected = this.value();
    const min = this.minValue();
    return MONTH_LABELS.map((label, index) => {
      const value = `${year}-${pad(index + 1)}`;
      const afterToday = year === this.currentYear ? index > new Date().getMonth() : year > this.currentYear;
      const beforeMin = !!min && value < min;
      return { index, label, value, disabled: afterToday || beforeMin, selected: value === selected };
    });
  });

  toggle() {
    this.open.update((o) => !o);
    if (this.open()) {
      const [y] = this.value().split('-').map(Number);
      this.viewYear.set(y);
      const rect = this.trigger()?.nativeElement.getBoundingClientRect();
      if (rect) {
        this.panelPosition.set({ top: rect.bottom + 6, left: rect.right - 260 });
      }
      this.document.addEventListener('scroll', this.closeOnScroll, true);
    } else {
      this.closePanel();
    }
  }

  private closePanel() {
    this.open.set(false);
    this.document.removeEventListener('scroll', this.closeOnScroll, true);
  }

  prevYear() {
    this.viewYear.update((y) => y - 1);
  }

  nextYear() {
    if (this.viewYear() < this.currentYear) {
      this.viewYear.update((y) => y + 1);
    }
  }

  select(cell: MonthCell) {
    if (cell.disabled) {
      return;
    }
    this.value.set(cell.value);
    this.closePanel();
  }

  goThisMonth() {
    this.viewYear.set(this.currentYear);
    this.value.set(currentMonthValue());
    this.closePanel();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    if (this.open() && !this.elRef.nativeElement.contains(event.target as Node)) {
      this.closePanel();
    }
  }

  @HostListener('keydown.escape', ['$event'])
  onEscape(event: KeyboardEvent) {
    if (this.open()) {
      event.preventDefault();
      event.stopPropagation();
      this.closePanel();
    }
  }
}
