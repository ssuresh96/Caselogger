import { Component, input, ChangeDetectionStrategy } from '@angular/core';

// Keeps every call site using the same short logical names the app used
// under Angular Material (`<mat-icon>edit</mat-icon>`) — only this map
// changes if the icon set is ever swapped again.
const ICON_MAP: Record<string, string> = {
  add: 'plus-lg',
  admin_panel_settings: 'shield-lock-fill',
  bolt: 'lightning-charge-fill',
  calendar_month: 'calendar3',
  check: 'check-lg',
  check_circle: 'check-circle-fill',
  chevron_left: 'chevron-left',
  chevron_right: 'chevron-right',
  close: 'x-lg',
  delete: 'trash',
  download: 'download',
  edit: 'pencil-fill',
  expand_less: 'chevron-up',
  expand_more: 'chevron-down',
  folder_open: 'folder2-open',
  inbox: 'inbox',
  info: 'info-circle-fill',
  lightbulb: 'lightbulb-fill',
  lock: 'lock-fill',
  logout: 'box-arrow-right',
  mail: 'envelope-fill',
  menu: 'list',
  more_horiz: 'three-dots',
  more_vert: 'three-dots-vertical',
  notifications: 'bell-fill',
  save: 'save-fill',
  schedule: 'clock-history',
  science: 'flask',
  search: 'search',
  send: 'send-fill',
  upload_file: 'file-earmark-arrow-up',
  visibility: 'eye-fill',
  visibility_off: 'eye-slash-fill',
  warning: 'exclamation-triangle-fill',
};

@Component({
  selector: 'app-icon',
  template: `<i class="bi" [class]="'bi-' + glyph()" aria-hidden="true"></i>`,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      line-height: 1;
    }
    i {
      font-size: inherit;
    }
  `,
})
export class IconComponent {
  readonly name = input.required<string>();

  glyph(): string {
    return ICON_MAP[this.name()] ?? this.name();
  }
}
