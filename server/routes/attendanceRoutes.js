const express = require("express");
const router = express.Router();

const protect = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/roleMiddleware");
const facultyStatusMiddleware = require("../middleware/facultyStatusMiddleware");

const upload = require("../middleware/uploadMiddleware");
const uploadFace = require("../middleware/faceUploadMiddleware");

const {
    markAttendance,
    getPendingAttendance,
    getAllAttendanceRecords,
    reviewAttendance,
    finalizeAttendance,
    getAttendanceHistory,
    selfAttendance,
    verifySelfie,
    recognizeGroupPhoto
} = require("../controllers/attendanceController");
const {
    createGroupPhotoSession,
    getGroupPhotoSessions,
    markGroupPhotoSessionReviewed
} = require("../controllers/groupPhotoSessionController");


// ======================================================
// FACULTY / ADMIN → MARK GROUP PHOTO ATTENDANCE
// ======================================================

router.post(
    "/mark",
    protect,
    authorizeRoles("faculty", "admin"),
    facultyStatusMiddleware,
    upload.single("groupPhoto"),
    markAttendance
);

router.post(
    "/recognize-group",
    protect,
    authorizeRoles("faculty", "admin"),
    facultyStatusMiddleware,
    upload.single("groupPhoto"),
    recognizeGroupPhoto
);

// Photo-session storage is intentionally independent of face recognition.
router.post(
    "/group-photo-sessions",
    protect,
    authorizeRoles("faculty", "admin"),
    facultyStatusMiddleware,
    upload.single("groupPhoto"),
    createGroupPhotoSession
);

router.get(
    "/group-photo-sessions",
    protect,
    authorizeRoles("faculty", "admin"),
    getGroupPhotoSessions
);

router.put(
    "/group-photo-sessions/:id/review",
    protect,
    authorizeRoles("faculty", "admin"),
    facultyStatusMiddleware,
    markGroupPhotoSessionReviewed
);



// ======================================================
// FACULTY / ADMIN → GET PENDING ATTENDANCE
// Read-only → Expired faculty can still view
// ======================================================

router.get(
    "/pending",
    protect,
    authorizeRoles("faculty", "admin"),
    getPendingAttendance
);


// ======================================================
// FACULTY / ADMIN → APPROVE / REJECT ATTENDANCE
// Write operation → Expired faculty blocked
// ======================================================

router.put(
    "/review/:id",
    protect,
    authorizeRoles("faculty", "admin"),
    facultyStatusMiddleware,
    reviewAttendance
);


// ======================================================
// FACULTY / ADMIN → FINALIZE ATTENDANCE
// Write operation → Expired faculty blocked
// ======================================================

router.put(
    "/finalize/:id",
    protect,
    authorizeRoles("faculty", "admin"),
    facultyStatusMiddleware,
    finalizeAttendance
);


// ======================================================
// FACULTY / ADMIN → GET ALL ATTENDANCE RECORDS
// Read-only → Expired faculty can still view
// ======================================================

router.get(
    "/records",
    protect,
    authorizeRoles("faculty", "admin"),
    getAllAttendanceRecords
);


// ======================================================
// GET STUDENT ATTENDANCE HISTORY
// ======================================================

router.get(
    "/history/:studentId",
    protect,
    getAttendanceHistory
);


// ======================================================
// STUDENT → SELF ATTENDANCE
// ======================================================

router.post(
    "/verify-selfie",
    protect,
    authorizeRoles("student"),
    uploadFace.single("selfie"),
    verifySelfie
);

router.post(
    "/self",
    protect,
    authorizeRoles("student"),
    uploadFace.single("selfie"),
    selfAttendance
);


module.exports = router;
