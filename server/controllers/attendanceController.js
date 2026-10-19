const Attendance = require("../models/Attendance");
const Subject = require("../models/Subjects");
const User = require("../models/User");

const axios = require("axios");
const FormData = require("form-data");
const { saveGroupPhoto, removeStoredImage } = require("../services/objectStorageService");
const { getFaceServiceUrl, getFaceServiceTimeoutMs } = require("../config/faceService");

// ======================================================
// CALCULATE DISTANCE BETWEEN TWO LOCATIONS
// ======================================================

const calculateDistance = (
    latitude1,
    longitude1,
    latitude2,
    longitude2
) => {

    const earthRadius = 6371000;

    const lat1 =
        (latitude1 * Math.PI) / 180;

    const lat2 =
        (latitude2 * Math.PI) / 180;

    const deltaLat =
        ((latitude2 - latitude1) * Math.PI) / 180;

    const deltaLongitude =
        ((longitude2 - longitude1) * Math.PI) / 180;

    const a =
        Math.sin(deltaLat / 2) *
            Math.sin(deltaLat / 2) +

        Math.cos(lat1) *
            Math.cos(lat2) *
            Math.sin(deltaLongitude / 2) *
            Math.sin(deltaLongitude / 2);

    const c =
        2 *
        Math.atan2(
            Math.sqrt(a),
            Math.sqrt(1 - a)
        );

    return earthRadius * c;
};


// ======================================================
// MARK GROUP / MANUAL ATTENDANCE
// ======================================================

const markAttendance = async (req, res) => {
    let storedGroupPhotoUrl = null;

    try {

        const {
            studentId,
            subjectId,
            status,
            method
        } = req.body;
     
        let groupPhotoUrl = null;

        // =========================
        // VALIDATION
        // =========================

        if (!studentId) {

            return res.status(400).json({
                message:
                    "Student ID is required"
            });
        }


        if (!subjectId) {

            return res.status(400).json({
                message:
                    "Subject ID is required"
            });
        }


        // =========================
        // FIND SUBJECT
        // =========================

        const subject =
            await Subject.findById(
                subjectId
            );


        if (!subject) {

            return res.status(404).json({
                message:
                    "Subject not found"
            });
        }


        // =========================
        // SUBJECT STATUS
        // =========================

        if (
            subject.status !== "Active"
        ) {

            return res.status(400).json({
                message:
                    "This subject is currently inactive."
            });
        }


        // =========================
        // FACULTY OWNERSHIP
        // =========================

        if (
            req.user.role === "faculty" &&
            subject.faculty.toString() !==
                req.user.id
        ) {

            return res.status(403).json({
                message:
                    "You are not authorized to mark attendance for this subject."
            });
        }


        // =========================
        // DATE RANGE
        // =========================

        const startOfDay =
            new Date();

        startOfDay.setHours(
            0,
            0,
            0,
            0
        );


        const endOfDay =
            new Date();

        endOfDay.setHours(
            23,
            59,
            59,
            999
        );


        // =========================
        // DUPLICATE CHECK
        // =========================

        const existingAttendance =
            await Attendance.findOne({

                student:
                    studentId,

                subject:
                    subjectId,

                date: {
                    $gte:
                        startOfDay,

                    $lte:
                        endOfDay
                }
            });


        if (existingAttendance) {

            // Pending
            if (
                existingAttendance.reviewStatus ===
                "Pending"
            ) {

                return res.status(400).json({
                    message:
                        "Attendance is already submitted and waiting for teacher approval."
                });
            }


            // Approved
            if (
                existingAttendance.reviewStatus ===
                "Approved"
            ) {

                return res.status(400).json({
                    message:
                        "Attendance has already been approved and is waiting for finalization."
                });
            }


            // Finalized
            if (
                existingAttendance.finalizedAt
            ) {

                return res.status(400).json({
                    message:
                        "Attendance already finalized for this subject today."
                });
            }


            // Rejected
            if (
                existingAttendance.reviewStatus ===
                "Rejected"
            ) {

                await Attendance.deleteOne({
                    _id:
                        existingAttendance._id
                });
            }
        }


        // =========================
        // CURRENT TIME
        // =========================

        const now =
            new Date();


        const time =
            now.toLocaleTimeString(
                "en-IN",
                {
                    hour:
                        "2-digit",

                    minute:
                        "2-digit",

                    hour12:
                        true
                }
            );


        // =========================
        // CREATE ATTENDANCE
        // =========================

        if (req.file) {
            groupPhotoUrl = (await saveGroupPhoto(req.file)).url;
            storedGroupPhotoUrl = groupPhotoUrl;
        }

        const attendance =
            await Attendance.create({

                student:
                    studentId,

                subject:
                    subject._id,

                faculty:
                    subject.faculty,

                date:
                    now,

                time:
                    time,

                status:
                    status ||
                    "Present",

                method:
                    method ||
                    "Face Recognition",

                groupPhotoUrl: groupPhotoUrl,

                attendanceType:
                    "Group Photo",

                reviewStatus:
                    "Pending",

                teacherComment:
                    "",

                finalizedAt:
                    null
            });
        storedGroupPhotoUrl = null;


        // =========================
        // POPULATE RESULT
        // =========================

        const populatedAttendance =
            await Attendance.findById(
                attendance._id
            )

                .populate(
                    "student",
                    "name email studentId department"
                )

                .populate(
                    "subject",
                    "name code department status"
                )

                .populate(
                    "faculty",
                    "name email department"
                );


        return res.status(201).json({

            message:
                "Attendance submitted successfully and is waiting for teacher approval.",

            attendance:
                populatedAttendance
        });


    } catch (error) {
        await removeStoredImage(storedGroupPhotoUrl);

        console.error(
            "Attendance Error:",
            error.message
        );


        return res.status(error.statusCode || 500).json({
            message:
                "Server error"
        });
    }
};



// ======================================================
// SELF ATTENDANCE
// ======================================================

const selfAttendance = async (
    req,
    res
) => {

    try {

        const {
            latitude,
            longitude,
            subjectId
        } = req.body;


        const studentId =
            req.user.id;


        // =========================
        // SUBJECT REQUIRED
        // =========================

        if (!subjectId) {

            return res.status(400).json({
                message:
                    "Please select a subject."
            });
        }


        // =========================
        // FIND SUBJECT
        // =========================

        const subject =
            await Subject.findById(
                subjectId
            );


        if (!subject) {

            return res.status(404).json({
                message:
                    "Selected subject was not found."
            });
        }


        // =========================
        // SUBJECT ACTIVE
        // =========================

        if (
            subject.status !== "Active"
        ) {

            return res.status(400).json({
                message:
                    "This subject is currently inactive."
            });
        }

        const isEnrolled = subject.students.some(
            (enrolledStudent) =>
                enrolledStudent.toString() === studentId
        );

        if (!isEnrolled) {
            return res.status(403).json({
                message:
                    "You must be enrolled in this subject before submitting attendance."
            });
        }


        // =========================
        // LOCATION REQUIRED
        // =========================

        if (
            latitude === undefined ||
            longitude === undefined
        ) {

            return res.status(400).json({
                message:
                    "Campus location is required."
            });
        }


        const studentLatitude =
            Number(latitude);

        const studentLongitude =
            Number(longitude);


        if (
            Number.isNaN(
                studentLatitude
            ) ||
            Number.isNaN(
                studentLongitude
            )
        ) {

            return res.status(400).json({
                message:
                    "Invalid latitude or longitude."
            });
        }


        // =========================
        // FACE VERIFICATION
        // Never trust a browser-provided boolean. The submitted selfie is
        // rechecked here, immediately before the attendance is created.
        // =========================

        const verification = await verifyStudentSelfie(
            studentId,
            req.file
        );

        if (!verification.verified) {
            return res.status(400).json({
                message: verification.message,
                faceVerified: false,
                facesDetected: verification.facesDetected,
                similarity: verification.similarity
            });
        }


        // =========================
        // CAMPUS CONFIG
        // =========================

        const campusLatitude =
            Number(
                process.env.CAMPUS_LATITUDE
            );

        const campusLongitude =
            Number(
                process.env.CAMPUS_LONGITUDE
            );

        const campusRadius =
            Number(
                process.env.CAMPUS_RADIUS
            );


        if (
            Number.isNaN(
                campusLatitude
            ) ||
            Number.isNaN(
                campusLongitude
            ) ||
            Number.isNaN(
                campusRadius
            )
        ) {

            console.error(
                "Campus location configuration is missing or invalid."
            );

            return res.status(500).json({
                message:
                    "Campus location is not configured correctly."
            });
        }


        // =========================
        // CALCULATE DISTANCE
        // =========================

        const distance =
            calculateDistance(
                studentLatitude,
                studentLongitude,
                campusLatitude,
                campusLongitude
            );


        console.log(
            `Student distance from campus: ${Math.round(
                distance
            )} meters`
        );


        // =========================
        // GEOFENCE
        // =========================

        if (
            distance >
            campusRadius
        ) {

            return res.status(403).json({

                message:
                    "You are outside the campus area. Attendance cannot be submitted.",

                distance:
                    Math.round(distance),

                allowedRadius:
                    campusRadius
            });
        }


        // =========================
        // DATE RANGE
        // =========================

        const startOfDay =
            new Date();

        startOfDay.setHours(
            0,
            0,
            0,
            0
        );


        const endOfDay =
            new Date();

        endOfDay.setHours(
            23,
            59,
            59,
            999
        );


        // =========================
        // DUPLICATE CHECK
        // =========================

        const existingAttendance =
            await Attendance.findOne({

                student:
                    studentId,

                subject:
                    subjectId,

                date: {
                    $gte:
                        startOfDay,

                    $lte:
                        endOfDay
                }
            });


        if (existingAttendance) {

            if (
                existingAttendance.reviewStatus ===
                "Pending"
            ) {

                return res.status(400).json({
                    message:
                        "Your attendance is already submitted and waiting for teacher approval."
                });
            }


            if (
                existingAttendance.reviewStatus ===
                "Approved"
            ) {

                return res.status(400).json({
                    message:
                        "Your attendance has been approved and is waiting for finalization."
                });
            }


            if (
                existingAttendance.finalizedAt
            ) {

                return res.status(400).json({
                    message:
                        "Attendance already finalized for this subject today."
                });
            }


            if (
                existingAttendance.reviewStatus ===
                "Rejected"
            ) {

                await Attendance.deleteOne({
                    _id:
                        existingAttendance._id
                });
            }
        }


        // =========================
        // CURRENT TIME
        // =========================

        const now =
            new Date();


        const time =
            now.toLocaleTimeString(
                "en-IN",
                {
                    hour:
                        "2-digit",

                    minute:
                        "2-digit",

                    hour12:
                        true
                }
            );


        // =========================
        // CREATE ATTENDANCE
        // =========================

        const attendance =
            await Attendance.create({

                student:
                    studentId,

                subject:
                    subject._id,

                faculty:
                    subject.faculty,

                date:
                    now,

                time:
                    time,

                status:
                    "Present",

                method:
                    "Selfie",

                attendanceType:
                    "Self Attendance",

                latitude:
                    studentLatitude,

                longitude:
                    studentLongitude,

                faceVerified:
                    true,

                faceSimilarity:
                    verification.similarity,

                locationVerified:
                    true,

                reviewStatus:
                    "Pending",

                teacherComment:
                    "",

                finalizedAt:
                    null
            });


        // =========================
        // POPULATE RESULT
        // =========================

        const populatedAttendance =
            await Attendance.findById(
                attendance._id
            )

                .populate(
                    "student",
                    "name email studentId department"
                )

                .populate(
                    "subject",
                    "name code department status"
                )

                .populate(
                    "faculty",
                    "name email department"
                );


        return res.status(201).json({

            message:
                "Self attendance submitted successfully and is waiting for teacher approval.",

            distance:
                Math.round(distance),

            locationVerified:
                true,

            faceVerified:
                true,

            faceSimilarity:
                verification.similarity,

            attendance:
                populatedAttendance
        });


    } catch (error) {

        console.error(
            "Self Attendance Error:",
            error.message
        );

        const statusCode =
            error.statusCode ||
            error.response?.status ||
            500;

        const errorMessage =
            error.message ||
            "Unable to submit self attendance.";

        return res.status(statusCode).json({
            message:
                errorMessage
        });
    }
};



// ======================================================
// GET PENDING ATTENDANCE
// ======================================================

const getPendingAttendance =
    async (
        req,
        res
    ) => {

        try {

            let query = {
                reviewStatus:
                    "Pending"
            };


            // Faculty sees only
            // their own attendance

            if (
                req.user.role ===
                "faculty"
            ) {

                query.faculty =
                    req.user.id;
            }


            const attendance =
                await Attendance.find(
                    query
                )

                    .populate(
                        "student",
                        "name email studentId department"
                    )

                    .populate(
                        "subject",
                        "name code department"
                    )

                    .populate(
                        "faculty",
                        "name email department"
                    )

                    .sort({
                        createdAt:
                            -1
                    });


            return res.status(200).json({

                message:
                    "Pending attendance fetched successfully",

                attendance
            });


        } catch (error) {

            console.error(
                "Fetch Pending Error:",
                error.message
            );


            return res.status(500).json({
                message:
                    "Server error"
            });
        }
    };



// ======================================================
// REVIEW ATTENDANCE
// ======================================================

const reviewAttendance =
    async (
        req,
        res
    ) => {

        try {

            const { id } =
                req.params;


            const {
                decision,
                teacherComment
            } = req.body;


            // =========================
            // VALID DECISION
            // =========================

            if (
                ![
                    "Approved",
                    "Rejected"
                ].includes(
                    decision
                )
            ) {

                return res.status(400).json({
                    message:
                        "Decision must be Approved or Rejected"
                });
            }

            if (
                decision === "Rejected" &&
                (typeof teacherComment !== "string" ||
                    !teacherComment.trim())
            ) {
                return res.status(400).json({
                    message:
                        "A rejection reason is required."
                });
            }


            // =========================
            // FIND ATTENDANCE
            // =========================

            const attendance =
                await Attendance.findById(
                    id
                );


            if (!attendance) {

                return res.status(404).json({
                    message:
                        "Attendance record not found"
                });
            }


            // =========================
            // ALREADY REVIEWED
            // =========================

            if (
                attendance.reviewStatus !==
                "Pending"
            ) {

                return res.status(400).json({
                    message:
                        "Attendance has already been reviewed"
                });
            }


            // =========================
            // FACULTY OWNERSHIP
            // =========================

            if (
                req.user.role ===
                "faculty"
            ) {

                if (
                    attendance.faculty.toString() !==
                    req.user.id
                ) {

                    return res.status(403).json({
                        message:
                            "You are not authorized to review this attendance."
                    });
                }
            }


            // =========================
            // UPDATE REVIEW
            // =========================

            attendance.reviewStatus =
                decision;


            attendance.teacherComment =
                teacherComment || "";


            await attendance.save();


            // =========================
            // POPULATE RESULT
            // =========================

            const populatedAttendance =
                await Attendance.findById(
                    id
                )

                    .populate(
                        "student",
                        "name email studentId department"
                    )

                    .populate(
                        "subject",
                        "name code department"
                    )

                    .populate(
                        "faculty",
                        "name email department"
                    );


            return res.status(200).json({

                message:
                    `Attendance ${decision.toLowerCase()} successfully`,

                attendance:
                    populatedAttendance
            });


        } catch (error) {

            console.error(
                "Review Attendance Error:",
                error.message
            );


            return res.status(500).json({
                message:
                    "Server error"
            });
        }
    };



// ======================================================
// FINALIZE ATTENDANCE
// ======================================================

const finalizeAttendance =
    async (
        req,
        res
    ) => {

        try {

            const { id } =
                req.params;


            // =========================
            // FIND ATTENDANCE
            // =========================

            const attendance =
                await Attendance.findById(
                    id
                );


            if (!attendance) {

                return res.status(404).json({
                    message:
                        "Attendance record not found"
                });
            }


            // =========================
            // FACULTY OWNERSHIP
            // =========================

            if (
                req.user.role ===
                "faculty"
            ) {

                if (
                    attendance.faculty.toString() !==
                    req.user.id
                ) {

                    return res.status(403).json({
                        message:
                            "You are not authorized to finalize this attendance."
                    });
                }
            }


            // =========================
            // MUST BE APPROVED
            // =========================

            if (
                attendance.reviewStatus !==
                "Approved"
            ) {

                return res.status(400).json({
                    message:
                        "Attendance must be approved before finalization"
                });
            }


            // =========================
            // ALREADY FINALIZED
            // =========================

            if (
                attendance.finalizedAt
            ) {

                return res.status(400).json({
                    message:
                        "Attendance is already finalized"
                });
            }


            // =========================
            // FINALIZE
            // =========================

            attendance.finalizedAt =
                new Date();


            await attendance.save();


            // =========================
            // POPULATE RESULT
            // =========================

            const populatedAttendance =
                await Attendance.findById(
                    id
                )

                    .populate(
                        "student",
                        "name email studentId department"
                    )

                    .populate(
                        "subject",
                        "name code department"
                    )

                    .populate(
                        "faculty",
                        "name email department"
                    );


            return res.status(200).json({

                message:
                    "Attendance finalized successfully",

                attendance:
                    populatedAttendance
            });


        } catch (error) {

            console.error(
                "Finalize Attendance Error:",
                error.message
            );


            return res.status(500).json({
                message:
                    "Server error"
            });
        }
    };



// ======================================================
// GET ALL ATTENDANCE RECORDS
// ======================================================

const getAllAttendanceRecords =
    async (
        req,
        res
    ) => {

        try {

            let query = {};


            // Faculty sees only
            // their own records

            if (
                req.user.role ===
                "faculty"
            ) {

                query.faculty =
                    req.user.id;
            }


            // Student gets own records
            // through history endpoint

            const attendance =
                await Attendance.find(
                    query
                )

                    .populate(
                        "student",
                        "name email studentId department"
                    )

                    .populate(
                        "subject",
                        "name code department"
                    )

                    .populate(
                        "faculty",
                        "name email department"
                    )

                    .sort({
                        date:
                            -1,

                        createdAt:
                            -1
                    });


            return res.status(200).json({

                message:
                    "Attendance records fetched successfully",

                attendance
            });


        } catch (error) {

            console.error(
                "Fetch Attendance Records Error:",
                error.message
            );


            return res.status(500).json({
                message:
                    "Server error"
            });
        }
    };



// ======================================================
// GET STUDENT ATTENDANCE HISTORY
// ======================================================

const getAttendanceHistory =
    async (
        req,
        res
    ) => {

        try {

            const {
                studentId
            } = req.params;


            // =========================
            // STUDENT OWNERSHIP
            // =========================

            if (
                req.user.role ===
                "student"
            ) {

                if (
                    req.user.id !==
                    studentId
                ) {

                    return res.status(403).json({
                        message:
                            "You are not authorized to view this attendance history."
                    });
                }
            }


            // =========================
            // FACULTY
            // =========================

            let query = {
                student:
                    studentId
            };


            if (
                req.user.role ===
                "faculty"
            ) {

                query.faculty =
                    req.user.id;
            }


            // =========================
            // GET RECORDS
            // =========================

            const attendance =
                await Attendance.find(
                    query
                )

                    .populate(
                        "student",
                        "name email studentId department"
                    )

                    .populate(
                        "subject",
                        "name code department"
                    )

                    .populate(
                        "faculty",
                        "name email department"
                    )

                    .sort({
                        date:
                            -1
                    });


            return res.status(200).json({

                message:
                    "Attendance history fetched successfully",

                attendance
            });


        } catch (error) {

            console.error(
                "Attendance History Error:",
                error.message
            );


            return res.status(500).json({
                message:
                    "Server error"
            });
        }
    };



// ======================================================
// EXPORTS
// ======================================================

const recognizeGroupPhoto = async (req, res) => {
    let storedGroupPhotoUrl = null;
    let attendanceCreated = false;

    try {
        const { subjectId } = req.body;

        if (!subjectId) {
            return res.status(400).json({
                message: "Subject ID is required."
            });
        }

        if (!req.file) {
            return res.status(400).json({
                message: "Group photo is required."
            });
        }

        // Find subject
        const subject = await Subject.findById(subjectId)
            .populate(
                "students",
                "name email faceEmbedding faceEmbeddingModel"
            );

        if (!subject) {
            return res.status(404).json({
                message: "Subject not found."
            });
        }

        // Only subject owner faculty can use recognition
        if (
            req.user.role === "faculty" &&
            subject.faculty.toString() !== req.user.id
        ) {
            return res.status(403).json({
                message:
                    "You are not authorized to take attendance for this subject."
            });
        }

        if (subject.status !== "Active") {
            return res.status(400).json({
                message: "This subject is inactive."
            });
        }

        // Students having enrolled faces
        const enrolledStudents = subject.students.filter(
            (student) =>
                Array.isArray(student.faceEmbedding) &&
                student.faceEmbedding.length === 512
        );

        if (enrolledStudents.length === 0) {
            return res.status(400).json({
                message:
                    "No students with enrolled faces found for this subject."
            });
        }

        // Prepare data for Python AI service
        const studentsData = enrolledStudents.map(
            (student) => ({
                studentId: student._id.toString(),
                embedding: student.faceEmbedding,
                embeddingModel: student.faceEmbeddingModel
            })
        );

        const formData = new FormData();

        formData.append(
            "file",
            req.file.buffer,
            {
                filename: req.file.originalname,
                contentType: req.file.mimetype
            }
        );

        formData.append(
            "students_json",
            JSON.stringify(studentsData)
        );

        // Send group photo to Python AI service
        const aiResponse = await axios.post(
            `${getFaceServiceUrl()}/recognize`,
            formData,
            {
                headers: {
                    ...formData.getHeaders(),
                    "X-Face-Service-Token": process.env.FACE_SERVICE_TOKEN
                },
                maxBodyLength: Infinity,
                timeout: getFaceServiceTimeoutMs()
            }
        );

        const recognitionResult = aiResponse.data;

        const matches = recognitionResult.matches || [];

        // Only accepted matches
        const recognizedStudents = matches.filter(
            (match) => match.match === true
        );

        if (recognizedStudents.length === 0) {
            return res.status(200).json({
                message:
                    "No enrolled students were recognized.",
                facesDetected:
                    recognitionResult.facesDetected || 0,
                recognizedStudents: [],
                reEnrollmentRequiredCount: recognitionResult.incompatibleStudentCount || 0
            });
        }

        storedGroupPhotoUrl = (await saveGroupPhoto(req.file)).url;

        const now = new Date();

        const dateOnly = new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate()
        );

        const hours = String(
            now.getHours()
        ).padStart(2, "0");

        const minutes = String(
            now.getMinutes()
        ).padStart(2, "0");

        const time = `${hours}:${minutes}`;

        const attendanceResults = [];

        for (const match of recognizedStudents) {

            const student = enrolledStudents.find(
                (item) =>
                    item._id.toString() ===
                    match.studentId
            );

            if (!student) {
                continue;
            }

            // Check today's attendance
            const existingAttendance =
                await Attendance.findOne({
                    student: student._id,
                    subject: subject._id,
                    date: {
                        $gte: dateOnly,
                        $lt: new Date(
                            dateOnly.getTime() +
                            24 * 60 * 60 * 1000
                        )
                    }
                });

            // Already marked today
            if (existingAttendance) {
                attendanceResults.push({
                    studentId: student._id,
                    studentName: student.name,
                    status: "Already Marked",
                    similarity: match.similarity
                });

                continue;
            }

            // Create attendance
            const attendance =
                await Attendance.create({
                    student: student._id,
                    subject: subject._id,
                    faculty: subject.faculty,
                    date: now,
                    time,
                    status: "Present",
                    method: "Face Recognition",
                    attendanceType: "Group Photo",
                    groupPhotoUrl: storedGroupPhotoUrl,
                    reviewStatus: "Pending",
                    teacherComment: "",
                    finalizedAt: null,
                    faceVerified: match.match === true,
                    faceSimilarity: match.similarity ?? null
                });
            attendanceCreated = true;

            attendanceResults.push({
                studentId: student._id,
                studentName: student.name,
                status: "Present",
                similarity: match.similarity,
                attendanceId: attendance._id
            });
        }

        return res.status(200).json({
            message:
                "Group photo recognition completed.",
            facesDetected:
                recognitionResult.facesDetected || 0,
            recognizedCount:
                recognizedStudents.length,
            reEnrollmentRequiredCount: recognitionResult.incompatibleStudentCount || 0,
            attendance: attendanceResults
        });

    } catch (error) {
        if (!attendanceCreated) {
            await removeStoredImage(storedGroupPhotoUrl);
        }

        console.error(
            "Group photo recognition failed:",
            error.message
        );

        const status = error.response?.status || error.statusCode || 500;
        return res.status(status).json({
            message:
                error.response?.data?.detail ||
                (status < 500 ? error.message : "Unable to recognize group photo.")
        });
    }
};

// ======================================================
// VERIFY A SELFIE AGAINST THE LOGGED-IN STUDENT
// ======================================================

const verifyStudentSelfie = async (studentId, file) => {
    if (!file) {
        const error = new Error("A selfie image is required.");
        error.statusCode = 400;
        throw error;
    }

    const student = await User.findById(studentId).select(
        "faceEmbedding"
    );

    if (!student) {
        const error = new Error("Student account was not found.");
        error.statusCode = 404;
        throw error;
    }

    if (
        !Array.isArray(student.faceEmbedding) ||
        student.faceEmbedding.length !== 512
    ) {
        const error = new Error(
            "Your face is not enrolled. Please complete face enrollment before submitting attendance."
        );
        error.statusCode = 400;
        throw error;
    }

    const formData = new FormData();

    formData.append(
        "file",
        file.buffer,
        {
            filename: file.originalname || "selfie.jpg",
            contentType: file.mimetype || "image/jpeg"
        }
    );

    formData.append(
        "students_json",
        JSON.stringify([
            {
                studentId: studentId.toString(),
                embedding: student.faceEmbedding,
                embeddingModel: student.faceEmbeddingModel
            }
        ])
    );

    let aiResponse;

    try {
        aiResponse = await axios.post(
            `${getFaceServiceUrl()}/recognize`,
            formData,
            {
                headers: {
                    ...formData.getHeaders(),
                    "X-Face-Service-Token": process.env.FACE_SERVICE_TOKEN
                },
                maxBodyLength: Infinity,
                timeout: getFaceServiceTimeoutMs()
            }
        );
    } catch (error) {
        const serviceError = new Error(
            error.response?.data?.detail ||
            "Face verification service is unavailable. Please try again."
        );

        serviceError.statusCode = error.response?.status || 503;
        throw serviceError;
    }

    const result = aiResponse.data || {};
    const facesDetected = Number(result.facesDetected || 0);

    // A selfie must contain exactly one face: the logged-in student.
    if (facesDetected !== 1) {
        return {
            verified: false,
            facesDetected,
            similarity: null,
            message:
                facesDetected === 0
                    ? "No face was detected. Retake your selfie in good lighting."
                    : "Exactly one face must be visible in the selfie."
        };
    }

    const match = (result.matches || []).find(
        (item) =>
            item.studentId === studentId.toString() &&
            item.match === true
    );

    return {
        verified: Boolean(match),
        facesDetected,
        similarity: match?.similarity ?? result.matches?.[0]?.similarity ?? null,
        message: match
            ? "Face verified successfully."
            : "This selfie does not match your enrolled face."
    };
};

const verifySelfie = async (req, res) => {
    try {
        const verification = await verifyStudentSelfie(
            req.user.id,
            req.file
        );

        return res.status(200).json(verification);
    } catch (error) {
        console.error("Selfie Verification Error:", error.message);

        return res.status(error.statusCode || 500).json({
            message: error.message || "Unable to verify selfie."
        });
    }
};

module.exports = {
    markAttendance,
    selfAttendance,
    verifySelfie,
    recognizeGroupPhoto,
    getPendingAttendance,
    getAllAttendanceRecords,
    reviewAttendance,
    finalizeAttendance,
    getAttendanceHistory
};
