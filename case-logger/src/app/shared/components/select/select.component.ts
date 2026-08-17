import { Component, ElementRef, HostListener, computed, effect, forwardRef, inject, input, signal, viewChild, DOCUMENT, ChangeDetectionStrategy } from '@angular/core';

import { NG_VALUE_ACCESSOR, ControlValueAccessor } from '@angular/forms';
import { IconComponent } from '../icon/icon.component';

export interface SelectOption {
  value: string;
  label: string;
  meta?: string;
}

// Searchable combobox replacing native <select> for long option lists
// (Category, Product, Assigned To) — implements ControlValueAccessor so it
// drops into reactive forms exactly like <select formControlName="...">.
@Component({
  selector: 'app-select',
  imports: [IconComponent],
  template: `
    <div class="select-shell" [class.select-open]="open()" [class.select-disabled]="disabled()">
      <button
        #trigger
        type="button"
        class="select-trigger"
        (click)="toggle()"
        [disabled]="disabled()"
        [attr.aria-expanded]="open()"
      >
        <span class="select-value" [class.select-placeholder]="!selectedLabel()">{{ selectedLabel() || placeholder() }}</span>
        <app-icon [name]="open() ? 'expand_less' : 'expand_more'" />
      </button>

      @if (open()) {
        <div
          class="select-panel"
          [style.top.px]="panelPosition().top"
          [style.left.px]="panelPosition().left"
          [style.width.px]="panelPosition().width"
        >
          <div class="select-search">
            <app-icon name="search" />
            <input
              #searchInput
              type="text"
              [placeholder]="searchPlaceholder()"
              [value]="query()"
              (input)="onQuery($any($event.target).value)"
            />
          </div>
          <div class="select-list">
            @for (opt of filtered(); track opt.value; let i = $index) {
              <div
                class="select-option"
                [class.select-option-selected]="opt.value === value()"
                [class.select-option-highlighted]="i === highlighted()"
                (mouseenter)="highlighted.set(i)"
                (click)="select(opt)"
              >
                <span class="option-dot" [class.option-dot-selected]="opt.value === value()"></span>
                <span class="option-label">{{ opt.label }}</span>
                @if (opt.meta) {
                  <span class="option-meta">{{ opt.meta }}</span>
                }
                @if (opt.value === value()) {
                  <app-icon name="check" class="option-check" />
                }
              </div>
            } @empty {
              <div class="select-empty">No matches</div>
            }
          </div>
          <div class="select-footer">
            <span>{{ filtered().length }} of {{ options().length }}</span>
            <span class="select-keys">↑↓ · ↵ · ESC</span>
          </div>
        </div>
      }
    </div>
  `,
  styleUrl: './select.component.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => SelectComponent),
      multi: true,
    },
  ],
})
export class SelectComponent implements ControlValueAccessor {
  private readonly elRef = inject(ElementRef<HTMLElement>);
  private readonly document = inject(DOCUMENT);
  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');
  private readonly trigger = viewChild<ElementRef<HTMLElement>>('trigger');

  readonly options = input<SelectOption[]>([]);
  readonly placeholder = input('Select…');
  readonly searchPlaceholder = input('Search…');

  readonly open = signal(false);
  readonly query = signal('');
  readonly highlighted = signal(0);
  readonly value = signal('');
  readonly disabled = signal(false);

  // Fixed-viewport position computed from the trigger's rect — position:
  // absolute inside a card/modal with overflow-y:auto would otherwise get
  // clipped whenever the field sits low enough in a scrollable container.
  readonly panelPosition = signal({ top: 0, left: 0, width: 0 });

  private updatePanelPosition() {
    const rect = this.trigger()?.nativeElement.getBoundingClientRect();
    if (!rect) {
      return;
    }
    this.panelPosition.set({ top: rect.bottom + 6, left: rect.left, width: rect.width });
  }

  private readonly closeOnScroll = () => this.closePanel();

  readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    const opts = this.options();
    return q ? opts.filter((o) => o.label.toLowerCase().includes(q)) : opts;
  });

  readonly selectedLabel = computed(() => this.options().find((o) => o.value === this.value())?.label ?? '');

  private onChange: (value: string) => void = () => {};
  private onTouched: () => void = () => {};

  constructor() {
    effect(() => {
      if (this.open()) {
        queueMicrotask(() => this.searchInput()?.nativeElement.focus());
      }
    });
  }

  writeValue(value: string): void {
    this.value.set(value ?? '');
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled.set(isDisabled);
  }

  toggle() {
    if (this.disabled()) {
      return;
    }
    this.open.update((o) => !o);
    if (this.open()) {
      this.updatePanelPosition();
      this.document.addEventListener('scroll', this.closeOnScroll, true);
      this.query.set('');
      this.highlighted.set(Math.max(0, this.filtered().findIndex((o) => o.value === this.value())));
    } else {
      this.closePanel();
      this.onTouched();
    }
  }

  onQuery(value: string) {
    this.query.set(value);
    this.highlighted.set(0);
  }

  select(opt: SelectOption) {
    this.value.set(opt.value);
    this.onChange(opt.value);
    this.closePanel();
    this.onTouched();
  }

  private closePanel() {
    this.open.set(false);
    this.document.removeEventListener('scroll', this.closeOnScroll, true);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    if (this.open() && !this.elRef.nativeElement.contains(event.target as Node)) {
      this.closePanel();
      this.onTouched();
    }
  }

  @HostListener('keydown', ['$event'])
  onKeydown(event: KeyboardEvent) {
    if (this.disabled()) {
      return;
    }
    if (!this.open()) {
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
        event.preventDefault();
        this.toggle();
      }
      return;
    }
    const items = this.filtered();
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.highlighted.update((i) => Math.min(items.length - 1, i + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.highlighted.update((i) => Math.max(0, i - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const item = items[this.highlighted()];
      if (item) {
        this.select(item);
      }
    } else if (event.key === 'Escape') {
      // stopPropagation, not just preventDefault — otherwise the keydown
      // bubbles up to ngbModal's own document-level Escape listener and
      // dismisses the whole Create Case / Case Detail edit modal underneath.
      event.preventDefault();
      event.stopPropagation();
      this.closePanel();
      this.onTouched();
    }
  }
}
