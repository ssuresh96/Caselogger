import { Component, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AdminUser, UsersService } from '../../../core/services/users.service';
import { AuthService } from '../../../core/services/auth.service';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { SpinnerComponent } from '../../../shared/components/spinner/spinner.component';
import { ToastService } from '../../../core/services/toast.service';

@Component({
  selector: 'app-admin-users',
  imports: [ReactiveFormsModule, IconComponent, SpinnerComponent],
  templateUrl: './admin-users.component.html',
  styleUrl: './admin-users.component.scss',
})
export class AdminUsersComponent {
  private readonly fb = inject(FormBuilder);
  private readonly usersService = inject(UsersService);
  private readonly authService = inject(AuthService);
  private readonly toast = inject(ToastService);

  readonly users = toSignal(this.usersService.list(), { initialValue: [] as AdminUser[] });
  readonly currentUser = toSignal(this.authService.currentUser$, { initialValue: null });

  readonly showAddForm = signal(false);
  readonly submitting = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    name: ['', Validators.required],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8)]],
    isSuperuser: [false],
  });

  isSelf(user: AdminUser): boolean {
    return user.email === this.currentUser()?.email;
  }

  toggleAddForm() {
    this.showAddForm.update((v) => !v);
    this.errorMessage.set(null);
    this.form.reset({ name: '', email: '', password: '', isSuperuser: false });
  }

  async submitAdd() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    this.errorMessage.set(null);
    try {
      await this.usersService.createUser(this.form.getRawValue());
      this.showAddForm.set(false);
      this.toast.success('User created.');
    } catch {
      this.errorMessage.set('Could not create user — check the email is not already in use.');
    } finally {
      this.submitting.set(false);
    }
  }

  async toggleActive(user: AdminUser) {
    try {
      await this.usersService.updateUser(user.id, { isActive: !user.isActive });
      this.toast.success(`${user.name} is now ${user.isActive ? 'inactive' : 'active'}.`);
    } catch {
      this.toast.error(`Could not update ${user.name} — try again.`);
    }
  }

  async toggleRole(user: AdminUser) {
    try {
      await this.usersService.updateUser(user.id, { isSuperuser: !user.isSuperuser });
      this.toast.success(`${user.name} is now ${user.isSuperuser ? 'an agent' : 'an admin'}.`);
    } catch {
      this.toast.error(`Could not update ${user.name} — try again.`);
    }
  }

  readonly unlocking = signal<string | null>(null);

  async unlock(user: AdminUser) {
    this.unlocking.set(user.id);
    try {
      await this.usersService.unlockUser(user.id);
      this.toast.success(`${user.name} unlocked.`);
    } catch {
      this.toast.error(`Could not unlock ${user.name} — try again.`);
    } finally {
      this.unlocking.set(null);
    }
  }
}
