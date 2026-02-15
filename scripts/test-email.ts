/**
 * Quick test: send a test email via Resend
 * Run: bun scripts/test-email.ts
 */
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

const { data, error } = await resend.emails.send({
	from: process.env.ALERT_EMAIL_FROM || "trader@mail.tracesknown.com",
	to: process.env.ALERT_EMAIL_TO || "test@example.com",
	subject: "Trader Agent - Test Email",
	html: `
		<h2>Trader Agent is Online</h2>
		<p>This is a test email confirming Resend is configured correctly.</p>
		<ul>
			<li><strong>Account:</strong> DUP924429 (Paper)</li>
			<li><strong>Net Liquidation:</strong> $1,000,000</li>
			<li><strong>Status:</strong> Connected & Running</li>
			<li><strong>Time:</strong> ${new Date().toISOString()}</li>
		</ul>
		<p style="color: #666; font-size: 12px;">Sent from Trader Agent test script</p>
	`,
});

if (error) {
	console.error("Email failed:", error);
	process.exit(1);
}

console.log("Email sent successfully!", data);
