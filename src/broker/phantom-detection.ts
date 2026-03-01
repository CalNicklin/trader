interface PositionRow {
	id: number;
	symbol: string;
	exchange: string;
	quantity: number;
	marketValue: number | null;
	unrealizedPnl: number | null;
}

export function detectPhantomPositions(positions: ReadonlyArray<PositionRow>): PositionRow[] {
	return positions.filter((p) => p.quantity < 0);
}
