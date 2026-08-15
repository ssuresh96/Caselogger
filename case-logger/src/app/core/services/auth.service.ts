import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, firstValueFrom } from 'rxjs';
import { AppUser } from '../models/user-role.model';
import { environment } from '../../../environments/environment';

const DEMO_STORAGE_KEY = 'case-logger.demoUser';
const JWT_STORAGE_KEY = 'case-logger.jwt';

interface MeResponse {
  id: string;
  email: string;
  name: string;
  isSuperuser: boolean;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly mockMode = environment.useMockAuth;

  // TEMPORARY (prototype-only): holds the "signed in" user when useMockAuth
  // is on, so the app is demoable without a running API/MongoDB.
  private readonly demoUser$ = new BehaviorSubject<AppUser | null>(this.loadDemoUser());
  private readonly realUser$ = new BehaviorSubject<AppUser | null>(null);

  // authGuard waits on this before reading currentUser$ — otherwise a page
  // reload with a valid stored JWT loses the race: the guard would read
  // realUser$'s initial `null` before the async /users/me call resolves,
  // and incorrectly bounce a logged-in user back to /login.
  private readonly ready$ = new BehaviorSubject<boolean>(this.mockMode);
  readonly authReady$: Observable<boolean> = this.ready$.asObservable();

  readonly currentUser$: Observable<AppUser | null> = this.mockMode
    ? this.demoUser$.asObservable()
    : this.realUser$.asObservable();

  constructor() {
    if (this.mockMode) {
      return;
    }
    // Deferred to a microtask: calling refreshCurrentUser() synchronously
    // here would fire an HttpClient request (and thus authInterceptor,
    // which injects AuthService) before this constructor call — and thus
    // this service's own DI registration — has finished, causing an
    // NG0200 circular-dependency error. Only happens on this constructor
    // path (page load with a stored token); login() runs later and is fine.
    queueMicrotask(() => {
      if (this.getToken()) {
        this.refreshCurrentUser()
          .catch(() => this.clearToken())
          .finally(() => this.ready$.next(true));
      } else {
        this.ready$.next(true);
      }
    });
  }

  async login(email: string, password: string, remember = true) {
    if (this.mockMode) {
      this.setDemoUser({
        uid: 'demo-user',
        email,
        displayName: email.split('@')[0] || 'Demo User',
        role: 'admin',
      });
      return;
    }

    const body = new URLSearchParams();
    body.set('username', email);
    body.set('password', password);
    const response = await firstValueFrom(
      this.http.post<{ access_token: string }>(`${environment.apiUrl}/auth/jwt/login`, body, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }),
    );
    this.setToken(response.access_token, remember);
    await this.refreshCurrentUser();
    this.ready$.next(true);
  }

  async loginAsDemo() {
    this.setDemoUser({
      uid: 'demo-subin',
      email: 'subin.suresh@caselogger.app',
      displayName: 'Subin Suresh',
      role: 'admin',
    });
  }

  async resetPassword(_email: string) {
    if (this.mockMode) {
      return;
    }
    // Not wired up yet — needs an email-sending service on the API side
    // (flagged as an open decision in the implementation plan).
    throw new Error('Password reset is not available yet.');
  }

  async logout() {
    if (this.mockMode) {
      this.setDemoUser(null);
      return;
    }
    try {
      await firstValueFrom(this.http.post(`${environment.apiUrl}/auth/jwt/logout`, {}));
    } finally {
      this.clearToken();
      this.realUser$.next(null);
    }
  }

  getToken(): string | null {
    if (typeof localStorage === 'undefined') {
      return null;
    }
    // "Keep me signed in" unchecked stores the token in sessionStorage
    // instead (cleared when the tab/browser closes) — checked here as a
    // fallback so a session-only login still works for the rest of the tab's
    // lifetime.
    return localStorage.getItem(JWT_STORAGE_KEY) ?? sessionStorage.getItem(JWT_STORAGE_KEY);
  }

  private async refreshCurrentUser() {
    const me = await firstValueFrom(
      this.http.get<MeResponse>(`${environment.apiUrl}/users/me`),
    );
    this.realUser$.next({
      uid: me.id,
      email: me.email,
      displayName: me.name,
      role: me.isSuperuser ? 'admin' : 'agent',
    });
  }

  private setToken(token: string, remember: boolean) {
    if (typeof localStorage !== 'undefined') {
      (remember ? localStorage : sessionStorage).setItem(JWT_STORAGE_KEY, token);
    }
  }

  private clearToken() {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(JWT_STORAGE_KEY);
      sessionStorage.removeItem(JWT_STORAGE_KEY);
    }
  }

  private loadDemoUser(): AppUser | null {
    if (typeof sessionStorage === 'undefined') {
      return null;
    }
    const raw = sessionStorage.getItem(DEMO_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AppUser) : null;
  }

  private setDemoUser(appUser: AppUser | null) {
    this.demoUser$.next(appUser);
    if (typeof sessionStorage === 'undefined') {
      return;
    }
    if (appUser) {
      sessionStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(appUser));
    } else {
      sessionStorage.removeItem(DEMO_STORAGE_KEY);
    }
  }
}
