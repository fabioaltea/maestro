import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { StateStore } from './state-store.js';
import { BacklogSchema, type Backlog, type Task } from '../schemas/backlog.js';
import type { ProjectPaths } from '../utils/paths.js';

export class BacklogManager {
  load(paths: ProjectPaths): Backlog {
    const raw = readFileSync(paths.backlogJson, 'utf8');
    return BacklogSchema.parse(JSON.parse(raw));
  }

  getTask(paths: ProjectPaths, id: string): Task | undefined {
    const backlog = this.load(paths);
    return backlog.tasks.find((t) => t.id === id);
  }

  getTasks(paths: ProjectPaths): Task[] {
    return this.load(paths).tasks;
  }

  getReadyTask(paths: ProjectPaths): Task | undefined {
    const backlog = this.load(paths);
    const doneIds = new Set(backlog.tasks.filter((t) => t.status === 'done').map((t) => t.id));
    const ready = backlog.tasks
      .filter((t) => t.status === 'ready')
      .filter((t) => t.prerequisites.every((p) => doneIds.has(p)));
    ready.sort((a, b) => {
      const ta = a.created_at ?? '';
      const tb = b.created_at ?? '';
      return ta < tb ? -1 : ta > tb ? 1 : 0;
    });
    return ready[0];
  }

  updateTask(
    paths: ProjectPaths,
    store: StateStore,
    id: string,
    changes: Partial<Omit<Task, 'id'>>,
  ): Task {
    const backlog = this.load(paths);
    const idx = backlog.tasks.findIndex((t) => t.id === id);
    if (idx === -1) throw new Error(`Task ${id} not found in backlog`);
    const updated: Task = {
      ...(backlog.tasks[idx] as Task),
      ...(changes as Partial<Task>),
      id,
      updated_at: new Date().toISOString(),
    } as Task;
    backlog.tasks[idx] = updated;
    this._saveBacklog(paths, backlog);
    this.upsertTaskInDb(store, updated);
    return updated;
  }

  addTask(paths: ProjectPaths, store: StateStore, task: Task): Task {
    const backlog = this.load(paths);
    if (backlog.tasks.some((t) => t.id === task.id)) {
      throw new Error(`Task ${task.id} already exists in backlog`);
    }
    const now = new Date().toISOString();
    const full: Task = {
      created_at: now,
      updated_at: now,
      ...task,
    };
    backlog.tasks.push(full);
    this._saveBacklog(paths, backlog);
    this.upsertTaskInDb(store, full);
    return full;
  }

  upsertTaskInDb(store: StateStore, task: Task): void {
    store.raw
      .prepare(
        `INSERT OR REPLACE INTO tasks (
          id, title, description, assignee, status, area, complexity, retry_count,
          prerequisites_json, acceptance_criteria_json, required_skills_json,
          metadata_json, parent_task, created_at, updated_at, started_at, completed_at
        ) VALUES (
          @id, @title, @description, @assignee, @status, @area, @complexity, @retry_count,
          @prerequisites_json, @acceptance_criteria_json, @required_skills_json,
          @metadata_json, @parent_task, @created_at, @updated_at, @started_at, @completed_at
        )`,
      )
      .run({
        id: task.id,
        title: task.title,
        description: task.description,
        assignee: task.assignee,
        status: task.status,
        area: task.area,
        complexity: task.complexity,
        retry_count: task.retry_count,
        prerequisites_json: JSON.stringify(task.prerequisites),
        acceptance_criteria_json: JSON.stringify(task.acceptance_criteria),
        required_skills_json: JSON.stringify(task.required_skills),
        metadata_json: JSON.stringify(task.metadata),
        parent_task: task.parent_task ?? null,
        created_at: task.created_at ?? null,
        updated_at: task.updated_at ?? null,
        started_at: task.started_at ?? null,
        completed_at: task.completed_at ?? null,
      });
  }

  private _saveBacklog(paths: ProjectPaths, backlog: Backlog): void {
    const tmp = join(paths.maestroDir, `.backlog-${Date.now()}.tmp`);
    writeFileSync(tmp, JSON.stringify(backlog, null, 2) + '\n', 'utf8');
    renameSync(tmp, paths.backlogJson);
  }
}
