import { Component, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { Router, RouterOutlet, NavigationCancel, NavigationEnd, NavigationError } from '@angular/router';
import { filter, take } from 'rxjs';
import { LoadingBarComponent } from './shared/components/loading-bar/loading-bar.component';
import { ToastContainerComponent } from './shared/components/toast-container/toast-container.component';
import { AppSplashComponent } from './shared/components/app-splash/app-splash.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, LoadingBarComponent, ToastContainerComponent, AppSplashComponent],
  templateUrl: './app.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './app.component.scss',
})
export class AppComponent {
  private readonly router = inject(Router);

  // True only until the very first navigation settles (success, cancel, or
  // error) — covers the blank window while authGuard awaits the stored-JWT
  // check on a hard reload. Never shown again after that; subsequent route
  // changes use the loading bar + per-page states instead.
  readonly showSplash = signal(true);

  constructor() {
    this.router.events
      .pipe(
        filter(
          (e): e is NavigationEnd | NavigationCancel | NavigationError =>
            e instanceof NavigationEnd || e instanceof NavigationCancel || e instanceof NavigationError,
        ),
        take(1),
      )
      .subscribe(() => this.showSplash.set(false));
  }
}
