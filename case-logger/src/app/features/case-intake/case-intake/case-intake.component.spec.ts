import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient, withXhr } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';

import { CaseIntakeComponent } from './case-intake.component';

describe('CaseIntakeComponent', () => {
  let component: CaseIntakeComponent;
  let fixture: ComponentFixture<CaseIntakeComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CaseIntakeComponent],
      providers: [
        provideHttpClient(withXhr()),
        provideHttpClientTesting(),
        { provide: NgbActiveModal, useValue: { close: () => {}, dismiss: () => {} } },
      ],
    })
    .compileComponents();

    fixture = TestBed.createComponent(CaseIntakeComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
