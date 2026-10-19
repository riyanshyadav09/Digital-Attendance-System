const test = require("node:test");
const assert = require("node:assert/strict");

const smtpVariableNames = [
    "BREVO_SMTP_HOST",
    "BREVO_SMTP_PORT",
    "BREVO_SMTP_USER",
    "BREVO_SMTP_KEY",
    "BREVO_FROM_EMAIL",
    "BREVO_FROM_NAME"
];

const requiredEnvironment = {
    NODE_ENV: "production",
    MONGO_URI: "mongodb+srv://test:test@cluster.example.invalid/attendance",
    JWT_SECRET: "a".repeat(32),
    CLIENT_URL: "https://attendance.example.invalid",
    FACE_SERVICE_URL: "http://127.0.0.1:8000",
    FACE_SERVICE_TOKEN: "b".repeat(32),
    CLOUDINARY_CLOUD_NAME: "test-cloud",
    CLOUDINARY_API_KEY: "test-key",
    CLOUDINARY_API_SECRET: "test-secret",
    CAMPUS_LATITUDE: "10.5",
    CAMPUS_LONGITUDE: "20.5",
    CAMPUS_RADIUS: "150"
};

Object.assign(process.env, requiredEnvironment);
// Empty values prevent dotenv from importing any developer SMTP credentials
// from an ignored local .env file into this test process.
for (const name of smtpVariableNames) process.env[name] = "";

// Requiring the server is side-effect free in tests; the real startup path is
// still used when server.js is the process entry point.
const { validateEnvironment } = require("../server");
const User = require("../models/User");
const { forgotPassword } = require("../controllers/authController");
const { createEmailService, isSmtpConfigured } = require("../services/emailService");

const completeSmtpEnvironment = {
    BREVO_SMTP_HOST: "smtp.example.invalid",
    BREVO_SMTP_PORT: "587",
    BREVO_SMTP_USER: "smtp-test-user",
    BREVO_SMTP_KEY: "smtp-test-key",
    BREVO_FROM_EMAIL: "attendance@example.invalid",
    BREVO_FROM_NAME: "Attendance Test"
};

const createResponse = () => ({
    statusCode: null,
    body: null,
    status(code) {
        this.statusCode = code;
        return this;
    },
    json(body) {
        this.body = body;
        return this;
    }
});

test("application environment validation succeeds without SMTP settings", () => {
    assert.doesNotThrow(validateEnvironment);
    assert.equal(isSmtpConfigured(), false);
});

test("incomplete SMTP settings are treated as unconfigured", async () => {
    const env = { BREVO_SMTP_HOST: completeSmtpEnvironment.BREVO_SMTP_HOST };
    let transporterCreated = false;
    const service = createEmailService({
        env,
        createTransport: () => {
            transporterCreated = true;
            return { sendMail: async () => {} };
        }
    });

    assert.equal(service.isSmtpConfigured(), false);
    await assert.rejects(service.sendOTPEmail("person@example.invalid", "123456"), {
        code: "SMTP_NOT_CONFIGURED",
        statusCode: 503
    });
    assert.equal(transporterCreated, false);
});

test("password reset returns the same unavailable response without querying accounts when SMTP is missing", async () => {
    let accountLookups = 0;
    const originalFindOne = User.findOne;
    User.findOne = async () => {
        accountLookups += 1;
        return null;
    };

    try {
        const responses = [];
        for (const email of ["known@example.invalid", "unknown@example.invalid"]) {
            const response = createResponse();
            await forgotPassword({ body: { email } }, response);
            responses.push(response);
        }

        assert.equal(accountLookups, 0);
        assert.equal(responses[0].statusCode, 503);
        assert.equal(responses[1].statusCode, responses[0].statusCode);
        assert.deepEqual(responses[1].body, responses[0].body);
        assert.match(responses[0].body.message, /temporarily unavailable/i);
    } finally {
        User.findOne = originalFindOne;
    }
});

test("configured SMTP passes the OTP email to the transporter", async () => {
    const sentMessages = [];
    let transportOptions;
    const service = createEmailService({
        env: completeSmtpEnvironment,
        createTransport: (options) => {
            transportOptions = options;
            return { sendMail: async (message) => sentMessages.push(message) };
        }
    });

    assert.equal(service.isSmtpConfigured(), true);
    await service.sendOTPEmail("person@example.invalid", "123456");

    assert.equal(transportOptions.host, completeSmtpEnvironment.BREVO_SMTP_HOST);
    assert.equal(transportOptions.port, 587);
    assert.equal(transportOptions.auth.user, completeSmtpEnvironment.BREVO_SMTP_USER);
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].to, "person@example.invalid");
    assert.match(sentMessages[0].html, /123456/);
});

