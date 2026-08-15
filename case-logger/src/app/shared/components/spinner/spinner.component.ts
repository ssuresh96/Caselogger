import { Component, input } from '@angular/core';

@Component({
  selector: 'app-spinner',
  template: `<span class="spinner" [class.spinner-lg]="size() === 'lg'" role="status" aria-hidden="true"></span>`,
  styleUrl: './spinner.component.scss',
})
export class SpinnerComponent {
  readonly size = input<'sm' | 'lg'>('sm');
}
