import { Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { environment } from '../../../../environments/environment';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { SpinnerComponent } from '../../../shared/components/spinner/spinner.component';
import { ToastService } from '../../../core/services/toast.service';

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule, IconComponent, SpinnerComponent],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent {
  private readonly fb = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  // TEMPORARY: shows a prototype-mode hint + one-click demo entry while
  // useMockAuth is on. Remove alongside the mock branches in AuthService
  // if mock mode is ever retired.
  readonly isPrototypeMode = environment.useMockAuth;

  readonly errorMessage = signal<string | null>(null);
  readonly infoMessage = signal<string | null>(null);
  readonly submitting = signal(false);
  readonly showPassword = signal(false);
  readonly rememberMe = signal(true);

  // Generic feature copy for the right-hand panel — no specific numbers,
  // since the login screen is pre-auth and can't show real figures without
  // risking stale/fabricated data being read as live stats.
  readonly heroPoints = [
    'Log a case in under a minute, with WO numbers attached',
    'Monthly report recalculates as cases come in — no spreadsheets',
    'Admin controls products, categories, customers and assignment',
  ];

  readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
  });

  togglePasswordVisibility() {
    this.showPassword.update((value) => !value);
  }

  async submit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.errorMessage.set(null);
    this.infoMessage.set(null);
    this.submitting.set(true);
    const { email, password } = this.form.getRawValue();
    try {
      await this.authService.login(email, password, this.rememberMe());
      this.router.navigateByUrl('/dashboard');
    } catch (err) {
      this.errorMessage.set(this.describeLoginError(err));
    } finally {
      this.submitting.set(false);
    }
  }

  private describeLoginError(err: unknown): string {
    if (!(err instanceof HttpErrorResponse)) {
      return 'Login failed. Check your email and password.';
    }
    if (err.status === 429) {
      return 'Too many login attempts from this device. Please wait a minute and try again.';
    }
    // Account-lockout policy (plan §10) — the backend returns a structured
    // detail object for these two cases, not just a plain string.
    const detail = err.error?.detail;
    if (detail?.code === 'ACCOUNT_LOCKED') {
      const minutes = Math.max(1, Math.ceil((detail.retryAfterSeconds ?? 0) / 60));
      return `This account is locked after too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}, or ask an admin to unlock it.`;
    }
    if (detail?.code === 'LOGIN_BAD_CREDENTIALS' && typeof detail.attemptsRemaining === 'number') {
      const { attemptsRemaining } = detail;
      return `Incorrect email or password. ${attemptsRemaining} attempt${attemptsRemaining === 1 ? '' : 's'} left before this account is locked.`;
    }
    return 'Login failed. Check your email and password.';
  }

  async continueAsDemo() {
    this.errorMessage.set(null);
    this.infoMessage.set(null);
    this.submitting.set(true);
    try {
      await this.authService.loginAsDemo();
      this.router.navigateByUrl('/dashboard');
    } finally {
      this.submitting.set(false);
    }
  }

  continueWithSso() {
    this.toast.info('Company SSO isn\'t set up for this workspace yet — sign in with email and password.');
  }

  async forgotPassword() {
    const email = this.form.getRawValue().email;
    if (!email) {
      this.errorMessage.set('Enter your email above, then click "Forgot password".');
      return;
    }
    this.errorMessage.set(null);
    try {
      await this.authService.resetPassword(email);
      this.infoMessage.set('Password reset email sent — check your inbox.');
    } catch {
      this.errorMessage.set('Could not send reset email for that address.');
    }
  }
}
