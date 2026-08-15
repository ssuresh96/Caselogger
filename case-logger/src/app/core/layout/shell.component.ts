import { Component, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink, RouterLinkActive, RouterOutlet, Router, NavigationEnd } from '@angular/router';
import { NgbDropdownModule } from '@ng-bootstrap/ng-bootstrap';
import { AsyncPipe } from '@angular/common';
import { animate, style, transition, trigger } from '@angular/animations';
import { filter, map, startWith } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { CaseDialogService } from '../services/case-dialog.service';
import { IconComponent } from '../../shared/components/icon/icon.component';

interface NavChild {
  label: string;
  path: string;
}

interface NavItem {
  label: string;
  icon: string;
  path?: string;
  action?: 'create-case';
  children?: NavChild[];
  activePrefix?: string;
  adminOnly?: boolean;
}

// Hand-drawn stroke icons matching the design mockup exactly (24x24
// viewBox, stroke=currentColor) — deliberately not Material Icons, whose
// filled/rounded glyphs read as a visibly different icon language.
const NAV_ICON_PATHS: Record<string, string> = {
  Dashboard: 'M4 4h6v7H4zM4 15h6v5H4zM14 4h6v5h-6zM14 13h6v7h-6z',
  'My Cases': 'M9 3h6v3H9zM6 6h12v14H6zM9 11h6M9 15h4',
  'All Cases': 'M4 6h16M4 12h16M4 18h16',
  'Create Case': 'M12 4v16M4 12h16',
  Reports: 'M5 20V11M12 20V4M19 20v-6',
  Admin: 'M12 3l7 3v6c0 4-3 7-7 8-4-1-7-4-7-8V6z',
};

const SUB_ICON_PATHS: Record<string, string> = {
  'Monthly Dashboard': 'M4 5h16v14H4zM4 10h16M9 10v9',
  'Case Volume': 'M4 19h16M7 19v-7M12 19V6M17 19v-4',
  Workload: 'M12 20a8 8 0 1 0-8-8M12 20a8 8 0 0 0 8-8M12 12l5-3',
  'Category & Product': 'M4 5h7v7H4zM13 5h7v7h-7zM4 14h7v6H4zM13 14h7v6h-7z',
  'Team Workload':
    'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20c0-3 3-5 6-5s6 2 6 5M17 8a2.5 2.5 0 1 1 0 5M17 15c2.5 0 4 1.6 4 4',
  Users: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 4-6 8-6s8 2 8 6',
  Products: 'M12 3l8 4.5v9L12 21 4 16.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9',
  Categories: 'M4 5h7v7H4zM13 5h7v7h-7zM4 14h7v6H4zM13 14h7v6h-7z',
  Markets: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  Statuses: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8.5 12.5l2.5 2.5 4.5-5',
  Types: 'M4 6h11l5 6-5 6H4z',
  'Import Cases': 'M12 4v10m0 0l-4-4m4 4l4-4M4 18h16',
};

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, IconComponent, NgbDropdownModule, AsyncPipe],
  templateUrl: './shell.component.html',
  styleUrl: './shell.component.scss',
  animations: [
    // Re-fires on every navigation since the bound expression (the url)
    // changes even though <main> itself never leaves the DOM — the
    // standard pattern for a route-level transition without wrapping
    // <router-outlet> in structural directives.
    trigger('routeFade', [
      transition('* <=> *', [
        style({ opacity: 0, transform: 'translateY(4px)' }),
        animate('180ms ease-out', style({ opacity: 1, transform: 'translateY(0)' })),
      ]),
    ]),
  ],
})
export class ShellComponent {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly caseDialogService = inject(CaseDialogService);

  readonly currentUser$ = this.authService.currentUser$;
  readonly currentRole = toSignal(
    this.authService.currentUser$.pipe(map((u) => u?.role ?? 'agent')),
    { initialValue: 'agent' as const },
  );
  readonly sidebarCollapsed = signal(false);
  readonly mobileNavOpen = signal(false);

  readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );

  readonly pageTitle = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map(() => this.readTitleFromRoute()),
      startWith(this.readTitleFromRoute()),
    ),
    { initialValue: 'Dashboard' },
  );

  readonly navItems: NavItem[] = [
    { label: 'Dashboard', path: '/dashboard', icon: 'space_dashboard' },
    { label: 'My Cases', path: '/my-cases', icon: 'assignment_ind' },
    { label: 'All Cases', path: '/cases', icon: 'list_alt' },
    { label: 'Create Case', icon: 'add_circle', action: 'create-case' },
    {
      label: 'Reports',
      path: '/reports/monthly',
      icon: 'bar_chart',
      activePrefix: '/reports',
      children: [
        { label: 'Monthly Dashboard', path: '/reports/monthly' },
        { label: 'Case Volume', path: '/reports/case-volume' },
        { label: 'Workload', path: '/reports/workload' },
        { label: 'Category & Product', path: '/reports/category-product' },
        { label: 'Team Workload', path: '/reports/team-workload' },
      ],
    },
    {
      label: 'Admin',
      path: '/admin/users',
      icon: 'admin_panel_settings',
      activePrefix: '/admin',
      adminOnly: true,
      children: [
        { label: 'Users', path: '/admin/users' },
        { label: 'Products', path: '/admin/reference/product' },
        { label: 'Categories', path: '/admin/reference/category' },
        { label: 'Markets', path: '/admin/reference/market' },
        { label: 'Statuses', path: '/admin/reference/status' },
        { label: 'Types', path: '/admin/reference/type' },
        { label: 'Import Cases', path: '/admin/import-cases' },
      ],
    },
  ];

  toggleNav() {
    this.sidebarCollapsed.update((v) => !v);
    this.mobileNavOpen.update((v) => !v);
  }

  closeMobileNav() {
    this.mobileNavOpen.set(false);
  }

  openCreateCase() {
    this.closeMobileNav();
    this.caseDialogService.openCreateCase();
  }

  isParentActive(item: NavItem): boolean {
    return !!item.activePrefix && this.currentUrl().startsWith(item.activePrefix);
  }

  navIconPath(label: string): string {
    return NAV_ICON_PATHS[label] ?? '';
  }

  subIconPath(label: string): string {
    return SUB_ICON_PATHS[label] ?? '';
  }

  initials(name: string | null | undefined): string {
    if (!name) {
      return '?';
    }
    const parts = name.trim().split(/\s+/);
    const first = parts[0]?.[0] ?? '';
    const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
    return (first + last).toUpperCase();
  }

  logout() {
    this.authService.logout();
    this.router.navigateByUrl('/login');
  }

  private readTitleFromRoute(): string {
    let route = this.router.routerState.snapshot.root;
    let title = 'Dashboard';
    while (route.firstChild) {
      route = route.firstChild;
      if (route.data['title']) {
        title = route.data['title'] as string;
      }
    }
    return title;
  }
}
