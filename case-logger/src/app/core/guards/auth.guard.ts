import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { filter, map, switchMap, take } from 'rxjs';
import { AuthService } from '../services/auth.service';

export const authGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  // Wait for the initial session check (validating any stored JWT via
  // /users/me) to finish before deciding — otherwise a page reload races
  // the async check and incorrectly bounces a logged-in user to /login.
  return authService.authReady$.pipe(
    filter((ready) => ready),
    take(1),
    switchMap(() => authService.currentUser$.pipe(take(1))),
    map((currentUser) => (currentUser ? true : router.createUrlTree(['/login']))),
  );
};
