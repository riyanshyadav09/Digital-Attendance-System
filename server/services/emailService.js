const nodemailer = require("nodemailer");

const getSmtpSettings = (env) => {
    const host = env.BREVO_SMTP_HOST?.trim();
    const port = Number(env.BREVO_SMTP_PORT);
    const user = env.BREVO_SMTP_USER?.trim();
    const pass = env.BREVO_SMTP_KEY?.trim();
    const fromEmail = env.BREVO_FROM_EMAIL?.trim();
    const fromName = env.BREVO_FROM_NAME?.trim();

    if (
        !host ||
        !Number.isInteger(port) || port < 1 || port > 65535 ||
        !user || !pass ||
        !fromEmail || !fromEmail.includes("@") ||
        !fromName
    ) {
        return null;
    }

    return { host, port, user, pass, fromEmail, fromName };
};

const createEmailService = ({ env = process.env, createTransport = nodemailer.createTransport } = {}) => {
    let transporter = null;

    const isSmtpConfigured = () => Boolean(getSmtpSettings(env));

    const getTransporter = (settings) => {
        if (!transporter) {
            transporter = createTransport({
                host: settings.host,
                port: settings.port,
                secure: false,
                auth: {
                    user: settings.user,
                    pass: settings.pass
                }
            });
        }
        return transporter;
    };

    const sendOTPEmail = async (email, otp) => {
        const settings = getSmtpSettings(env);
        if (!settings) {
            const error = new Error("Password reset email service is unavailable.");
            error.code = "SMTP_NOT_CONFIGURED";
            error.statusCode = 503;
            throw error;
        }

        const mailOptions = {
            from: `"${settings.fromName}" <${settings.fromEmail}>`,
            to: email,
            subject: "Face Attendance - Password Reset OTP",
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 40px auto; padding: 30px; border: 1px solid #ddd; border-radius: 12px; background-color: #ffffff;">
                    <h2 style="text-align: center; color: #222; margin-bottom: 25px;">Face Attendance System</h2>
                    <p style="font-size: 15px; color: #333;">We received a request to reset your password.</p>
                    <p style="font-size: 15px; color: #333;">Your password reset OTP is:</p>
                    <div style="text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 8px; margin: 30px 0; padding: 15px; background-color: #f5f5f5; border-radius: 8px;">${otp}</div>
                    <p style="font-size: 14px; color: #555;">This OTP will expire in <strong>10 minutes</strong>.</p>
                    <p style="font-size: 14px; color: #555;">If you did not request a password reset, please ignore this email.</p>
                    <hr style="margin: 25px 0; border: none; border-top: 1px solid #ddd;">
                    <p style="font-size: 12px; color: #777; text-align: center;">Face Attendance System</p>
                </div>
            `
        };

        await getTransporter(settings).sendMail(mailOptions);
        console.log("Password reset email sent successfully.");
    };

    return { isSmtpConfigured, sendOTPEmail };
};

/*
-----------------------------------
SEND OTP EMAIL
-----------------------------------
*/

const defaultEmailService = createEmailService();

/*
-----------------------------------
EXPORT
-----------------------------------
*/

module.exports = {
    isSmtpConfigured: defaultEmailService.isSmtpConfigured,
    sendOTPEmail: defaultEmailService.sendOTPEmail,
    createEmailService
};
