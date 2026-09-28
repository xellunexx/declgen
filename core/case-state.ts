import { createHash } from 'node:crypto';

export type CaseStage = 'NEW'|'INPUT_SELECTED'|'EXTRACTED'|'RESOLVED'|'REVIEW_REQUIRED'|'BUILDABLE'|'BUILT'|'VALIDATED'|'READY'|'STALE'|'APPROVED'|'EXPORTED';

function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o).sort().map(k => `${JSON.stringify(k)}:${stable(o[k])}`).join(',')}}`;
}

export function fingerprint(payload: unknown): string {
  return createHash('sha256').update(stable(payload)).digest('hex');
}

export interface BuildSnapshot {
  invoice: unknown;
  client_id: string;
  direction_ex: boolean;
  extras: unknown;
  packing: unknown;
  waybill: unknown;
  classification_decisions: Record<string, unknown>;
}

export function buildSnapshot(invoice: unknown, clientId: string, directionEx: boolean, extras: unknown,
  packing: unknown, waybill: unknown, classificationDecisions: Record<string, unknown> = {}): BuildSnapshot {
  return structuredClone({ invoice, client_id: String(clientId || ''), direction_ex: !!directionEx, extras, packing, waybill, classification_decisions: classificationDecisions });
}

export interface CaseStateJson {
  case_revision: number;
  built_from_revision: number | null;
  validated_revision: number | null;
  built_fingerprint: string | null;
  approved: boolean;
  stage: CaseStage;
  last_reason?: string;
}

export class CaseState {
  case_revision = 0;
  built_from_revision: number | null = null;
  validated_revision: number | null = null;
  built_fingerprint: string | null = null;
  approved = false;
  stage: CaseStage = 'NEW';
  last_reason = '';

  constructor(data?: Partial<CaseStateJson>) { if (data) Object.assign(this, data); }

  get frozen(): boolean { return this.stage === 'APPROVED' || this.stage === 'EXPORTED' || this.approved; }

  assertMutable(action = 'change case data'): void {
    if (this.frozen) throw new Error(`Случаят е ${this.stage} и е замразен. Стартирайте Нова поръчка преди: ${action}.`);
  }

  selectInput(reason = 'input selected') {
    this.assertMutable('select input');
    this.last_reason = reason;
    if (this.stage === 'NEW') this.stage = 'INPUT_SELECTED';
  }

  bump(reason = ''): number {
    this.assertMutable(reason || 'canonical update');
    this.case_revision += 1;
    this.approved = false;
    this.last_reason = reason;
    if (this.built_from_revision !== null) this.stage = 'STALE';
    else this.stage = 'RESOLVED';
    return this.case_revision;
  }

  markExtracted() { this.assertMutable('extraction'); this.stage = 'EXTRACTED'; }
  markReviewRequired(required: boolean) { this.assertMutable('review state'); this.stage = required ? 'REVIEW_REQUIRED' : 'BUILDABLE'; }

  markBuilt(fp: string): void {
    this.assertMutable('build declaration');
    this.built_from_revision = this.case_revision;
    this.built_fingerprint = fp;
    this.validated_revision = null;
    this.approved = false;
    this.stage = 'BUILT';
  }

  markValidated(noBlockers = true): void {
    this.assertMutable('validate declaration');
    if (this.built_from_revision === null) throw new Error('markValidated() before any build');
    if (this.built_from_revision !== this.case_revision) throw new Error('cannot validate stale build');
    if (!noBlockers) { this.validated_revision = null; this.stage = 'BUILT'; return; }
    this.validated_revision = this.built_from_revision;
    this.stage = 'VALIDATED';
  }

  markReady(blockers: string[]): void {
    this.assertMutable('mark ready');
    if (blockers.length) { if (this.stage === 'READY') this.stage = 'VALIDATED'; return; }
    if (this.built_from_revision === this.case_revision && this.validated_revision === this.case_revision) this.stage = 'READY';
  }

  markApproved(): void {
    if (this.stage !== 'READY') throw new Error(`approve blocked: case stage is ${this.stage}, expected READY`);
    const blockers = this.readyBlockers();
    if (blockers.length) throw new Error(`approve blocked: ${blockers.join('; ')}`);
    this.approved = true;
    this.stage = 'APPROVED';
  }

  markExported(): void {
    if (!this.approved || this.stage !== 'APPROVED') throw new Error('export requires APPROVED state');
    this.stage = 'EXPORTED';
  }

  readyBlockers(): string[] {
    const out: string[] = [];
    if (this.frozen) out.push(`случаят вече е ${this.stage} и е замразен`);
    if (this.case_revision === 0) out.push('няма потвърдени канонични данни за пратката');
    if (this.built_from_revision === null) out.push('няма генерирана декларация (②)');
    else if (this.built_from_revision !== this.case_revision) out.push(`декларацията е от ревизия ${this.built_from_revision}, но каноничните данни са на ревизия ${this.case_revision} — натиснете ② отново`);
    if (this.validated_revision === null || this.validated_revision !== this.case_revision || this.validated_revision !== this.built_from_revision) out.push('conformance проверката не е минала за текущата ревизия');
    return out;
  }

  driftBlockers(currentFingerprint: string | null): string[] {
    if (!this.built_fingerprint) return [];
    if (!currentFingerprint) return ['текущото състояние не може да бъде доказано'];
    return currentFingerprint === this.built_fingerprint ? [] : ['има промени след последното генериране — натиснете ② отново'];
  }

  toJSON(): CaseStateJson {
    return { case_revision: this.case_revision, built_from_revision: this.built_from_revision, validated_revision: this.validated_revision, built_fingerprint: this.built_fingerprint, approved: this.approved, stage: this.stage, last_reason: this.last_reason };
  }

  static fromJSON(data: unknown): CaseState { return new CaseState((data && typeof data === 'object' ? data : {}) as Partial<CaseStateJson>); }
}
