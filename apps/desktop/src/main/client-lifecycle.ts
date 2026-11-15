interface CleanupPorts { closeClient(): void; closeRecovery(): void; invalidateConfirmations(): void }
export class ClientLifecycle {
  private ports: CleanupPorts;
  private archive = new Set<() => void>();
  private disposed = false;
  constructor(ports: CleanupPorts) { this.ports = ports; }
  addArchiveCleanup(cleanup: () => void) {
    if (this.disposed || this.archive.size >= 16) throw new Error('LOCAL_BUSY');
    this.archive.add(cleanup); return () => this.archive.delete(cleanup);
  }
  archiveChanged() {
    this.ports.invalidateConfirmations();
    for (const cleanup of this.archive) { try { cleanup(); } catch { /* Other owned clients still require closure. */ } }
    this.archive.clear();
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.archiveChanged(); this.ports.closeRecovery(); this.ports.closeClient();
  }
}
