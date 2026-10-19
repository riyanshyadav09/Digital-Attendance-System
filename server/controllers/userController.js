const User = require("../models/User");
const enrollFaceImage = require("../services/faceEnrollmentService");
const { saveFacePhoto, removeStoredImage } = require("../services/objectStorageService");
const getSafeErrorDetails = require("../utils/safeErrorDetails");

const getFacultyProfile = async (req, res) => {
    try {
        const faculty = await User.findById(req.user.id).select(
            "name email department role facultyStatus facultyRegisteredAt facultyApprovedAt createdAt"
        );

        if (!faculty || faculty.role !== "faculty") {
            return res.status(404).json({
                message: "Faculty profile not found."
            });
        }

        const validityExpiresAt = faculty.facultyRegisteredAt
            ? new Date(faculty.facultyRegisteredAt)
            : null;

        if (validityExpiresAt) {
            validityExpiresAt.setDate(validityExpiresAt.getDate() + 25);
        }

        const remainingMilliseconds = validityExpiresAt
            ? validityExpiresAt.getTime() - Date.now()
            : null;

        return res.status(200).json({
            message: "Faculty profile fetched successfully",
            profile: {
                name: faculty.name,
                email: faculty.email,
                department: faculty.department,
                role: faculty.role,
                facultyStatus: faculty.facultyStatus,
                facultyRegisteredAt: faculty.facultyRegisteredAt,
                facultyApprovedAt: faculty.facultyApprovedAt,
                createdAt: faculty.createdAt,
                validityPeriodDays: 25,
                validityExpiresAt,
                validityDaysRemaining: remainingMilliseconds === null
                    ? null
                    : Math.max(
                        0,
                        Math.ceil(remainingMilliseconds / (24 * 60 * 60 * 1000))
                    )
            }
        });
    } catch (error) {
        console.error("Get Faculty Profile Error:", error.message);

        return res.status(500).json({
            message: "Unable to fetch faculty profile."
        });
    }
};

const enrollFace = async (req, res) => {
    let stagedFacePhotoUrl = null;
    const startedAt = Date.now();
    let stage = "request validation";

    try {
        console.info("Face re-enrollment processing started", {
            requestId: req.requestId,
            imageBytes: req.file?.size || 0
        });

        if (!req.file) {
            return res.status(400).json({
                message: "Please upload a face image."
            });
        }

        stage = "user lookup";
        const user = await User.findById(req.user.id);

        if (!user) {
            return res.status(404).json({
                message: "User not found."
            });
        }

        if (user.role !== "student") {
            return res.status(403).json({
                message:
                    "Only students can enroll their face."
            });
        }

        const previousFacePhotoUrl = user.facePhotoUrl;
        stage = "Cloudinary photo upload";
        const photoUploadStartedAt = Date.now();
        console.info("Enrollment photo storage started", { requestId: req.requestId });
        const savedPhoto = await saveFacePhoto(req.file);
        stagedFacePhotoUrl = savedPhoto.url;
        console.info("Enrollment photo storage completed", {
            requestId: req.requestId,
            elapsedMs: Date.now() - photoUploadStartedAt
        });

        stage = "InsightFace enrollment";
        const enrolledFace = await enrollFaceImage(req.file, req.requestId);

        stage = "MongoDB user save";
        user.faceEmbedding = enrolledFace.embedding;
        user.faceEmbeddingModel = enrolledFace.modelId;
        user.facePhotoUrl = savedPhoto.url;

        await user.save();
        stagedFacePhotoUrl = null;
        console.info("Face re-enrollment processing completed", {
            requestId: req.requestId,
            elapsedMs: Date.now() - startedAt,
            embeddingLength: enrolledFace.embedding.length,
            embeddingModel: enrolledFace.modelId
        });
        await removeStoredImage(previousFacePhotoUrl);

        return res.status(200).json({
            message: "Face enrolled successfully.",
            faceEnrolled: true,
            facePhotoUrl: user.facePhotoUrl,
            faceEmbeddingModel: user.faceEmbeddingModel
        });

    } catch (error) {
        const status = Number(error.statusCode || error.status) || 500;
        console.error("Face re-enrollment processing failed", {
            requestId: req.requestId,
            stage,
            elapsedMs: Date.now() - startedAt,
            status,
            upstreamStatus: error.response?.status || null,
            ...getSafeErrorDetails(error)
        });
        await removeStoredImage(stagedFacePhotoUrl);

        return res.status(status).json({
            message: error.publicMessage || error.response?.data?.detail ||
                (status < 500 ? error.message : `Unable to complete ${stage.toLowerCase()}. Please try again later.`),
            requestId: req.requestId,
            stage
        });
    }
};

module.exports = {
    getFacultyProfile,
    enrollFace
};
