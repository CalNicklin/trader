import { sendEmail } from "../reporting/email.ts";
import { createChildLogger } from "./logger.ts";

const log = createChildLogger({ module: "alert" });

export async function sendCriticalAlert(subject: string, details: string): Promise<void> {
	const timestamp = new Date().toISOString();
	try {
		await sendEmail({
			subject: `[TRADER ALERT] ${subject}`,
			html: `<h2>${subject}</h2><pre>${details}</pre><p><small>${timestamp}</small></p>`,
			text: `${subject}\n\n${details}\n\n${timestamp}`,
		});
	} catch (error) {
		log.error({ error, subject }, "Failed to send critical alert email");
	}
}
