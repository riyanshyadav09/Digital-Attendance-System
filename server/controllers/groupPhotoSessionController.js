const mongoose = require("mongoose");
const GroupPhotoSession = require("../models/GroupPhotoSession");
const Subject = require("../models/Subjects");
const { saveGroupPhoto, removeStoredImage } = require("../services/objectStorageService");

const sessionView = (session) => ({
    id: session._id,
    subject: session.subject,
    subjectName: session.subjectName,
    subjectCode: session.subjectCode,
    department: session.department,
    section: session.section,
    date: session.date,
    groupPhotoUrl: session.groupPhotoUrl,
    reviewStatus: session.reviewStatus,
    reviewedAt: session.reviewedAt,
    createdAt: session.createdAt
});

const createGroupPhotoSession = async (req, res) => {
    let uploadedPhoto = null;
    let stage = "validation";

    try {
        const { subjectId, section = "", idempotencyKey } = req.body;
        if (!subjectId || !mongoose.isValidObjectId(subjectId)) {
            return res.status(400).json({ message: "A valid subject is required." });
        }
        if (!req.file) {
            return res.status(400).json({ message: "Please select or capture a group photo." });
        }
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idempotencyKey || "")) {
            return res.status(400).json({ message: "The upload request is invalid. Please retry." });
        }

        stage = "subject authorization";
        const subject = await Subject.findById(subjectId);
        if (!subject) return res.status(404).json({ message: "Subject not found." });
        if (req.user.role === "faculty" && subject.faculty.toString() !== req.user.id) {
            return res.status(403).json({ message: "You are not authorized to save a photo for this subject." });
        }
        if (subject.status !== "Active") {
            return res.status(400).json({ message: "This subject is currently inactive." });
        }

        const existing = await GroupPhotoSession.findOne({
            faculty: req.user.id,
            idempotencyKey
        });
        if (existing) {
            if (existing.subject.toString() !== subjectId) {
                return res.status(409).json({ message: "This upload retry key was already used for another subject." });
            }
            return res.status(200).json({
                message: "This photo session was already saved.",
                session: sessionView(existing),
                retry: true
            });
        }

        stage = "Cloudinary photo upload";
        uploadedPhoto = await saveGroupPhoto(req.file);

        stage = "MongoDB session save";
        const session = await GroupPhotoSession.create({
            subject: subject._id,
            faculty: req.user.id,
            subjectName: subject.name,
            subjectCode: subject.code,
            department: subject.department,
            section: String(section).trim().slice(0, 80),
            date: new Date(),
            groupPhotoUrl: uploadedPhoto.url,
            cloudinaryPublicId: uploadedPhoto.publicId,
            reviewStatus: "Pending",
            idempotencyKey
        });

        return res.status(201).json({
            message: "Group photo session saved. No student attendance was marked.",
            session: sessionView(session),
            retry: false
        });
    } catch (error) {
        if (uploadedPhoto?.url) await removeStoredImage(uploadedPhoto.url);

        if (error.code === 11000) {
            try {
                const existing = await GroupPhotoSession.findOne({
                    faculty: req.user.id,
                    idempotencyKey: req.body.idempotencyKey
                });
                if (existing && existing.subject.toString() === req.body.subjectId) {
                    return res.status(200).json({
                        message: "This photo session was already saved.",
                        session: sessionView(existing),
                        retry: true
                    });
                }
            } catch (lookupError) {
                console.error("Group photo retry lookup failed", { name: lookupError.name });
            }
        }

        const status = Number(error.statusCode || error.status) || 500;
        console.error("Group photo session save failed", {
            stage,
            status,
            errorName: error.name || "Error",
            errorCode: error.code || null
        });
        return res.status(status).json({
            message: error.publicMessage || (status < 500
                ? error.message
                : `Unable to complete ${stage.toLowerCase()}. Please retry.`)
        });
    }
};

const getGroupPhotoSessions = async (req, res) => {
    try {
        const filter = req.user.role === "admin"
            ? {}
            : { faculty: req.user.id };
        if (req.query.subjectId) {
            if (!mongoose.isValidObjectId(req.query.subjectId)) {
                return res.status(400).json({ message: "Invalid subject ID." });
            }
            filter.subject = req.query.subjectId;
        }

        const sessions = await GroupPhotoSession.find(filter)
            .sort({ date: -1 })
            .limit(50)
            .lean();
        return res.status(200).json({
            sessions: sessions.map(sessionView)
        });
    } catch (error) {
        console.error("Group photo session list failed", { name: error.name || "Error" });
        return res.status(500).json({ message: "Unable to load saved photo sessions." });
    }
};

const markGroupPhotoSessionReviewed = async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) {
            return res.status(400).json({ message: "Invalid photo session ID." });
        }
        const session = await GroupPhotoSession.findById(req.params.id);
        if (!session) return res.status(404).json({ message: "Photo session not found." });
        if (req.user.role === "faculty" && session.faculty.toString() !== req.user.id) {
            return res.status(403).json({ message: "You are not authorized to review this photo session." });
        }

        session.reviewStatus = "Reviewed";
        session.reviewedAt = new Date();
        session.reviewedBy = req.user.id;
        await session.save();
        return res.status(200).json({
            message: "Photo session marked as reviewed.",
            session: sessionView(session)
        });
    } catch (error) {
        console.error("Group photo session review failed", { name: error.name || "Error" });
        return res.status(500).json({ message: "Unable to update the photo session review." });
    }
};

module.exports = {
    createGroupPhotoSession,
    getGroupPhotoSessions,
    markGroupPhotoSessionReviewed
};
