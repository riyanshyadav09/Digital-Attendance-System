const axios = require("axios");
const FormData = require("form-data");
const { getFaceServiceUrl, getFaceServiceTimeoutMs } = require("../config/faceService");

const enrollFaceImage = async (file, requestId = "untracked") => {
    const formData = new FormData();
    formData.append("file", file.buffer, {
        filename: file.originalname,
        contentType: file.mimetype
    });

    const timeout = getFaceServiceTimeoutMs();
    const startedAt = Date.now();
    console.info("Face service enrollment request started", {
        requestId,
        timeoutMs: timeout,
        imageBytes: file.buffer.length
    });

    let response;
    try {
        response = await axios.post(
            `${getFaceServiceUrl()}/enroll`,
            formData,
            {
                headers: {
                    ...formData.getHeaders(),
                    "X-Face-Service-Token": process.env.FACE_SERVICE_TOKEN,
                    "X-Request-ID": requestId
                },
                maxBodyLength: Infinity,
                timeout
            }
        );
        console.info("Face service enrollment response received", {
            requestId,
            status: response.status,
            elapsedMs: Date.now() - startedAt
        });
    } catch (error) {
        const timedOut = error.code === "ECONNABORTED" || error.code === "ETIMEDOUT";
        const upstreamStatus = error.response?.status;
        console.error("Face service enrollment request failed", {
            requestId,
            elapsedMs: Date.now() - startedAt,
            timeoutMs: timeout,
            timedOut,
            status: upstreamStatus || null,
            errorName: error.name || "Error",
            errorCode: error.code || null
        });

        if (timedOut) {
            error.statusCode = 504;
            error.publicMessage = "Face recognition timed out. Please try again with a clear photo.";
        } else if (upstreamStatus) {
            error.statusCode = upstreamStatus >= 500 || upstreamStatus === 401 || upstreamStatus === 403
                ? 502
                : upstreamStatus;
            error.publicMessage = typeof error.response?.data?.detail === "string"
                ? error.response.data.detail
                : "Face recognition could not process this photo.";
        } else {
            error.statusCode = 503;
            error.publicMessage = "Face recognition service is unavailable. Please try again later.";
        }
        throw error;
    }

    const embedding = response.data?.embedding;
    const modelName = response.data?.modelName;
    const modelId = response.data?.modelId;
    if (
        !Array.isArray(embedding) ||
        embedding.length !== 512 ||
        !embedding.every((value) => Number.isFinite(Number(value))) ||
        !["buffalo_l", "buffalo_sc"].includes(modelName) ||
        typeof modelId !== "string" ||
        !modelId.startsWith(`${modelName}@insightface-`)
    ) {
        const error = new Error("Invalid face embedding or model identity received from AI service.");
        error.status = 502;
        throw error;
    }

    return {
        embedding: embedding.map(Number),
        modelId
    };
};

module.exports = enrollFaceImage;
