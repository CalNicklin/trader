import { Resend } from "resend";
import { getConfig } from "../config.ts";
import { createChildLogger } from "../utils/logger.ts";

const log = createChildLogger({ module: "reporting-email" });

let _resend: Resend | null = null;

function getResend(): Resend {
	if (!_resend) {
		const config = getConfig();
		_resend = new Resend(config.RESEND_API_KEY);
	}
	return _resend;
}

export interface EmailOptions {
	subject: string;
	html: string;
	text?: string;
}

export async function sendEmail(options: EmailOptions): Promise<void> {
	const config = getConfig();
	const resend = getResend();

	try {
		const { data, error } = await resend.emails.send({
			from: config.ALERT_EMAIL_FROM,
			to: config.ALERT_EMAIL_TO,
			subject: options.subject,
			html: options.html,
			text: options.text,
		});

		if (error) {
			log.error({ error }, "Failed to send email");
			throw new Error(`Email send failed: ${error.message}`);
		}

		log.info({ emailId: data?.id, subject: options.subject }, "Email sent");
	} catch (error) {
		log.error({ error, subject: options.subject }, "Email send error");
		throw error;
	}
}
