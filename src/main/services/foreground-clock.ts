/** Monotonic foreground time. Native transitions stop it even if renderer event delivery is delayed. */
export class ForegroundClock {
  private total = 0;
  private last: number;
  private foreground = false;
  constructor(private readonly now: () => number = () => performance.now()) { this.last = now(); }
  sample(foreground: boolean): number {
    const now = this.now();
    if (this.foreground) this.total += Math.max(0,now-this.last);
    this.last = now; this.foreground = foreground;
    return this.total;
  }
}
