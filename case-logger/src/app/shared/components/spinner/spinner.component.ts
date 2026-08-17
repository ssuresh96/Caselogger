import { Component, input, ChangeDetectionStrategy } from '@angular/core';

@Component({
  selector: 'app-spinner',
  template: `<span class="spinner" [class.spinner-lg]="size() === 'lg'" role="status" aria-hidden="true"></span>`,
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './spinner.component.scss',
})
export class SpinnerComponent {
  readonly size = input<'sm' | 'lg'>('sm');
}
