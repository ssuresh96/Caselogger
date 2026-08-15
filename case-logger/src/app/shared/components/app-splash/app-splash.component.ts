import { Component } from '@angular/core';
import { animate, style, transition, trigger } from '@angular/animations';

// Covers the one real blank-page gap left in the app: on a hard reload while
// authenticated, authGuard awaits the stored-JWT check (authReady$) before
// the router can resolve any route, so <router-outlet> renders nothing for
// that window. This sits in app.component as a sibling to the outlet and is
// torn down for good after the first navigation settles (see
// app.component.ts) — it is not shown again for in-app route changes, which
// already have their own per-page loading states.
@Component({
  selector: 'app-splash',
  template: `
    <div class="splash" [@splashFade]>
      <div class="splash-brand">
        <div class="splash-mark"></div>
        <span class="splash-word">CaseLog</span>
      </div>
      <div class="splash-track">
        <div class="splash-bar"></div>
      </div>
      <div class="splash-status">
        <span class="splash-spinner"></span>
        <span>Loading your queue and reference data…</span>
      </div>
    </div>
  `,
  styleUrl: './app-splash.component.scss',
  animations: [
    trigger('splashFade', [
      transition(':leave', [animate('220ms ease-in', style({ opacity: 0 }))]),
    ]),
  ],
})
export class AppSplashComponent {}
