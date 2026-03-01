import { describe, expect, test } from "bun:test";
import { parseReviewResult } from "../src/learning/trade-reviewer.ts";

describe("parseReviewResult", () => {
	const completeJson = JSON.stringify({
		outcome: "win",
		reasoningQuality: "sound",
		lessonLearned: "Good momentum entry on SHEL",
		tags: ["momentum-entry", "energy-sector"],
		shouldRepeat: true,
		entrySignalQuality: "strong",
		exitTiming: "timely",
	});

	test("extracts entrySignalQuality from complete JSON", () => {
		const result = parseReviewResult(completeJson);
		expect(result.entrySignalQuality).toBe("strong");
	});

	test("extracts exitTiming from complete JSON", () => {
		const result = parseReviewResult(completeJson);
		expect(result.exitTiming).toBe("timely");
	});

	test("defaults entrySignalQuality to 'adequate' when missing", () => {
		const json = JSON.stringify({
			outcome: "loss",
			reasoningQuality: "partial",
			lessonLearned: "Should have checked volume",
			tags: ["low-volume"],
			shouldRepeat: false,
		});

		const result = parseReviewResult(json);
		expect(result.entrySignalQuality).toBe("adequate");
	});

	test("defaults exitTiming to 'n/a' when missing", () => {
		const json = JSON.stringify({
			outcome: "loss",
			reasoningQuality: "partial",
			lessonLearned: "Should have checked volume",
			tags: ["low-volume"],
			shouldRepeat: false,
		});

		const result = parseReviewResult(json);
		expect(result.exitTiming).toBe("n/a");
	});

	test("preserves all legacy fields", () => {
		const result = parseReviewResult(completeJson);
		expect(result.outcome).toBe("win");
		expect(result.reasoningQuality).toBe("sound");
		expect(result.lessonLearned).toBe("Good momentum entry on SHEL");
		expect(result.tags).toEqual(["momentum-entry", "energy-sector"]);
		expect(result.shouldRepeat).toBe(true);
	});
});
