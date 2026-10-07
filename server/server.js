import "dotenv/config";
import cors from "cors";
import express from "express";
import mongoose from "mongoose";
import { randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scrypt = promisify(scryptCallback);
const app = express();
const port = Number(process.env.PORT || 5000);
const serverDirectory = path.dirname(fileURLToPath(import.meta.url));
const clientBuildDirectory = path.resolve(serverDirectory, "../client/dist");
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const roles = ["student", "faculty", "admin"];

const userSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true }, name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true }, role: { type: String, enum: roles, default: "student" },
  department: { type: String, default: "" }, facultyStatus: { type: String, default: "approved" },
  token: { type: String, default: "" }, photoMime: { type: String, default: "" }, photoData: { type: Buffer, default: null }
}, { timestamps: true });
const subjectSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true }, name: String, code: String, department: String,
  facultyId: String, facultyName: String, faculty: mongoose.Schema.Types.Mixed,
  students: { type: [String], default: [] }, status: { type: String, default: "Active" }, active: { type: Boolean, default: true }
}, { timestamps: true, strict: false });
const attendanceSchema = new mongoose.Schema({ id: { type: String, required: true, unique: true }, studentId: String }, { timestamps: true, strict: false });
let User = mongoose.model("User", userSchema);
let Subject = mongoose.model("Subject", subjectSchema);
let Attendance = mongoose.model("Attendance", attendanceSchema);
let dbStatus = "starting";

app.use(cors());
app.use(express.json({ limit: "4mb" }));

const publicUser = (user) => {
  if (!user) return user;
  const value = typeof user.toObject === "function" ? user.toObject() : user;
  const { password, token, photoData, photoMime, _id, __v, ...safe } = value;
  return { ...safe, profilePhoto: photoData?.length ? `/api/users/${safe.id}/photo` : "" };
};
const hashPassword = async (password) => {
  const salt = randomUUID();
  const key = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${key.toString("hex")}`;
};
const verifyPassword = async (password, stored) => {
  const [scheme, salt, keyHex] = String(stored).split(":");
  if (scheme !== "scrypt" || !salt || !keyHex) return false;
  const expected = Buffer.from(keyHex, "hex");
  const actual = await scrypt(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};
const parsePhoto = (dataUrl) => {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || "");
  if (!match) return { error: "Please choose a valid JPG, PNG, or WEBP photo." };
  const data = Buffer.from(match[2], "base64");
  if (!data.length || data.length > MAX_PHOTO_BYTES) return { error: "Photo must be 2 MB or smaller." };
  return { photoMime: match[1], photoData: data };
};
const currentUser = async (req) => {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  return token ? User.findOne({ token }).lean() : null;
};
const requireUser = async (req, res, next) => {
  try {
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ message: "Please sign in again." });
    req.user = user;
    next();
  } catch (error) { next(error); }
};
const requireRole = (role) => (req, res, next) => {
  if (req.user.role !== role && req.user.role !== "admin") return res.status(403).json({ message: `Only ${role} accounts can do this.` });
  next();
};

app.get("/api/health", (_req, res) => res.json({ status: "ok", service: "Digital Attendance API", database: dbStatus }));

app.post("/api/auth/register", async (req, res, next) => {
  try {
    const { name, email, password, role = "student", department = "", studentPhoto = "" } = req.body;
    if (!name?.trim() || !email?.trim() || !password) return res.status(400).json({ message: "Name, email and password are required." });
    if (!roles.includes(role) || role === "admin") return res.status(400).json({ message: "Please select a valid account role." });
    if (password.length < 6) return res.status(400).json({ message: "Password must be at least 6 characters." });
    let photo = {};
    if (role === "student") {
      photo = parsePhoto(studentPhoto);
      if (photo.error) return res.status(400).json({ message: photo.error });
    }
    const user = await User.create({ id: randomUUID(), name: name.trim(), email: email.trim().toLowerCase(), password: await hashPassword(password), role, department: department.trim(), facultyStatus: role === "faculty" ? "pending" : "approved", ...photo });
    res.status(201).json({ message: "Registration successful. You can now sign in.", user: publicUser(user) });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: "This email is already registered." });
    next(error);
  }
});
app.post("/api/auth/login", async (req, res, next) => {
  try {
    const user = await User.findOne({ email: String(req.body.email || "").trim().toLowerCase() });
    if (!user || !(await verifyPassword(String(req.body.password || ""), user.password))) return res.status(401).json({ message: "Invalid email or password. Register first if you do not have an account." });
    user.token = randomUUID();
    await user.save();
    res.json({ token: user.token, user: publicUser(user), message: "Login successful" });
  } catch (error) { next(error); }
});
app.get("/api/users/:id/photo", async (req, res, next) => {
  try {
    const user = await User.findOne({ id: req.params.id }).select("photoData photoMime").lean();
    if (!user?.photoData?.length) return res.sendStatus(404);
    res.type(user.photoMime).set("Cache-Control", "public, max-age=3600").send(user.photoData);
  } catch (error) { next(error); }
});
app.put("/api/user/profile", requireUser, async (req, res, next) => {
  try {
    const { name, department, profilePhoto = "" } = req.body;
    if (!name?.trim() || !department?.trim()) return res.status(400).json({ message: "Name and department are required." });
    const changes = { name: name.trim(), department: department.trim() };
    if (profilePhoto) {
      const photo = parsePhoto(profilePhoto);
      if (photo.error) return res.status(400).json({ message: photo.error });
      Object.assign(changes, photo);
    }
    const user = await User.findOneAndUpdate({ id: req.user.id }, changes, { new: true });
    res.json({ message: "Profile updated successfully.", user: publicUser(user) });
  } catch (error) { next(error); }
});

app.post("/api/auth/forgot-password", (_req, res) => res.status(501).json({ message: "Password reset email service is not configured." }));
app.post("/api/auth/verify-reset-otp", (_req, res) => res.status(501).json({ message: "OTP email service is not configured." }));
app.post("/api/auth/reset-password", (_req, res) => res.status(501).json({ message: "OTP email service is not configured." }));

app.get("/api/subjects/available", requireUser, async (_req, res, next) => { try { res.json({ subjects: await Subject.find().lean() }); } catch (error) { next(error); } });
app.get("/api/subjects/my", requireUser, async (req, res, next) => { try { res.json({ subjects: await Subject.find({ facultyId: req.user.id }).lean() }); } catch (error) { next(error); } });
app.post("/api/subjects", requireUser, requireRole("faculty"), async (req, res, next) => {
  try {
    const { name, code, department } = req.body;
    if (!name || !code) return res.status(400).json({ message: "Subject name and code are required." });
    const id = randomUUID();
    const subject = await Subject.create({ id, name, code, department, facultyId: req.user.id, facultyName: req.user.name, faculty: { name: req.user.name }, status: "Active", students: [], active: true });
    res.status(201).json({ message: "Subject created", subject });
  } catch (error) { next(error); }
});
app.put("/api/subjects/:id", requireUser, requireRole("faculty"), async (req, res, next) => {
  try {
    const subject = await Subject.findOneAndUpdate({ id: req.params.id, facultyId: req.user.id }, req.body, { new: true });
    if (!subject) return res.status(404).json({ message: "Subject not found." });
    res.json({ message: "Subject updated", subject });
  } catch (error) { next(error); }
});
app.delete("/api/subjects/:id", requireUser, requireRole("faculty"), async (req, res, next) => {
  try {
    const result = await Subject.deleteOne({ id: req.params.id, facultyId: req.user.id });
    if (!result.deletedCount) return res.status(404).json({ message: "Subject not found." });
    res.json({ message: "Subject deleted" });
  } catch (error) { next(error); }
});
app.post("/api/subjects/:id/join", requireUser, async (req, res, next) => {
  try {
    const subject = await Subject.findOneAndUpdate({ id: req.params.id }, { $addToSet: { students: req.user.id } }, { new: true });
    if (!subject) return res.status(404).json({ message: "Subject not found." });
    res.json({ message: "Subject joined" });
  } catch (error) { next(error); }
});
app.delete("/api/subjects/:id/leave", requireUser, async (req, res, next) => { try { await Subject.updateOne({ id: req.params.id }, { $pull: { students: req.user.id } }); res.json({ message: "Subject left" }); } catch (error) { next(error); } });

app.get("/api/attendance/records", requireUser, async (_req, res, next) => { try { res.json(await Attendance.find().lean()); } catch (error) { next(error); } });
app.get("/api/attendance/history/:userId", requireUser, async (req, res, next) => { try { res.json(await Attendance.find({ studentId: req.params.userId }).lean()); } catch (error) { next(error); } });
app.get("/api/attendance/pending", requireUser, async (_req, res, next) => { try { res.json(await Attendance.find({ status: { $in: ["Pending", "pending"] } }).lean()); } catch (error) { next(error); } });
app.post("/api/attendance/self", requireUser, async (req, res, next) => {
  try {
    const item = await Attendance.create({ id: randomUUID(), studentId: req.user.id, studentName: req.user.name, ...req.body, status: "Present", createdAt: new Date() });
    res.status(201).json({ message: "Attendance marked", attendance: item });
  } catch (error) { next(error); }
});
app.post("/api/attendance/verify-selfie", requireUser, (_req, res) => res.status(503).json({ message: "Face recognition service is not ready yet." }));
app.post("/api/attendance/recognize-group", requireUser, (_req, res) => res.status(503).json({ message: "Face recognition service is not ready yet." }));
app.post("/api/attendance/mark", requireUser, async (req, res, next) => { try { await Attendance.create({ id: randomUUID(), studentId: req.user.id, studentName: req.user.name, ...req.body, status: "Pending", createdAt: new Date() }); res.status(201).json({ message: "Attendance submitted for review." }); } catch (error) { next(error); } });
app.put("/api/attendance/:action/:id", requireUser, async (req, res, next) => {
  try {
    const status = req.params.action === "approve" ? "Approved" : req.params.action === "reject" ? "Rejected" : req.params.action === "finalize" ? "Finalized" : null;
    if (!status) return res.status(400).json({ message: "Invalid attendance action." });
    const item = await Attendance.findOneAndUpdate({ id: req.params.id }, { status }, { new: true });
    if (!item) return res.status(404).json({ message: "Attendance record not found." });
    res.json({ message: `Attendance ${status.toLowerCase()}`, attendance: item });
  } catch (error) { next(error); }
});

app.get("/api/admin/users", requireUser, requireRole("admin"), async (_req, res, next) => { try { res.json((await User.find().lean()).map(publicUser)); } catch (error) { next(error); } });
app.get("/api/admin/faculty", requireUser, requireRole("admin"), async (_req, res, next) => { try { res.json((await User.find({ role: "faculty" }).lean()).map(publicUser)); } catch (error) { next(error); } });
app.get("/api/admin/settings", requireUser, requireRole("admin"), (_req, res) => res.json({ campusLatitude: process.env.CAMPUS_LATITUDE || "", campusLongitude: process.env.CAMPUS_LONGITUDE || "", campusRadius: process.env.CAMPUS_RADIUS || 150 }));
app.put("/api/admin/faculty/:id/:action", requireUser, requireRole("admin"), async (req, res, next) => {
  try {
    const facultyStatus = req.params.action === "approve" ? "approved" : req.params.action === "reject" ? "rejected" : null;
    if (!facultyStatus) return res.status(400).json({ message: "Invalid faculty action." });
    const faculty = await User.findOneAndUpdate({ id: req.params.id, role: "faculty" }, { facultyStatus }, { new: true });
    if (!faculty) return res.status(404).json({ message: "Faculty member not found." });
    res.json({ message: `Faculty ${faculty.facultyStatus}` });
  } catch (error) { next(error); }
});
app.get("/api/user/faculty-profile", requireUser, (req, res) => res.json(publicUser(req.user)));

app.use("/api", (_req, res) => res.status(404).json({ message: "API route not found." }));
app.use(express.static(clientBuildDirectory));
app.get("*path", (_req, res) => res.sendFile(path.join(clientBuildDirectory, "index.html")));
app.use((error, _req, res, _next) => {
  console.error("Request failed:", error);
  if (error.name === "ValidationError") return res.status(400).json({ message: error.message });
  res.status(500).json({ message: "Server error. Please try again." });
});

const defaultSubjects = [
  { id: "renewable-energy-resource", name: "Renewable Energy Resource", code: "RER-401", department: "CSE", facultyName: "Dr. Anjali Sharma" },
  { id: "artificial-intelligence", name: "Artificial Intelligence", code: "AI-402", department: "CSE", facultyName: "Dr. Rahul Verma" },
  { id: "cloud-computing", name: "Cloud Computing", code: "CC-403", department: "CSE", facultyName: "Prof. Neha Gupta" },
  { id: "soft-skill", name: "Reasoning and Soft Skill", code: "RSS-404", department: "CSE", facultyName: "Ms. Priya Singh" }
];

if (process.env.MONGO_URI) {
  try {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
    dbStatus = "connected (MongoDB Atlas)";
    console.log("MongoDB Atlas connected successfully.");
  } catch (error) {
    console.warn("MongoDB Atlas connection failed, activating Automatic Storage:", error.message);
  }
}

if (mongoose.connection.readyState !== 1) {
  const { AutoUser, AutoSubject, AutoAttendance } = await import("./store.js");
  User = AutoUser;
  Subject = AutoSubject;
  Attendance = AutoAttendance;
  dbStatus = "connected";
  console.log("Digital Attendance System active in Automatic Database Mode.");
}

const adminName = process.env.ADMIN_NAME || "System Administrator";
const adminEmail = (process.env.ADMIN_EMAIL || "admin@attendance.com").trim().toLowerCase();
const adminPassword = process.env.ADMIN_PASSWORD || "Admin@12345";

try {
  if (!(await User.exists({ email: adminEmail }))) {
    await User.create({
      id: randomUUID(),
      name: adminName,
      email: adminEmail,
      password: await hashPassword(adminPassword),
      role: "admin",
      facultyStatus: "approved"
    });
    console.log(`Initial admin account created for ${adminEmail}.`);
  }
  if ((await Subject.estimatedDocumentCount()) === 0) {
    await Subject.insertMany(defaultSubjects.map((subject) => ({ ...subject, faculty: { name: subject.facultyName }, students: [], status: "Active", active: true })));
    console.log("Default subjects populated.");
  }
  app.listen(port, "0.0.0.0", () => console.log(`Digital Attendance app listening on port ${port}; Database ready.`));
} catch (error) {
  console.error("Initialization error:", error.message);
  app.listen(port, "0.0.0.0", () => console.log(`Digital Attendance app listening on port ${port}`));
}
