const mongoose = require("mongoose");

const groupPhotoSessionSchema = new mongoose.Schema(
    {
        subject: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Subject",
            required: true,
            index: true
        },
        faculty: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true
        },
        subjectName: { type: String, required: true },
        subjectCode: { type: String, required: true },
        department: { type: String, required: true },
        section: { type: String, default: "" },
        date: { type: Date, required: true, default: Date.now },
        groupPhotoUrl: { type: String, required: true },
        cloudinaryPublicId: { type: String, required: true, select: false },
        reviewStatus: {
            type: String,
            enum: ["Pending", "Reviewed"],
            default: "Pending",
            index: true
        },
        reviewedAt: { type: Date, default: null },
        reviewedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null
        },
        idempotencyKey: { type: String, required: true }
    },
    { timestamps: true }
);

groupPhotoSessionSchema.index(
    { faculty: 1, idempotencyKey: 1 },
    { unique: true }
);

module.exports = mongoose.model("GroupPhotoSession", groupPhotoSessionSchema);
