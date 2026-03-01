import { describe, expect, test } from "bun:test";
import type { InsightCategory } from "../src/learning/pattern-analyzer.ts";

const VALID_CATEGORIES: InsightCategory[] = [
	"confidence_calibration",
	"sector_performance",
	"timing",
	"risk_management",
	"momentum_compliance",
	"holding_asymmetry",
	"general",
];

describe("InsightCategory", () => {
	test("accepts momentum_compliance category", () => {
		const category: InsightCategory = "momentum_compliance";
		expect(VALID_CATEGORIES).toContain(category);
	});

	test("accepts holding_asymmetry category", () => {
		const category: InsightCategory = "holding_asymmetry";
		expect(VALID_CATEGORIES).toContain(category);
	});

	test("all original categories still valid (regression)", () => {
		const originals: InsightCategory[] = [
			"confidence_calibration",
			"sector_performance",
			"timing",
			"risk_management",
			"general",
		];
		for (const cat of originals) {
			expect(VALID_CATEGORIES).toContain(cat);
		}
	});
});
