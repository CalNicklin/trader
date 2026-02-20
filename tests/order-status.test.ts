import { expect, test } from "bun:test";
import { extractFillData, mapIbStatus } from "../src/broker/order-status.ts";
import type { OpenOrderLike } from "../src/broker/order-types.ts";

// --- Group 1: mapIbStatus ---

test("maps 'Submitted' to SUBMITTED", () => {
	expect(mapIbStatus("Submitted")).toBe("SUBMITTED");
});

test("maps 'PreSubmitted' to SUBMITTED", () => {
	expect(mapIbStatus("PreSubmitted")).toBe("SUBMITTED");
});

test("maps 'Filled' to FILLED", () => {
	expect(mapIbStatus("Filled")).toBe("FILLED");
});

test("maps 'Cancelled' to CANCELLED", () => {
	expect(mapIbStatus("Cancelled")).toBe("CANCELLED");
});

test("maps 'Inactive' to ERROR", () => {
	expect(mapIbStatus("Inactive")).toBe("ERROR");
});

test("maps 'ApiCancelled' to CANCELLED", () => {
	expect(mapIbStatus("ApiCancelled")).toBe("CANCELLED");
});

test("maps 'PendingSubmit' to SUBMITTED", () => {
	expect(mapIbStatus("PendingSubmit")).toBe("SUBMITTED");
});

test("maps 'PendingCancel' to SUBMITTED", () => {
	expect(mapIbStatus("PendingCancel")).toBe("SUBMITTED");
});

test("unknown status defaults to SUBMITTED", () => {
	expect(mapIbStatus("Bogus")).toBe("SUBMITTED");
});

// --- Group 2: extractFillData ---

test("extracts avgFillPrice from orderStatus", () => {
	const order: OpenOrderLike = {
		orderId: 1,
		orderStatus: { avgFillPrice: 150.5, filled: 100 },
	};
	const result = extractFillData(order);
	expect(result?.fillPrice).toBe(150.5);
});

test("extracts commission from orderState", () => {
	const order: OpenOrderLike = {
		orderId: 1,
		orderState: { commission: 3.5 },
	};
	const result = extractFillData(order);
	expect(result?.commission).toBe(3.5);
});

test("extracts both when both present", () => {
	const order: OpenOrderLike = {
		orderId: 1,
		orderStatus: { avgFillPrice: 150.5 },
		orderState: { commission: 3.5 },
	};
	const result = extractFillData(order);
	expect(result?.fillPrice).toBe(150.5);
	expect(result?.commission).toBe(3.5);
});

test("filters out IB sentinel commission (1e10)", () => {
	const order: OpenOrderLike = {
		orderId: 1,
		orderState: { commission: 1e10 },
	};
	const result = extractFillData(order);
	expect(result?.commission).toBeUndefined();
});

test("returns undefined fillPrice when orderStatus missing", () => {
	const order: OpenOrderLike = {
		orderId: 1,
		orderState: { status: "Filled" },
	};
	const result = extractFillData(order);
	expect(result?.fillPrice).toBeUndefined();
});

test("returns undefined fillPrice when avgFillPrice is 0", () => {
	const order: OpenOrderLike = {
		orderId: 1,
		orderStatus: { avgFillPrice: 0 },
	};
	const result = extractFillData(order);
	expect(result?.fillPrice).toBeUndefined();
});
