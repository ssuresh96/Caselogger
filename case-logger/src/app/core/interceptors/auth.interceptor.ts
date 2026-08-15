import { inject } from '@angular/core';
import { HttpInterceptorFn } from '@angular/common/http';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { environment } from '../../../environments/environment';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  const isApiRequest = req.url.startsWith(environment.apiUrl);
  const token = isApiRequest ? authService.getToken() : null;
  const authedReq = token
    ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : req;

  return next(authedReq).pipe(
    catchError((error) => {
      // No refresh-token flow yet (single long-lived JWT, see plan §2/§7) —
      // a 401 just sends the user back to sign in again.
      if (isApiRequest && error?.status === 401) {
        router.navigateByUrl('/login');
      }
      return throwError(() => error);
    }),
  );
};
