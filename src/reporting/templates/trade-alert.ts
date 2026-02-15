import { sendEmail } from "../email.ts";

export interface TradeAlertData {
	symbol: string;
	side: "BUY" | "SELL";
	quantity: number;
	price: number;
	orderType: string;
	reasoning?: string;
	confidence?: number;
	portfolioValue?: number;
}

export async function sendTradeAlert(data: TradeAlertData): Promise<void> {
	const emoji = data.side === "BUY" ? "🟢" : "🔴";
	const tradeValue = (data.quantity * data.price).toFixed(2);

	const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: ${data.side === "BUY" ? "#16a34a" : "#dc2626"};">
    ${emoji} ${data.side} ${data.symbol}
  </h2>
  <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
    <tr style="border-bottom: 1px solid #e5e7eb;">
      <td style="padding: 8px 0; color: #6b7280;">Symbol</td>
      <td style="padding: 8px 0; font-weight: bold;">${data.symbol}</td>
    </tr>
    <tr style="border-bottom: 1px solid #e5e7eb;">
      <td style="padding: 8px 0; color: #6b7280;">Side</td>
      <td style="padding: 8px 0; font-weight: bold;">${data.side}</td>
    </tr>
    <tr style="border-bottom: 1px solid #e5e7eb;">
      <td style="padding: 8px 0; color: #6b7280;">Quantity</td>
      <td style="padding: 8px 0;">${data.quantity}</td>
    </tr>
    <tr style="border-bottom: 1px solid #e5e7eb;">
      <td style="padding: 8px 0; color: #6b7280;">Price</td>
      <td style="padding: 8px 0;">&pound;${data.price.toFixed(4)}</td>
    </tr>
    <tr style="border-bottom: 1px solid #e5e7eb;">
      <td style="padding: 8px 0; color: #6b7280;">Value</td>
      <td style="padding: 8px 0;">&pound;${tradeValue}</td>
    </tr>
    <tr style="border-bottom: 1px solid #e5e7eb;">
      <td style="padding: 8px 0; color: #6b7280;">Order Type</td>
      <td style="padding: 8px 0;">${data.orderType}</td>
    </tr>
    ${
			data.confidence !== undefined
				? `
    <tr style="border-bottom: 1px solid #e5e7eb;">
      <td style="padding: 8px 0; color: #6b7280;">Confidence</td>
      <td style="padding: 8px 0;">${(data.confidence * 100).toFixed(0)}%</td>
    </tr>`
				: ""
		}
    ${
			data.portfolioValue
				? `
    <tr style="border-bottom: 1px solid #e5e7eb;">
      <td style="padding: 8px 0; color: #6b7280;">Portfolio Value</td>
      <td style="padding: 8px 0;">&pound;${data.portfolioValue.toFixed(2)}</td>
    </tr>`
				: ""
		}
  </table>
  ${
		data.reasoning
			? `
  <div style="background: #f9fafb; border-radius: 8px; padding: 16px; margin-top: 16px;">
    <h3 style="margin: 0 0 8px 0; color: #374151;">Reasoning</h3>
    <p style="margin: 0; color: #4b5563; white-space: pre-wrap;">${data.reasoning}</p>
  </div>`
			: ""
	}
  <p style="color: #9ca3af; font-size: 12px; margin-top: 24px;">
    Automated trade alert from Trader Agent
  </p>
</body>
</html>`.trim();

	await sendEmail({
		subject: `${emoji} ${data.side} ${data.quantity} ${data.symbol} @ £${data.price.toFixed(4)}`,
		html,
		text: `${data.side} ${data.quantity} ${data.symbol} @ £${data.price.toFixed(4)} (£${tradeValue})${data.reasoning ? `\n\nReasoning: ${data.reasoning}` : ""}`,
	});
}
