/** Wilson score lower bound — accounts for sample size when estimating true rate */
export function wilsonLower(wins: number, total: number, z: number = 1.96): number {
	if (total === 0) return 0;
	const p = wins / total;
	const denominator = 1 + (z * z) / total;
	const centre = p + (z * z) / (2 * total);
	const spread = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total);
	return (centre - spread) / denominator;
}
