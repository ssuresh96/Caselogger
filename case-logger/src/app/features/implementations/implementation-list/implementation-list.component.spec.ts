import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ImplementationListComponent } from './implementation-list.component';

describe('ImplementationListComponent', () => {
  let component: ImplementationListComponent;
  let fixture: ComponentFixture<ImplementationListComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ImplementationListComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ImplementationListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
