export class RateLimiter {
	private timestamps: number[] = [];
	private readonly maxRequests: number;
	private readonly windowMs: number;

	constructor(maxRequests: number, windowMs: number) {
		this.maxRequests = maxRequests;
		this.windowMs = windowMs;
	}

	async acquire(): Promise<void> {
		const now = Date.now();
		this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);

		if (this.timestamps.length >= this.maxRequests) {
			const oldestInWindow = this.timestamps[0]!;
			const waitTime = this.windowMs - (now - oldestInWindow);
			await Bun.sleep(waitTime);
			return this.acquire();
		}

		this.timestamps.push(now);
	}

	get remaining(): number {
		const now = Date.now();
		this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);
		return Math.max(0, this.maxRequests - this.timestamps.length);
	}
}
