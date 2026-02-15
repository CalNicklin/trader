import { gte } from "drizzle-orm";
import { getDb } from "../../db/client.ts";
import { dailySnapshots } from "../../db/schema.ts";
import { createChildLogger } from "../../utils/logger.ts";
import { sendEmail } from "../email.ts";
import { calculateMetrics } from "../metrics.ts";

const log = createChildLogger({ module: "reporting-weekly" });

export async function sendWeeklySummary(): Promise<void> {
	const metrics = await calculateMetrics(7);
	const allTimeMetrics = await calculateMetrics(365);
	const db = getDb();

	const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]!;

	const weekSnapshots = await db
		.select()
		.from(dailySnapshots)
		.where(gte(dailySnapshots.date, weekAgo))
		.orderBy(dailySnapshots.date);

	const pnlSign = metrics.weeklyPnl >= 0 ? "+" : "";
	const pnlColor = metrics.weeklyPnl >= 0 ? "#16a34a" : "#dc2626";

	const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f9fafb;">
  <div style="background: white; border-radius: 12px; padding: 24px; margin-bottom: 16px;">
    <h1 style="margin: 0 0 4px 0; font-size: 20px;">Weekly Trading Report</h1>
    <p style="color: #6b7280; margin: 0;">Week ending ${new Date().toISOString().split("T")[0]}</p>
  </div>

  <div style="background: white; border-radius: 12px; padding: 24px; margin-bottom: 16px;">
    <h2 style="margin: 0 0 16px 0; font-size: 16px;">Week at a Glance</h2>
    <div style="text-align: center; padding: 16px 0;">
      <div style="font-size: 32px; font-weight: bold; color: ${pnlColor};">${pnlSign}&pound;${metrics.weeklyPnl.toFixed(2)}</div>
      <div style="color: ${pnlColor}; font-size: 18px;">${pnlSign}${metrics.weeklyPnlPercent.toFixed(2)}%</div>
      <div style="color: #6b7280; margin-top: 4px;">Weekly P&L</div>
    </div>
    <div style="display: flex; justify-content: space-around; text-align: center; padding: 16px 0; border-top: 1px solid #f3f4f6;">
      <div>
        <div style="font-size: 24px; font-weight: bold;">${metrics.totalTrades}</div>
        <div style="color: #6b7280; font-size: 12px;">Trades</div>
      </div>
      <div>
        <div style="font-size: 24px; font-weight: bold;">${(metrics.winRate * 100).toFixed(0)}%</div>
        <div style="color: #6b7280; font-size: 12px;">Win Rate</div>
      </div>
      <div>
        <div style="font-size: 24px; font-weight: bold;">&pound;${metrics.portfolioValue.toFixed(0)}</div>
        <div style="color: #6b7280; font-size: 12px;">Portfolio</div>
      </div>
    </div>
  </div>

  <div style="background: white; border-radius: 12px; padding: 24px; margin-bottom: 16px;">
    <h2 style="margin: 0 0 16px 0; font-size: 16px;">Daily Breakdown</h2>
    <table style="width: 100%; border-collapse: collapse;">
      <tr style="background: #f9fafb;">
        <th style="padding: 8px; text-align: left; font-size: 12px; color: #6b7280;">Date</th>
        <th style="padding: 8px; text-align: right; font-size: 12px; color: #6b7280;">Value</th>
        <th style="padding: 8px; text-align: right; font-size: 12px; color: #6b7280;">P&L</th>
        <th style="padding: 8px; text-align: right; font-size: 12px; color: #6b7280;">Trades</th>
      </tr>
      ${weekSnapshots
				.map(
					(s) => `
      <tr style="border-bottom: 1px solid #f3f4f6;">
        <td style="padding: 8px;">${s.date}</td>
        <td style="padding: 8px; text-align: right;">&pound;${s.portfolioValue.toFixed(2)}</td>
        <td style="padding: 8px; text-align: right; color: ${s.dailyPnl >= 0 ? "#16a34a" : "#dc2626"};">${s.dailyPnl >= 0 ? "+" : ""}&pound;${s.dailyPnl.toFixed(2)}</td>
        <td style="padding: 8px; text-align: right;">${s.tradesCount} (${s.winsCount}W/${s.lossesCount}L)</td>
      </tr>`,
				)
				.join("")}
    </table>
  </div>

  <div style="background: white; border-radius: 12px; padding: 24px; margin-bottom: 16px;">
    <h2 style="margin: 0 0 16px 0; font-size: 16px;">All-Time Stats</h2>
    <table style="width: 100%; border-collapse: collapse;">
      <tr style="border-bottom: 1px solid #f3f4f6;">
        <td style="padding: 6px 0; color: #6b7280;">Total P&L</td>
        <td style="padding: 6px 0; text-align: right; color: ${allTimeMetrics.totalPnl >= 0 ? "#16a34a" : "#dc2626"};">${allTimeMetrics.totalPnl >= 0 ? "+" : ""}&pound;${allTimeMetrics.totalPnl.toFixed(2)} (${allTimeMetrics.totalPnlPercent.toFixed(2)}%)</td>
      </tr>
      <tr style="border-bottom: 1px solid #f3f4f6;">
        <td style="padding: 6px 0; color: #6b7280;">Total Trades</td>
        <td style="padding: 6px 0; text-align: right;">${allTimeMetrics.totalTrades}</td>
      </tr>
      <tr style="border-bottom: 1px solid #f3f4f6;">
        <td style="padding: 6px 0; color: #6b7280;">Win Rate</td>
        <td style="padding: 6px 0; text-align: right;">${(allTimeMetrics.winRate * 100).toFixed(1)}%</td>
      </tr>
      <tr style="border-bottom: 1px solid #f3f4f6;">
        <td style="padding: 6px 0; color: #6b7280;">Sharpe Ratio</td>
        <td style="padding: 6px 0; text-align: right;">${allTimeMetrics.sharpeRatio.toFixed(2)}</td>
      </tr>
      <tr>
        <td style="padding: 6px 0; color: #6b7280;">Max Drawdown</td>
        <td style="padding: 6px 0; text-align: right;">${allTimeMetrics.maxDrawdownPercent.toFixed(2)}%</td>
      </tr>
    </table>
  </div>

  <p style="color: #9ca3af; font-size: 12px; text-align: center;">Trader Agent - Automated weekly report</p>
</body>
</html>`.trim();

	await sendEmail({
		subject: `${pnlSign}£${metrics.weeklyPnl.toFixed(2)} | Weekly Trading Report`,
		html,
	});

	log.info("Weekly summary email sent");
}
