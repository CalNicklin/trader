import { expect, test } from "bun:test";
import { RateLimiter } from "../src/utils/rate-limiter.ts";

test("rate limiter tracks remaining requests", async () => {
	const limiter = new RateLimiter(3, 1000);

	expect(limiter.remaining).toBe(3);
	await limiter.acquire();
	expect(limiter.remaining).toBe(2);
	await limiter.acquire();
	expect(limiter.remaining).toBe(1);
	await limiter.acquire();
	expect(limiter.remaining).toBe(0);
});
