const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true
        },

        email: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true
        },

        password: {
            type: String,
            required: true
        },

        role: {
            type: String,
            enum: ["student", "faculty", "admin"],
            default: "student"
        },

        studentId: {
            type: String,
            default: null
        },

        faceEmbedding: {
         type: [Number],
         default: null
         },

        faceEmbeddingModel: {
            type: String,
            default: null
        },

        facePhotoUrl: {
            type: String,
            default: null
        },

        department: {
            type: String,
            default: null
        },

        // Faculty approval status
        facultyStatus: {
            type: String,
            enum: ["Inactive", "Active", "Expired", "Rejected"],
            default: function () {
                return this.role === "faculty"
                    ? "Inactive"
                    : "Active";
            }
        },

        // Faculty registration date
        facultyRegisteredAt: {
            type: Date,
            default: function () {
                return this.role === "faculty"
                    ? new Date()
                    : null;
            }
        },

        // Date on which admin approves faculty
        facultyApprovedAt: {
            type: Date,
            default: null
        },

        // Forgot password reset token
        resetPasswordToken: {
            type: String,
            default: null
        },

        // Reset token expiry time
        resetPasswordExpires: {
            type: Date,
            default: null
        }
    },
    {
        timestamps: true
    }
);

module.exports = mongoose.model("User", userSchema);
