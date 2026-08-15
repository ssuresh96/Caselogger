import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ImplementationDetailComponent } from './implementation-detail.component';

describe('ImplementationDetailComponent', () => {
  let component: ImplementationDetailComponent;
  let fixture: ComponentFixture<ImplementationDetailComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ImplementationDetailComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ImplementationDetailComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
