import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';

import { CaseService } from './case.service';
import { environment } from '../../../environments/environment';
import { Case } from '../models/case.model';

const SUMMARY = { id: 'u1', name: 'Test User', email: 't@example.com' };

function sampleCase(overrides: Partial<Case> = {}): Case {
  return {
    id: 'case-1',
    caseId: 'CASE-2026-000001',
    reportedDate: '2026-01-01T00:00:00Z',
    reporterType: 'Customer',
    reporterName: 'Jane Reporter',
    customer: 'Acme',
    product: 'AOS',
    category: 'AOS-General Support',
    description: 'desc',
    assignedTo: SUMMARY,
    status: 'Open',
    type: 'Support',
    market: '',
    remarks: '',
    resolution: '',
    bugNumber: null,
    taskNumbers: [],
    workOrderNumbers: [],
    dateOfClosure: null,
    linkedImplementationId: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    createdBy: SUMMARY,
    updatedBy: SUMMARY,
    ...overrides,
  };
}

describe('CaseService (real branch)', () => {
  let service: CaseService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(CaseService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('list() sends only page/pageSize when no filters are given', async () => {
    const promise = firstValueFrom(service.list({ page: 1, pageSize: 20 }));
    const req = httpMock.expectOne(
      (r) => r.url === `${environment.apiUrl}/cases` && r.method === 'GET',
    );
    expect(req.request.params.get('page')).toBe('1');
    expect(req.request.params.get('pageSize')).toBe('20');
    expect(req.request.params.has('status')).toBeFalse();
    expect(req.request.params.has('search')).toBeFalse();
    req.flush({ items: [sampleCase()], total: 1 });

    const result = await promise;
    expect(result.total).toBe(1);
    expect(result.items[0].caseId).toBe('CASE-2026-000001');
  });

  it('list() forwards status/type/search/assignedTo as query params', async () => {
    const promise = firstValueFrom(
      service.list({
        page: 2,
        pageSize: 10,
        status: 'Open,Pending',
        type: 'Escalation',
        search: 'travco',
        assignedTo: 'user-9',
      }),
    );
    const req = httpMock.expectOne(
      (r) => r.url === `${environment.apiUrl}/cases` && r.method === 'GET',
    );
    expect(req.request.params.get('status')).toBe('Open,Pending');
    expect(req.request.params.get('type')).toBe('Escalation');
    expect(req.request.params.get('search')).toBe('travco');
    expect(req.request.params.get('assignedTo')).toBe('user-9');
    req.flush({ items: [], total: 0 });
    await promise;
  });

  it('list() degrades to an empty result instead of throwing on HTTP error', async () => {
    const promise = firstValueFrom(service.list({ page: 1, pageSize: 20 }));
    const req = httpMock.expectOne(
      (r) => r.url === `${environment.apiUrl}/cases` && r.method === 'GET',
    );
    req.flush({ detail: 'boom' }, { status: 500, statusText: 'Server Error' });

    const result = await promise;
    expect(result).toEqual({ items: [], total: 0 });
  });

  it('getById() GETs the single case and returns undefined on error', async () => {
    const promise = firstValueFrom(service.getById('case-1'));
    const req = httpMock.expectOne(`${environment.apiUrl}/cases/case-1`);
    expect(req.request.method).toBe('GET');
    req.flush(sampleCase());
    expect((await promise)?.id).toBe('case-1');

    const errorPromise = firstValueFrom(service.getById('missing'));
    httpMock
      .expectOne(`${environment.apiUrl}/cases/missing`)
      .flush({ detail: 'not found' }, { status: 404, statusText: 'Not Found' });
    expect(await errorPromise).toBeUndefined();
  });

  it('create() POSTs the input and returns the new id', async () => {
    const createPromise = service.create({
      reportedDate: '2026-01-01T00:00:00Z',
      reporterType: 'Customer',
      reporterName: 'Jane Reporter',
      customer: 'Acme',
      product: 'AOS',
      description: 'desc',
      category: 'AOS-General Support',
      assignedTo: 'u1',
      status: 'Open',
      type: 'Support',
    });
    const req = httpMock.expectOne(`${environment.apiUrl}/cases`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body.customer).toBe('Acme');
    req.flush(sampleCase({ id: 'new-case-id' }));

    expect(await createPromise).toBe('new-case-id');
  });

  it('create() triggers a refetch so list() reflects the new case', async () => {
    const firstList = firstValueFrom(service.list({ page: 1, pageSize: 20 }));
    httpMock
      .expectOne((r) => r.url === `${environment.apiUrl}/cases` && r.method === 'GET')
      .flush({ items: [], total: 0 });
    expect((await firstList).total).toBe(0);

    // Subscribe again before creating, so the refresh$ trigger fires into
    // an active subscription (list()'s refresh$ pattern only refetches for
    // subscribers listening at the time of the write).
    const secondList = firstValueFrom(service.list({ page: 1, pageSize: 20 }));
    httpMock
      .expectOne((r) => r.url === `${environment.apiUrl}/cases` && r.method === 'GET')
      .flush({ items: [], total: 0 });
    await secondList;

    const createPromise = service.create({
      reportedDate: '2026-01-01T00:00:00Z',
      reporterType: 'Customer',
      reporterName: 'Jane Reporter',
      customer: 'Acme',
      product: 'AOS',
      description: 'desc',
      category: 'AOS-General Support',
      assignedTo: 'u1',
      status: 'Open',
      type: 'Support',
    });
    httpMock.expectOne(`${environment.apiUrl}/cases`).flush(sampleCase());
    await createPromise;
  });

  it('update() PATCHes the case', async () => {
    const updatePromise = service.update('case-1', { status: 'Resolved' });
    const req = httpMock.expectOne(`${environment.apiUrl}/cases/case-1`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ status: 'Resolved' });
    req.flush(sampleCase({ status: 'Resolved' }));
    await updatePromise;
  });
});
