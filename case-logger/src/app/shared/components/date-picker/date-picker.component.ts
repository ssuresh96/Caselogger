import { Component, ElementRef, HostListener, computed, forwardRef, inject, signal, viewChild } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { NG_VALUE_ACCESSOR, ControlValueAccessor } from '@angular/forms';
import { IconComponent } from '../icon/icon.component';

interface DayCell {
  date: string; // YYYY-MM-DD
  day: number;
  inMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
}

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function toIso(year: number, month: number, day: number): string {
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

function todayIso(): string {
  const now = new Date();
  return toIso(now.getFullYear(), now.getMonth(), now.getDate());
}

// Calendar-grid date picker replacing native <input type="date"> —
// CVA so it drops into formControlName exactly the same way. Emits/accepts
// a plain 'YYYY-MM-DD' string to match the rest of the form's date handling.
@Component({
  selector: 'app-date-picker',
  imports: [IconComponent],
  template: `
    <div class="dp-shell" [class.dp-open]="open()">
      <button #trigger type="button" class="dp-trigger" (click)="toggle()" [attr.aria-expanded]="open()">
        <span class="dp-value" [class.dp-placeholder]="!value()">{{ displayValue() || 'Select date…' }}</span>
        <app-icon name="calendar_month" />
      </button>

      @if (open()) {
        <div class="dp-panel" [style.top.px]="panelPosition().top" [style.left.px]="panelPosition().left">
          <div class="dp-nav">
            <button type="button" class="dp-nav-btn" (click)="prevMonth()" aria-label="Previous month">
              <app-icon name="chevron_left" />
            </button>
            <span class="dp-month-label">{{ monthLabel() }}</span>
            <button type="button" class="dp-nav-btn" (click)="nextMonth()" aria-label="Next month">
              <app-icon name="chevron_right" />
            </button>
          </div>

          <div class="dp-weekdays">
            @for (w of weekdays; track w) {
              <span>{{ w }}</span>
            }
          </div>

          <div class="dp-grid">
            @for (cell of grid(); track cell.date) {
              <button
                type="button"
                class="dp-cell"
                [class.dp-cell-out]="!cell.inMonth"
                [class.dp-cell-selected]="cell.isSelected"
                [class.dp-cell-today]="cell.isToday && !cell.isSelected"
                (click)="selectDay(cell)"
              >
                {{ cell.day }}
              </button>
            }
          </div>

          <div class="dp-footer">
            <button type="button" class="dp-link" (click)="goToday()">Today</button>
            <button type="button" class="dp-link dp-link-muted" (click)="clear()">Clear</button>
          </div>
        </div>
      }
    </div>
  `,
  styleUrl: './date-picker.component.scss',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => DatePickerComponent),
      multi: true,
    },
  ],
})
export class DatePickerComponent implements ControlValueAccessor {
  private readonly elRef = inject(ElementRef<HTMLElement>);
  private readonly document = inject(DOCUMENT);
  private readonly trigger = viewChild<ElementRef<HTMLElement>>('trigger');

  readonly weekdays = WEEKDAYS;
  readonly open = signal(false);
  readonly value = signal('');
  readonly panelPosition = signal({ top: 0, left: 0 });

  private readonly closeOnScroll = () => this.closePanel();

  private readonly viewYear = signal(new Date().getFullYear());
  private readonly viewMonth = signal(new Date().getMonth());

  readonly monthLabel = computed(() => `${MONTH_NAMES[this.viewMonth()]} ${this.viewYear()}`);

  readonly displayValue = computed(() => {
    const v = this.value();
    if (!v) {
      return '';
    }
    const [y, m, d] = v.split('-').map(Number);
    return `${d} ${MONTH_NAMES[m - 1].slice(0, 3)} ${y}`;
  });

  readonly grid = computed<DayCell[]>(() => {
    const year = this.viewYear();
    const month = this.viewMonth();
    const selected = this.value();
    const today = todayIso();

    const firstWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();

    const cells: DayCell[] = [];
    for (let i = firstWeekday - 1; i >= 0; i--) {
      const day = daysInPrevMonth - i;
      const [y, m] = month === 0 ? [year - 1, 11] : [year, month - 1];
      const date = toIso(y, m, day);
      cells.push({ date, day, inMonth: false, isToday: date === today, isSelected: date === selected });
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const date = toIso(year, month, day);
      cells.push({ date, day, inMonth: true, isToday: date === today, isSelected: date === selected });
    }
    let nextDay = 1;
    while (cells.length < 42) {
      const [y, m] = month === 11 ? [year + 1, 0] : [year, month + 1];
      const date = toIso(y, m, nextDay);
      cells.push({ date, day: nextDay, inMonth: false, isToday: date === today, isSelected: date === selected });
      nextDay++;
    }
    return cells;
  });

  private onChange: (value: string) => void = () => {};
  private onTouched: () => void = () => {};

  writeValue(value: string): void {
    this.value.set(value ?? '');
    if (value) {
      const [y, m] = value.split('-').map(Number);
      this.viewYear.set(y);
      this.viewMonth.set(m - 1);
    }
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  toggle() {
    this.open.update((o) => !o);
    if (this.open()) {
      const rect = this.trigger()?.nativeElement.getBoundingClientRect();
      if (rect) {
        this.panelPosition.set({ top: rect.bottom + 6, left: rect.left });
      }
      this.document.addEventListener('scroll', this.closeOnScroll, true);
    } else {
      this.closePanel();
      this.onTouched();
    }
  }

  private closePanel() {
    this.open.set(false);
    this.document.removeEventListener('scroll', this.closeOnScroll, true);
  }

  prevMonth() {
    if (this.viewMonth() === 0) {
      this.viewMonth.set(11);
      this.viewYear.update((y) => y - 1);
    } else {
      this.viewMonth.update((m) => m - 1);
    }
  }

  nextMonth() {
    if (this.viewMonth() === 11) {
      this.viewMonth.set(0);
      this.viewYear.update((y) => y + 1);
    } else {
      this.viewMonth.update((m) => m + 1);
    }
  }

  selectDay(cell: DayCell) {
    this.value.set(cell.date);
    this.onChange(cell.date);
    this.closePanel();
    this.onTouched();
  }

  goToday() {
    const iso = todayIso();
    const [y, m] = iso.split('-').map(Number);
    this.viewYear.set(y);
    this.viewMonth.set(m - 1);
    this.value.set(iso);
    this.onChange(iso);
    this.closePanel();
    this.onTouched();
  }

  clear() {
    this.value.set('');
    this.onChange('');
    this.closePanel();
    this.onTouched();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    if (this.open() && !this.elRef.nativeElement.contains(event.target as Node)) {
      this.closePanel();
      this.onTouched();
    }
  }

  // stopPropagation — otherwise Escape bubbles to ngbModal's own
  // document-level listener and dismisses the modal underneath instead of
  // just this calendar.
  @HostListener('keydown.escape', ['$event'])
  onEscape(event: KeyboardEvent) {
    if (this.open()) {
      event.preventDefault();
      event.stopPropagation();
      this.closePanel();
      this.onTouched();
    }
  }
}
