import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { roleGuard } from './core/guards/role.guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () =>
      import('./features/auth/login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./core/layout/shell.component').then((m) => m.ShellComponent),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        data: { title: 'Dashboard' },
        loadComponent: () =>
          import('./features/dashboard/dashboard/dashboard.component').then(
            (m) => m.DashboardComponent,
          ),
      },
      {
        path: 'my-cases',
        data: { scope: 'mine', title: 'My Cases' },
        loadComponent: () =>
          import('./features/case-list/case-list/case-list.component').then(
            (m) => m.CaseListComponent,
          ),
      },
      {
        path: 'cases',
        data: { scope: 'all', title: 'All Cases' },
        loadComponent: () =>
          import('./features/case-list/case-list/case-list.component').then(
            (m) => m.CaseListComponent,
          ),
      },
      {
        path: 'cases/:id',
        data: { title: 'Case Detail' },
        loadComponent: () =>
          import('./features/case-detail/case-detail/case-detail.component').then(
            (m) => m.CaseDetailComponent,
          ),
      },
      { path: 'reports', pathMatch: 'full', redirectTo: 'reports/monthly' },
      {
        path: 'reports/:view',
        data: { title: 'Reports' },
        loadComponent: () =>
          import('./features/reports/reports.component').then((m) => m.ReportsComponent),
      },
      { path: 'admin', pathMatch: 'full', redirectTo: 'admin/users' },
      {
        path: 'admin/users',
        canActivate: [roleGuard],
        data: { role: 'admin', title: 'Admin · Users' },
        loadComponent: () =>
          import('./features/admin/admin-users/admin-users.component').then(
            (m) => m.AdminUsersComponent,
          ),
      },
      {
        path: 'admin/reference/:kind',
        canActivate: [roleGuard],
        data: { role: 'admin', title: 'Admin' },
        loadComponent: () =>
          import('./features/admin/admin-reference-list/admin-reference-list.component').then(
            (m) => m.AdminReferenceListComponent,
          ),
      },
      {
        path: 'admin/import-cases',
        canActivate: [roleGuard],
        data: { role: 'admin', title: 'Admin · Import Cases' },
        loadComponent: () =>
          import('./features/admin/admin-import-cases/admin-import-cases.component').then(
            (m) => m.AdminImportCasesComponent,
          ),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
