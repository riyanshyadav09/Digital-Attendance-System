require("dotenv").config();

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const connectDB = require("./config/db");

const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const attendanceRoutes = require("./routes/attendanceRoutes");
const subjectRoutes = require("./routes/subjectRoutes");
const adminRoutes = require("./routes/adminRoutes");

const app = express();

const allowedOrigins = (process.env.CLIENT_URL || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

app.disable("x-powered-by");
app.use(cors({
    origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        const error = new Error("Origin is not allowed by CORS.");
        error.statusCode = 403;
        return callback(error);
    }
}));
app.use(express.json({ limit: "1mb" }));

/*
-----------------------------------
ROUTES
-----------------------------------
*/

app.use("/api/auth", authRoutes);
app.use("/api/user", userRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/subjects", subjectRoutes);
app.use("/api/admin", adminRoutes);

/*
-----------------------------------
TEST ROUTE
-----------------------------------
*/

app.get("/", (req, res) => {
    res.send("Face Attendance Backend is Running!");
});

const healthHandler = (req, res) => {
    const connected = mongoose.connection.readyState === 1;
    return res.status(connected ? 200 : 503).json({
        status: connected ? "ok" : "starting",
        service: "Digital Attendance API",
        database: connected ? "connected" : "unavailable"
    });
};

app.get("/health", healthHandler);
app.get("/api/health", healthHandler);

app.use((req, res) => res.status(404).json({ message: "Not found." }));

app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const uploadError = error.name === "MulterError";
    const status = error.code === "LIMIT_FILE_SIZE"
        ? 413
        : uploadError
            ? 400
            : Number(error.statusCode || error.status) || 500;
    console.error("HTTP request failed:", {
        requestId: req.requestId || null,
        method: req.method,
        path: req.path,
        status,
        error: error.name || "Error",
        code: error.code || null,
        message: String(error.message || "Unexpected error")
            .replace(/(token|secret|password|authorization)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
            .slice(0, 240)
    });
    return res.status(status).json({
        message: error.code === "LIMIT_FILE_SIZE"
            ? "Image file must be 5 MB or smaller."
            : status < 500
                ? error.message
                : "An unexpected server error occurred.",
        ...(req.requestId ? { requestId: req.requestId } : {})
    });
});

/*
-----------------------------------
SERVER
-----------------------------------
*/

const validateEnvironment = () => {
    const required = [
        "MONGO_URI", "JWT_SECRET", "CLIENT_URL", "FACE_SERVICE_URL", "FACE_SERVICE_TOKEN",
        "CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET",
        "CAMPUS_LATITUDE", "CAMPUS_LONGITUDE", "CAMPUS_RADIUS"
    ];
    const missing = required.filter((name) => !process.env[name]?.trim());
    if (missing.length) {
        throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
    }
    if (process.env.JWT_SECRET.length < 32) {
        throw new Error("JWT_SECRET must contain at least 32 characters.");
    }
    if (process.env.FACE_SERVICE_TOKEN.length < 32) {
        throw new Error("FACE_SERVICE_TOKEN must contain at least 32 characters.");
    }
    if (!allowedOrigins.length) {
        throw new Error("CLIENT_URL must contain at least one frontend origin.");
    }
    for (const origin of allowedOrigins) {
        const url = new URL(origin);
        if ((origin !== url.origin && origin !== `${url.origin}/`) || url.pathname !== "/" || url.search || url.hash) {
            throw new Error("CLIENT_URL entries must be frontend origins without paths or query strings.");
        }
        if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
            throw new Error("CLIENT_URL origins must use HTTPS in production.");
        }
    }
    const mongoUrl = new URL(process.env.MONGO_URI);
    if (
        process.env.NODE_ENV === "production" &&
        ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(mongoUrl.hostname.toLowerCase())
    ) {
        throw new Error("MONGO_URI must point to a reachable production database in production.");
    }
    const faceServiceUrl = new URL(process.env.FACE_SERVICE_URL);
    if (
        process.env.NODE_ENV === "production" &&
        ["0.0.0.0", "::"].includes(faceServiceUrl.hostname.toLowerCase())
    ) {
        throw new Error("FACE_SERVICE_URL must not use an unspecified bind address in production.");
    }
    if (!["CAMPUS_LATITUDE", "CAMPUS_LONGITUDE", "CAMPUS_RADIUS"].every(
        (name) => Number.isFinite(Number(process.env[name]))
    )) {
        throw new Error("Campus coordinate and radius environment variables must be numbers.");
    }
};

const startServer = async () => {
    validateEnvironment();
    await connectDB();
    const port = Number(process.env.PORT) || 10000;
    const host = process.env.HOST?.trim() || "0.0.0.0";
    const server = app.listen(port, host, () => {
        console.log(`Backend listening on ${host}:${port}`);
    });

    const shutdown = (signal) => {
        console.log(`Received ${signal}; shutting down.`);
        server.close(async () => {
            await mongoose.disconnect();
            process.exit(0);
        });
        setTimeout(() => process.exit(1), 10000).unref();
    };
    process.once("SIGTERM", () => shutdown("SIGTERM"));
    process.once("SIGINT", () => shutdown("SIGINT"));
};

if (require.main === module) {
    startServer().catch((error) => {
        console.error("Backend startup failed:", error.message);
        process.exit(1);
    });
}

module.exports = { validateEnvironment };
