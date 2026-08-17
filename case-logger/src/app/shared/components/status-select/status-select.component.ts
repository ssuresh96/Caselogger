import { Component, ElementRef, HostListener, inject, input, signal, viewChild, forwardRef, DOCUMENT, ChangeDetectionStrategy } from '@angular/core';

import { NG_VALUE_ACCESSOR, ControlValueAccessor } from '@angular/forms';
import { IconComponent } from '../icon/icon.component';
import { BadgeComponent, BadgeTone } from '../badge/badge.component';

export interface StatusOption {
  value: string;
  label: string;
  tone: BadgeTone;
  hint?: string;
}

// Small badge-styled dropdown for status fields — coloured badge as the
// trigger content instead of plain text, matching the badges used
// everywhere else a status is displayed. CVA so it drops into
// formControlName or a plain [ngModel] the same way <select> did.
@Component({
  selector: 'app-status-select',
  imports: [IconComponent, BadgeComponent],
  template: `
    <div class="status-select-shell" [class.status-select-open]="open()">
      <button #trigger type="button" class="status-select-trigger" (click)="toggle()" [attr.aria-expanded]="open()">
        @if (selected(); as opt) {
          <app-badge [tone]="opt.tone" [label]="opt.label" />
        } @else {
          <span class="status-select-placeholder">Select…</span>
        }
        <span class="status-select-spacer"></span>
        <app-icon [name]="open() ? 'expand_less' : 'expand_more'" />
      </button>

      @if (open()) {
        <div
          class="status-select-panel"
          [style.top.px]="panelPosition().top"
          [style.left.px]="panelPosition().left"
        >
          @for (opt of options(); track opt.value) {
            <div class="status-select-option" (click)="select(opt)">
              <app-badge [tone]="opt.tone" [label]="opt.label" />
              @if (opt.hint) {
                <span class="status-select-hint">{{ opt.hint }}</span>
              }
              @if (opt.value === value()) {
                <app-icon name="check" class="status-select-check" />
              }
            </div>
          }
        </div>
      }
    </div>
  `,
  styleUrl: './status-select.component.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => StatusSelectComponent),
      multi: true,
    },
  ],
})
export class StatusSelectComponent implements ControlValueAccessor {
  private readonly elRef = inject(ElementRef<HTMLElement>);
  private readonly document = inject(DOCUMENT);
  private readonly trigger = viewChild<ElementRef<HTMLElement>>('trigger');

  readonly options = input<StatusOption[]>([]);

  readonly open = signal(false);
  readonly value = signal('');

  // Fixed-viewport position — the trigger commonly sits in an
  // `overflow: hidden` grid (Case Detail's rounded meta-bar), which would
  // otherwise clip an absolutely-positioned panel entirely.
  readonly panelPosition = signal({ top: 0, left: 0 });

  private readonly closeOnScroll = () => this.closePanel();

  selected(): StatusOption | undefined {
    return this.options().find((o) => o.value === this.value());
  }

  private onChange: (value: string) => void = () => {};
  private onTouched: () => void = () => {};

  writeValue(value: string): void {
    this.value.set(value ?? '');
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

  select(opt: StatusOption) {
    this.value.set(opt.value);
    this.onChange(opt.value);
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

  @HostListener('keydown.escape', ['$event'])
  onEscape(event: Event) {
    if (this.open()) {
      event.preventDefault();
      event.stopPropagation();
      this.closePanel();
      this.onTouched();
    }
  }
}
