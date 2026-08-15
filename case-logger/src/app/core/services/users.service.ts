import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, catchError, firstValueFrom, of, switchMap } from 'rxjs';
import { UserSummary } from '../models/user-summary.model';
import { environment } from '../../../environments/environment';

export interface AdminUser extends UserSummary {
  isActive: boolean;
  isSuperuser: boolean;
  isLocked: boolean;
}

export interface CreateUserInput {
  name: string;
  email: string;
  password: string;
  isSuperuser: boolean;
}

export interface UpdateUserInput {
  name?: string;
  isActive?: boolean;
  isSuperuser?: boolean;
}

// TEMPORARY (prototype-only): shared with CaseService's mock seed data so
// mock-mode cases reference the same fake users this list returns.
const MOCK_USERS_SEED: AdminUser[] = [
  {
    id: 'mock-user-neeraj',
    name: 'Neeraj Sharma',
    email: 'neeraj.sharma@caselogger.app',
    isActive: true,
    isSuperuser: false,
    isLocked: false,
  },
  {
    id: 'mock-user-priya',
    name: 'Priya Menon',
    email: 'priya.menon@caselogger.app',
    isActive: true,
    isSuperuser: false,
    isLocked: false,
  },
  {
    id: 'mock-user-subin',
    name: 'Subin Suresh',
    email: 'subin.suresh@caselogger.app',
    isActive: true,
    isSuperuser: true,
    isLocked: false,
  },
  {
    id: 'mock-user-arjun',
    name: 'Arjun Nair',
    email: 'arjun.nair@caselogger.app',
    isActive: true,
    isSuperuser: false,
    isLocked: false,
  },
  {
    id: 'mock-user-fatima',
    name: 'Fatima Al Sayed',
    email: 'fatima.alsayed@caselogger.app',
    isActive: true,
    isSuperuser: false,
    isLocked: false,
  },
];

export const MOCK_USERS: UserSummary[] = MOCK_USERS_SEED;

@Injectable({ providedIn: 'root' })
export class UsersService {
  private readonly http = inject(HttpClient);
  private readonly mockMode = environment.useMockAuth;

  private readonly mockUsers$ = new BehaviorSubject<AdminUser[]>(MOCK_USERS_SEED);
  private readonly refresh$ = new BehaviorSubject<void>(undefined);

  list(): Observable<AdminUser[]> {
    if (this.mockMode) {
      return this.mockUsers$.asObservable();
    }
    return this.refresh$.pipe(
      switchMap(() =>
        this.http
          .get<AdminUser[]>(`${environment.apiUrl}/users`)
          .pipe(catchError(() => of([]))),
      ),
    );
  }

  async createUser(input: CreateUserInput): Promise<AdminUser> {
    if (this.mockMode) {
      const user: AdminUser = {
        id: `mock-user-new-${Date.now()}`,
        name: input.name,
        email: input.email,
        isActive: true,
        isSuperuser: input.isSuperuser,
        isLocked: false,
      };
      this.mockUsers$.next([...this.mockUsers$.value, user]);
      return user;
    }
    const created = await firstValueFrom(
      this.http.post<AdminUser>(`${environment.apiUrl}/auth/register`, input),
    );
    this.refresh$.next();
    return created;
  }

  async updateUser(id: string, patch: UpdateUserInput): Promise<AdminUser> {
    if (this.mockMode) {
      let updated: AdminUser | undefined;
      this.mockUsers$.next(
        this.mockUsers$.value.map((u) => {
          if (u.id !== id) {
            return u;
          }
          updated = { ...u, ...patch };
          return updated;
        }),
      );
      return updated!;
    }
    const result = await firstValueFrom(
      this.http.patch<AdminUser>(`${environment.apiUrl}/users/${id}`, patch),
    );
    this.refresh$.next();
    return result;
  }

  async unlockUser(id: string): Promise<AdminUser> {
    if (this.mockMode) {
      let updated: AdminUser | undefined;
      this.mockUsers$.next(
        this.mockUsers$.value.map((u) => {
          if (u.id !== id) {
            return u;
          }
          updated = { ...u, isLocked: false };
          return updated;
        }),
      );
      return updated!;
    }
    const result = await firstValueFrom(
      this.http.post<AdminUser>(`${environment.apiUrl}/users/${id}/unlock`, {}),
    );
    this.refresh$.next();
    return result;
  }
}
