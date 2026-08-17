import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { AuthService } from './auth.service';
import { environment } from '../../../environments/environment';
import { AppUser } from '../models/user-role.model';

const JWT_KEY = 'case-logger.jwt';

// These exercise the real (non-mock) branch only — environment.useMockAuth
// is false by default, and mock mode has no HttpClient interaction to test.
describe('AuthService (real branch)', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withXhr()), provideHttpClientTesting()],
    });
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  it('login() posts form-encoded credentials, stores the token, and populates currentUser$', fakeAsync(() => {
    const service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
    tick(); // flush the constructor's no-token microtask

    let resolved = false;
    service.login('admin@example.com', 'secret123').then(() => (resolved = true));

    const loginReq = httpMock.expectOne(`${environment.apiUrl}/auth/jwt/login`);
    expect(loginReq.request.method).toBe('POST');
    expect(loginReq.request.headers.get('Content-Type')).toBe('application/x-www-form-urlencoded');
    const body = loginReq.request.body as URLSearchParams;
    expect(body.get('username')).toBe('admin@example.com');
    expect(body.get('password')).toBe('secret123');
    loginReq.flush({ access_token: 'test-jwt-token' });
    tick();

    const meReq = httpMock.expectOne(`${environment.apiUrl}/users/me`);
    expect(meReq.request.method).toBe('GET');
    meReq.flush({ id: 'user-1', email: 'admin@example.com', name: 'Admin User', isSuperuser: true });
    tick();

    expect(resolved).toBeTrue();
    expect(service.getToken()).toBe('test-jwt-token');
    let user: AppUser | null | undefined;
    service.currentUser$.subscribe((u) => (user = u));
    expect(user).toEqual({
      uid: 'user-1',
      email: 'admin@example.com',
      displayName: 'Admin User',
      role: 'admin',
    });
  }));

  it('login() maps isSuperuser:false to the agent role', fakeAsync(() => {
    const service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
    tick();

    service.login('agent@example.com', 'secret123');
    httpMock.expectOne(`${environment.apiUrl}/auth/jwt/login`).flush({ access_token: 'tok' });
    tick();
    httpMock
      .expectOne(`${environment.apiUrl}/users/me`)
      .flush({ id: 'user-2', email: 'agent@example.com', name: 'Agent', isSuperuser: false });
    tick();

    let user: AppUser | null | undefined;
    service.currentUser$.subscribe((u) => (user = u));
    expect(user?.role).toBe('agent');
  }));

  it('a stored token on construction triggers a deferred /users/me refresh', fakeAsync(() => {
    localStorage.setItem(JWT_KEY, 'existing-token');
    const service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
    tick(); // let the constructor's queueMicrotask run and issue the request

    const meReq = httpMock.expectOne(`${environment.apiUrl}/users/me`);
    meReq.flush({ id: 'user-1', email: 'admin@example.com', name: 'Admin User', isSuperuser: true });
    tick();

    let ready: boolean | undefined;
    service.authReady$.subscribe((r) => (ready = r));
    expect(ready).toBeTrue();
    let user: AppUser | null | undefined;
    service.currentUser$.subscribe((u) => (user = u));
    expect(user?.email).toBe('admin@example.com');
  }));

  it('a stored token that fails to refresh is cleared and authReady still resolves', fakeAsync(() => {
    localStorage.setItem(JWT_KEY, 'bad-token');
    const service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
    tick();

    const meReq = httpMock.expectOne(`${environment.apiUrl}/users/me`);
    meReq.flush({ detail: 'Unauthorized' }, { status: 401, statusText: 'Unauthorized' });
    tick();

    expect(service.getToken()).toBeNull();
    let ready: boolean | undefined;
    service.authReady$.subscribe((r) => (ready = r));
    expect(ready).toBeTrue();
  }));

  it('getToken() returns null when nothing is stored', fakeAsync(() => {
    const service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
    tick();
    expect(service.getToken()).toBeNull();
  }));

  it('logout() posts to /auth/jwt/logout and clears the stored token', fakeAsync(() => {
    localStorage.setItem(JWT_KEY, 'existing-token');
    const service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
    tick();
    httpMock.expectOne(`${environment.apiUrl}/users/me`).flush({
      id: 'user-1',
      email: 'admin@example.com',
      name: 'Admin User',
      isSuperuser: true,
    });
    tick();

    let resolved = false;
    service.logout().then(() => (resolved = true));
    const logoutReq = httpMock.expectOne(`${environment.apiUrl}/auth/jwt/logout`);
    expect(logoutReq.request.method).toBe('POST');
    logoutReq.flush({});
    tick();

    expect(resolved).toBeTrue();
    expect(service.getToken()).toBeNull();
    let user: AppUser | null | undefined;
    service.currentUser$.subscribe((u) => (user = u));
    expect(user).toBeNull();
  }));

  it('logout() still clears local state even if the API call fails', fakeAsync(() => {
    localStorage.setItem(JWT_KEY, 'existing-token');
    const service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
    tick();
    httpMock.expectOne(`${environment.apiUrl}/users/me`).flush({
      id: 'user-1',
      email: 'admin@example.com',
      name: 'Admin User',
      isSuperuser: true,
    });
    tick();

    let rejected = false;
    service.logout().catch(() => (rejected = true));
    httpMock
      .expectOne(`${environment.apiUrl}/auth/jwt/logout`)
      .flush({ detail: 'error' }, { status: 500, statusText: 'Server Error' });
    tick();

    expect(rejected).toBeTrue();
    expect(service.getToken()).toBeNull();
  }));

  it('resetPassword() rejects — no email service wired up yet', async () => {
    const service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
    await expectAsync(service.resetPassword('someone@example.com')).toBeRejected();
  });
});
