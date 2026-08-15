import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map, take } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { UserRole } from '../models/user-role.model';

export const roleGuard: CanActivateFn = (route) => {
  const authService = inject(AuthService);
  const router = inject(Router);
  const requiredRole = route.data['role'] as UserRole | undefined;

  return authService.currentUser$.pipe(
    take(1),
    map((appUser) => {
      if (!requiredRole) {
        return true;
      }
      if (appUser?.role === requiredRole || appUser?.role === 'admin') {
        return true;
      }
      return router.createUrlTree(['/cases']);
    }),
  );
};
