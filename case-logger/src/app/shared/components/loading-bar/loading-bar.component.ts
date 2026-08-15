import { Component, inject } from '@angular/core';
import { LoadingService } from '../../../core/services/loading.service';

@Component({
  selector: 'app-loading-bar',
  template: `
    @if (loadingService.isLoading()) {
      <div class="loading-bar" role="progressbar" aria-label="Loading">
        <div class="loading-bar-fill"></div>
      </div>
    }
  `,
  styleUrl: './loading-bar.component.scss',
})
export class LoadingBarComponent {
  protected readonly loadingService = inject(LoadingService);
}
