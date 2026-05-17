import { EventEmitter } from 'events';
import { tagEvent, isSnapshotBoundary, escalateSalience, type TaggedEvent } from './EventTagger.js';
import { SessionLogger } from './SessionLogger.js';
import { EvidenceGate } from './EvidenceGate.js';
import { NohupMdWriter, type Category } from './NohupMdWriter.js';
import { DecayEngine } from './DecayEngine.js';
import { EventCompactor, SessionCompactor } from './Compactor.js';
import { Reconsolidator } from './Reconsolidator.js';
import { SpacedRepetition } from './SpacedRepetition.js';

export interface MementoEngineOpts {
  projectRoot: string;
  sessionId:   string;
}

export class MementoEngine extends EventEmitter {
  private logger:          SessionLogger;
  private gate:            EvidenceGate;
  private writer:          NohupMdWriter;
  private decay:           DecayEngine;
  private eventCompactor:  EventCompactor;
  private sessionCompactor: SessionCompactor;
  private reconsolidator:  Reconsolidator;
  private spacedRep:       SpacedRepetition;

  private errorCounts         = new Map<string, number>();
  private pendingHighSalience: TaggedEvent[] = [];
  private eventBurst:          TaggedEvent[] = [];
  private tokenCount    = 0;
  private snapshotCount = 0;
  private readonly TOKEN_SNAPSHOT_THRESHOLD = 3000;

  constructor(private opts: MementoEngineOpts) {
    super();
    this.logger          = new SessionLogger(opts.projectRoot, opts.sessionId);
    this.gate            = new EvidenceGate(opts.projectRoot);
    this.writer          = new NohupMdWriter(opts.projectRoot);
    this.decay           = new DecayEngine();
    this.eventCompactor  = new EventCompactor();
    this.sessionCompactor = new SessionCompactor();
    this.reconsolidator  = new Reconsolidator(this.writer, this.gate);
    this.spacedRep       = new SpacedRepetition(opts.projectRoot);

    this.spacedRep.startSession();
    this.surfaceSpacedRepItems();
  }

  onLine(rawLine: string): void {
    if (!rawLine.trim()) return;
    const event = tagEvent(rawLine, this.opts.sessionId);

    if (event.type === 'error_output') {
      const key   = this.gate.patternKey(rawLine, 'error_output');
      const count = (this.errorCounts.get(key) ?? 0) + 1;
      this.errorCounts.set(key, count);
      event.salience = escalateSalience(event.salience, count);
      if (count >= 3) { this.gate.recordRetrievalFailure(key); this.spacedRep.onFailure(key); }
    }

    this.logger.log(event);
    this.eventBurst.push(event);
    this.tokenCount += Math.ceil(rawLine.length / 4);
    if (event.salience >= 0.85) this.pendingHighSalience.push(event);

    if (event.type === 'user_constraint' || event.salience >= 0.85) {
      this.reconsolidator.detectAndApply(event, this.writer.getItems());
    }

    this.writer.appendTimeline({ id: event.id, timestamp: event.timestamp,
      type: event.type, summary: event.raw.trim().slice(0, 120).replace(/\n/g, ' '),
      salience: event.salience });

    if (this.gate.observe(event)) this.handlePromotion(event);

    if (isSnapshotBoundary(rawLine) || this.tokenCount >= this.TOKEN_SNAPSHOT_THRESHOLD) {
      this.takeSnapshot();
    }
  }

  onSessionEnd(): void {
    for (const event of this.pendingHighSalience) {
      if (event.type === 'user_constraint') {
        const key = this.gate.patternKey(event.raw, event.type);
        if (!this.gate.getRecord(key)?.promoted) this.handlePromotion(event, true);
      }
    }
    this.runDecayPass();
    const { pruned } = this.sessionCompactor.compact(this.writer.getItems());
    if (pruned.length) console.log(`[memento] Session compactor pruned ${pruned.length} items`);
    this.writer.write();
    console.log(`[memento] Session ${this.opts.sessionId} ended. NOHUP.md → ${this.writer.nohupPath}`);
    this.emit('sessionEnd', { sessionId: this.opts.sessionId });
  }

  get nohupPath(): string { return this.writer.nohupPath; }

  private takeSnapshot(): void {
    this.snapshotCount++;
    this.tokenCount = 0;
    const { dropped } = this.eventCompactor.compact(this.eventBurst, this.writer.nohupPath);
    if (dropped) console.log(`[memento] Event compactor: dropped ${dropped} low-value events`);
    this.eventBurst = [];
    this.writer.write();
    this.emit('snapshot', { sessionId: this.opts.sessionId, snapshotN: this.snapshotCount });
  }

  private runDecayPass(): void {
    const items = this.writer.getItems();
    const snSince = new Map<string, number>();
    const rCounts = new Map<string, number>();
    for (const item of items) {
      const r = this.gate.getRecord(item.id);
      if (r) {
        rCounts.set(item.id, r.retrievalCount);
        snSince.set(item.id, r.lastRetrieved
          ? Math.floor((Date.now() - new Date(r.lastRetrieved).getTime()) / 86_400_000)
          : this.spacedRep.sessionNumber);
      }
    }
    const results = this.decay.computeDecay(items, snSince, rCounts);
    this.writer.applyDecayWeights(new Map(results.map(r => [r.id, r.newWeight])));
    const atFloor = results.filter(r => r.shouldPrune).length;
    if (atFloor) console.log(`[memento] Decay: ${atFloor} items at floor`);
  }

  private surfaceSpacedRepItems(): void {
    const items    = this.writer.getItems();
    const dueItems = this.spacedRep.getDueItems(items);
    if (!dueItems.length) return;
    console.log(`[memento] Spaced rep: ${dueItems.length} items due for review`);
    for (const item of dueItems) {
      const record = this.gate.getRecord(item.id);
      if (record) {
        const boosted = this.decay.boostOnRetrieval(item.weight, record.retrievalCount + 1);
        this.writer.addOrUpdateItem(record, item.content, item.category, boosted, item.locked);
        this.gate.recordRetrieval(item.id);
        this.spacedRep.onSuccess(item.id);
      }
    }
  }

  private handlePromotion(event: TaggedEvent, forced = false): void {
    const key    = this.gate.patternKey(event.raw, event.type);
    const record = this.gate.getRecord(key);
    if (!record) return;
    const category = this.inferCategory(event);
    const content  = this.summarize(event);
    const locked   = event.type === 'user_constraint';
    this.writer.addOrUpdateItem(record, content, category, event.salience, locked);
    this.gate.markPromoted(key);
    this.spacedRep.enroll({ id: key, weight: event.salience, category, locked } as any);
    console.log(`[memento] ${forced ? 'force-promoted' : `promoted (n=${record.count})`}: ${content.slice(0, 80)}`);
  }

  private inferCategory(event: TaggedEvent): Category {
    switch (event.type) {
      case 'user_constraint':  return 'constraint';
      case 'agent_reasoning':  return 'decision';
      case 'error_output':     return 'pattern';
      default:                 return 'context';
    }
  }

  private summarize(event: TaggedEvent): string {
    const raw = event.raw.trim();
    if (event.type === 'user_constraint') return `User rule: ${raw.slice(0, 100)}`;
    if (event.type === 'error_output')    return `Known failure: ${raw.slice(0, 100)}`;
    if (event.type === 'agent_reasoning') return `Decision: ${raw.slice(0, 100)}`;
    return raw.slice(0, 100);
  }
}
