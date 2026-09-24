import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

export class WorkQueue {
  constructor(dir = '.local', worker, onCancel = async () => {}) {
    this.dir = dir;
    this.worker = worker;
    this.onCancel = onCancel;
    this.tasks = [];
    this.writes = Promise.resolve();
    this.running = new Map();
    this.closed = false;
  }
  async init() {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    try {
      this.tasks = JSON.parse(await readFile(this.dir + '/queue.json', 'utf8'));
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    for (const t of this.tasks)
      if (['running', 'stopping'].includes(t.status)) {
        t.status = 'interrupted';
        t.error =
          'Sunucu işlem sırasında kapandı; otomatik tekrar çalıştırılmaz.';
        t.finishedAt = new Date().toISOString();
      }
    await this.save();
    return this;
  }
  save() {
    const data = JSON.stringify(this.tasks);
    this.writes = this.writes
      .catch(() => {})
      .then(async () => {
        await writeFile(this.dir + '/queue.tmp', data, { mode: 0o600 });
        await rename(this.dir + '/queue.tmp', this.dir + '/queue.json');
      });
    return this.writes;
  }
  async enqueue(input) {
    if (this.closed) throw new Error('Sunucu kapanıyor.');
    if (this.tasks.filter((t) => t.status === 'queued').length >= 200)
      throw new Error('Kuyruk dolu; en fazla 200 bekleyen iş.');
    const task = {
      ...input,
      id: randomUUID(),
      status: 'queued',
      createdAt: new Date().toISOString(),
    };
    this.tasks.push(task);
    try {
      await this.save();
    } catch (e) {
      this.tasks = this.tasks.filter((t) => t !== task);
      throw e;
    }
    return task;
  }
  lane(task) {
    return task.kind === 'email' ? 'email' : 'scan';
  }
  get current() {
    return this.running.get('scan') || null;
  }
  snapshot() {
    const positions = { email: 0, scan: 0 };
    return this.tasks.map(({ payload: _payload, ...t }) => ({
      ...t,
      lane: this.lane(t),
      position: t.status === 'queued' ? ++positions[this.lane(t)] : null,
    }));
  }
  async cancel(id, user) {
    const task = this.tasks.find((t) => t.id === id);
    if (!task) throw new Error('İş bulunamadı.');
    if (user.role !== 'admin' && task.ownerId !== user.id)
      throw Object.assign(
        new Error('Yalnızca iş sahibi veya admin durdurabilir.'),
        { status: 403 },
      );
    if (task.status === 'queued') {
      task.status = 'cancelled';
      task.finishedAt = new Date().toISOString();
      await this.onCancel(task);
    } else if (task.status === 'running') {
      task.status = 'stopping';
      this.running.get(this.lane(task))?.controller.abort();
    }
    await this.save();
    return task;
  }
  async drain() {
    await Promise.all(['scan', 'email'].map((lane) => this.drainLane(lane)));
  }
  async drainLane(lane) {
    if (this.running.has(lane) || this.closed) return;
    const task = this.tasks.find(
      (t) => t.status === 'queued' && this.lane(t) === lane,
    );
    if (!task) return;
    const controller = new AbortController();
    this.running.set(lane, { id: task.id, controller });
    task.status = 'running';
    task.startedAt = new Date().toISOString();
    try {
      await this.save();
      task.result = await this.worker(task, controller);
      task.status = controller.signal.aborted
        ? 'cancelled'
        : task.result?.status === 'partial' ||
            task.result?.failed ||
            task.result?.unknown ||
            task.result?.skipped
          ? 'partial'
          : 'completed';
    } catch (e) {
      task.status = controller.signal.aborted
        ? 'cancelled'
        : e.blocked
          ? 'blocked'
          : 'failed';
      task.error = e.message;
      await this.onCancel(task);
    } finally {
      task.finishedAt = new Date().toISOString();
      try {
        await this.save();
      } finally {
        this.running.delete(lane);
      }
    }
  }
  close() {
    this.closed = true;
    for (const active of this.running.values()) active.controller.abort();
  }
}
