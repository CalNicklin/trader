import { desc, gte } from "drizzle-orm";
import { getDb } from "../../db/client.ts";
import { positions, trades } from "../../db/schema.ts";
import { createChildLogger } from "../../utils/logger.ts";
import { getUsageSummary } from "../../utils/token-tracker.ts";
import { sendEmail } from "../email.ts";
import { calculateMetrics } from "../metrics.ts";

const log = createChildLogger({ module: "reporting-daily" });

export async function sendDailySummary(): Promise<void> {
	const metrics = await calculateMetrics(30);
	const db = getDb();

	const today = new Date().toISOString().split("T")[0]!;
	const todayTrades = await db
		.select()
		.from(trades)
		.where(gte(trades.createdAt, today))
		.orderBy(desc(trades.createdAt));

	const openPositions = await db.select().from(positions);

	const dailyUsage = await getUsageSummary(1);
	const weeklyUsage = await getUsageSummary(7);
	const totalDailyTokens = dailyUsage.totalInputTokens + dailyUsage.totalOutputTokens;
	const apiCostLine = `Today's API cost: $${dailyUsage.totalCostUsd.toFixed(2)} (${totalDailyTokens.toLocaleString()} tokens) | This week: $${weeklyUsage.totalCostUsd.toFixed(2)}`;

	const pnlColor = metrics.dailyPnl >= 0 ? "#16a34a" : "#dc2626";
	const pnlSign = metrics.dailyPnl >= 0 ? "+" : "";

	const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f9fafb;">
  <div style="background: white; border-radius: 12px; padding: 24px; margin-bottom: 16px;">
    <h1 style="margin: 0 0 4px 0; font-size: 20px;">Daily Trading Summary</h1>
    <p style="color: #6b7280; margin: 0;">${today}</p>
  </div>

  <div style="background: white; border-radius: 12px; padding: 24px; margin-bottom: 16px;">
    <h2 style="margin: 0 0 16px 0; font-size: 16px;">Portfolio</h2>
    <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
      <span style="color: #6b7280;">Value</span>
      <span style="font-weight: bold;">&pound;${metrics.portfolioValue.toFixed(2)}</span>
    </div>
    <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
      <span style="color: #6b7280;">Cash</span>
      <span>&pound;${metrics.cashBalance.toFixed(2)}</span>
    </div>
    <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
      <span style="color: #6b7280;">Daily P&L</span>
      <span style="color: ${pnlColor}; font-weight: bold;">${pnlSign}&pound;${metrics.dailyPnl.toFixed(2)} (${pnlSign}${metrics.dailyPnlPercent.toFixed(2)}%)</span>
    </div>
    <div style="display: flex; justify-content: space-between;">
      <span style="color: #6b7280;">Total P&L</span>
      <span style="color: ${metrics.totalPnl >= 0 ? "#16a34a" : "#dc2626"};">${metrics.totalPnl >= 0 ? "+" : ""}&pound;${metrics.totalPnl.toFixed(2)}</span>
    </div>
  </div>

  <div style="background: white; border-radius: 12px; padding: 24px; margin-bottom: 16px;">
    <h2 style="margin: 0 0 16px 0; font-size: 16px;">Performance (30d)</h2>
    <table style="width: 100%; border-collapse: collapse;">
      <tr style="border-bottom: 1px solid #f3f4f6;">
        <td style="padding: 6px 0; color: #6b7280;">Win Rate</td>
        <td style="padding: 6px 0; text-align: right;">${(metrics.winRate * 100).toFixed(1)}%</td>
      </tr>
      <tr style="border-bottom: 1px solid #f3f4f6;">
        <td style="padding: 6px 0; color: #6b7280;">Trades</td>
        <td style="padding: 6px 0; text-align: right;">${metrics.totalTrades} (${metrics.winCount}W / ${metrics.lossCount}L)</td>
      </tr>
      <tr style="border-bottom: 1px solid #f3f4f6;">
        <td style="padding: 6px 0; color: #6b7280;">Avg Win / Loss</td>
        <td style="padding: 6px 0; text-align: right;">&pound;${metrics.avgWin.toFixed(2)} / &pound;${metrics.avgLoss.toFixed(2)}</td>
      </tr>
      <tr style="border-bottom: 1px solid #f3f4f6;">
        <td style="padding: 6px 0; color: #6b7280;">Profit Factor</td>
        <td style="padding: 6px 0; text-align: right;">${metrics.profitFactor === Infinity ? "N/A" : metrics.profitFactor.toFixed(2)}</td>
      </tr>
      <tr style="border-bottom: 1px solid #f3f4f6;">
        <td style="padding: 6px 0; color: #6b7280;">Sharpe Ratio</td>
        <td style="padding: 6px 0; text-align: right;">${metrics.sharpeRatio.toFixed(2)}</td>
      </tr>
      <tr>
        <td style="padding: 6px 0; color: #6b7280;">Max Drawdown</td>
        <td style="padding: 6px 0; text-align: right;">${metrics.maxDrawdownPercent.toFixed(2)}%</td>
      </tr>
    </table>
  </div>

  ${
		todayTrades.length > 0
			? `
  <div style="background: white; border-radius: 12px; padding: 24px; margin-bottom: 16px;">
    <h2 style="margin: 0 0 16px 0; font-size: 16px;">Today's Trades (${todayTrades.length})</h2>
    ${todayTrades
			.map(
				(t) => `
    <div style="border-bottom: 1px solid #f3f4f6; padding: 8px 0;">
      <span style="color: ${t.side === "BUY" ? "#16a34a" : "#dc2626"}; font-weight: bold;">${t.side}</span>
      <span style="font-weight: bold;">${t.symbol}</span>
      <span style="color: #6b7280;">x${t.quantity} @ &pound;${(t.fillPrice ?? t.limitPrice ?? 0).toFixed(4)}</span>
      <span style="color: #6b7280;">[${t.status}]</span>
    </div>`,
			)
			.join("")}
  </div>`
			: ""
	}

  ${
		openPositions.length > 0
			? `
  <div style="background: white; border-radius: 12px; padding: 24px; margin-bottom: 16px;">
    <h2 style="margin: 0 0 16px 0; font-size: 16px;">Open Positions (${openPositions.length})</h2>
    ${openPositions
			.map((p) => {
				const pnl = p.unrealizedPnl ?? 0;
				const pnlPct =
					p.avgCost > 0 ? (((p.currentPrice ?? p.avgCost) - p.avgCost) / p.avgCost) * 100 : 0;
				return `
    <div style="border-bottom: 1px solid #f3f4f6; padding: 8px 0;">
      <span style="font-weight: bold;">${p.symbol}</span>
      <span style="color: #6b7280;">x${p.quantity} @ &pound;${p.avgCost.toFixed(4)}</span>
      <span style="color: ${pnl >= 0 ? "#16a34a" : "#dc2626"};">${pnl >= 0 ? "+" : ""}&pound;${pnl.toFixed(2)} (${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}%)</span>
    </div>`;
			})
			.join("")}
  </div>`
			: ""
	}

  <p style="color: #9ca3af; font-size: 12px; text-align: center;">${apiCostLine}</p>
  <p style="color: #9ca3af; font-size: 12px; text-align: center;">Trader Agent - Automated daily summary</p>
</body>
</html>`.trim();

	await sendEmail({
		subject: `${pnlSign}£${metrics.dailyPnl.toFixed(2)} | Daily Trading Summary ${today}`,
		html,
	});

	log.info("Daily summary email sent");
}
