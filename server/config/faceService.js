const getFaceServiceUrl = () => {
    const url = process.env.FACE_SERVICE_URL?.trim();
    if (!url) {
        const error = new Error("FACE_SERVICE_URL is not configured.");
        error.statusCode = 503;
        throw error;
    }
    return url.replace(/\/+$/, "");
};

const DEFAULT_FACE_SERVICE_TIMEOUT_MS = 120000;
const MAX_FACE_SERVICE_TIMEOUT_MS = 150000;

const getFaceServiceTimeoutMs = () => {
    const configuredTimeout = Number(process.env.FACE_SERVICE_TIMEOUT_MS);
    if (!Number.isFinite(configuredTimeout) || configuredTimeout <= 0) {
        return DEFAULT_FACE_SERVICE_TIMEOUT_MS;
    }
    return Math.min(configuredTimeout, MAX_FACE_SERVICE_TIMEOUT_MS);
};

module.exports = { getFaceServiceUrl, getFaceServiceTimeoutMs };
