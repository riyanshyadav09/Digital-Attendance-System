# DIGITAL ATTENDANCE SYSTEM

Digital Attendance System is a final-year college project that combines a React web application, an Express and MongoDB backend, and an InsightFace-powered Python service. It supports attendance workflows for students, faculty, and administrators, including face enrollment, selfie verification, and group-photo recognition.

## Main Features

- Role-based student, faculty, and administrator workflows.
- Subject creation, enrollment, status management, and membership changes.
- Group-photo attendance with AI-assisted face matching.
- Student selfie attendance and face verification.
- Attendance review, approval, finalization, history, and records.
- Faculty approval and user administration.
- Password reset through email OTP.
- Campus geofencing support for relevant attendance flows.

## Role Features

### Students

- Register and sign in.
- View available subjects and join or leave subjects.
- Enroll a face image for recognition.
- Mark attendance with selfie verification.
- View attendance history and subject information.

### Faculty

- Create and manage subjects.
- View enrolled students and pending attendance.
- Submit group-photo attendance.
- Review, approve, reject, and finalize attendance.
- View attendance records and faculty profile information.

### Administrators

- View system settings and all users.
- Review and approve or reject faculty accounts.
- View faculty and attendance information.
- Access administrator-protected operations.

## AI Face Recognition Workflow

1. A student uploads a single-face image through the frontend.
2. The backend sends the image to the FastAPI `/enroll` endpoint.
3. InsightFace detects the face and generates an embedding stored with the student record.
4. For selfie or group attendance, the backend sends an image and enrolled embeddings to `/recognize`.
5. The AI service detects faces, compares embeddings, and returns student matches and similarity values.
6. The backend applies the attendance workflow and role, faculty-status, and location rules.

## Technology Stack

- Frontend: React 19, Vite, Axios, JavaScript.
- Backend: Node.js, Express, Mongoose, MongoDB, JWT, bcryptjs, Nodemailer.
- AI service: Python, FastAPI, OpenCV, NumPy, InsightFace, ONNX Runtime.
- API testing and documentation assets: Postman collections in `postman/`.

## Project Architecture

```text
client/       React and Vite browser application
server/       Express API, authentication, business logic, and models
face-service/ FastAPI face detection and recognition service
postman/      API collections, environments, flows, and specifications
```

The frontend calls the backend API. The backend owns authentication, authorization, MongoDB persistence, attendance rules, email OTP delivery, and communication with the AI service. The AI service performs image processing and embedding comparison.

## Backend and API Overview

The Express server runs on port `5000` by default and exposes:

- `/api/auth`: registration, login, password-reset OTP, OTP verification, and password reset.
- `/api/user`: profile access, faculty profile, administrator access, and student face enrollment.
- `/api/subjects`: subject creation, discovery, joining, leaving, status updates, and deletion.
- `/api/attendance`: attendance submission, group recognition, review, finalization, records, history, and selfie verification.
- `/api/admin`: settings, users, faculty listing, and faculty approval or rejection.

The FastAPI service runs on port `8000` by default and exposes `/health`, `/enroll`, and `/recognize`.

## Database Overview

MongoDB stores users, subjects, attendance records, roles, faculty status, and enrolled face embeddings through the Mongoose models in `server/models/`. Set `MONGO_URI` to a local or managed MongoDB database before starting the backend.

## Authentication and Security

- JWT tokens protect authenticated routes.
- Role middleware restricts student, faculty, and administrator operations.
- Passwords are hashed with bcryptjs.
- Password reset uses an email OTP workflow.
- CORS is restricted through `CLIENT_URL`.
- Secrets, SMTP credentials, and database URLs must be supplied through deployment secrets.
- Face and group images are uploaded to Cloudinary; MongoDB stores each asset's HTTPS `secure_url` in `User.facePhotoUrl` and `Attendance.groupPhotoUrl`.
- Do not place backend secrets in `VITE_*` variables because frontend variables are sent to the browser.

## Prerequisites

- Node.js 20 or newer and npm.
- Python 3.11 or a compatible version for the installed InsightFace and ONNX Runtime wheels.
- MongoDB running locally or a reachable MongoDB deployment.
- An SMTP account for password-reset email.
- A camera and browser geolocation permission for applicable attendance flows.

## Setup and Run

### Frontend

```powershell
cd client
npm install
Copy-Item .env.example .env
npm run dev
```

Set `VITE_API_BASE_URL` to the backend API URL, normally `http://localhost:5000/api`.

### Backend

```powershell
cd server
npm install
Copy-Item .env.example .env
npm start
```

Use `npm run dev` for automatic restart during development. Populate `server/.env` with the required local values before starting the API.

### Python AI Service

```powershell
cd face-service
python -m venv venv
.\venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8000
```

Start the AI service before using face enrollment or recognition. Its health check is available at `http://127.0.0.1:8000/health`.

## Required Environment Variables

Create local environment files from the examples. Never commit real values.

### Backend `server/.env`

- `PORT`
- `CLIENT_URL`
- `MONGO_URI`
- `JWT_SECRET`
- `FACE_SERVICE_URL`
- `FACE_SERVICE_TOKEN`
- `CAMPUS_LATITUDE`, `CAMPUS_LONGITUDE`, `CAMPUS_RADIUS`
- `BREVO_SMTP_HOST`, `BREVO_SMTP_PORT`, `BREVO_SMTP_USER`, `BREVO_SMTP_KEY`
- `BREVO_FROM_EMAIL`, `BREVO_FROM_NAME`
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`
- `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` when running the admin setup script

### Frontend `client/.env`

- `VITE_API_BASE_URL`

## Low-Cost Demo Deployment Audit

This is a low-traffic, 10-20-student demo plan for roughly 1-2 months. It is not an SLA-backed service. No cloud resource was created and no deployment was performed during this audit.

### Audit result and hosting comparison

| Component | Candidate | Cost/fit and important constraints |
|---|---|---|
| React/Vite | Vercel Hobby | $0 for personal, non-commercial use under its terms; static frontend only. |
| Express API | Render Free | $0 within the free allowance, but sleeps after 15 minutes idle, can take about a minute to wake, has ephemeral disk, 512 MB RAM, and blocks SMTP ports 25/465/587. Use Brevo port 2525 if permitted. |
| FastAPI + InsightFace | OCI Always Free Ampere A1 (conditional) | Up to 2 OCPUs and 12 GB RAM/month in the home region, enough RAM in principle for one `buffalo_sc` process. ARM/aarch64 compatibility for this pinned InsightFace/ONNX stack is **not yet verified**, free capacity is not guaranteed, and idle Always Free instances may be reclaimed. Validate the image on ARM and check account eligibility/capacity before choosing this. |
| MongoDB | Atlas M0 | $0; 0.5 GB storage, 100 operations/second, and 10 GB inbound/outbound transfer per rolling 7 days; cluster can pause after 30 days without connections. |
| Object storage | Existing Cloudinary Free | $0 within monthly 25-credit allowance. Current student face-photo delivery is public; see privacy blocker below. |
| Email | Existing Brevo Free | $0 within allowance; Render blocks standard SMTP ports, while Brevo documents port 2525 as an option. Test actual delivery from Render. |

**Recommendation:** First verify whether the existing AWS account can use the exact compute resources needed without upgrading. The displayed $100 credit and remaining 183 days do not prove EC2 eligibility or zero-charge access. AWS Free plan accounts have limited service access and credits may be consumed by eligible usage. Do not create a resource until the account console clearly marks it eligible and you understand its post-credit cost. Do not upgrade.

If AWS cannot be used without upgrade, OCI Always Free A1 is the only strong free CPU/RAM candidate found in this audit. Oracle documents 2 OCPUs/12 GB in the home region, but also warns of host-capacity shortages and possible reclaim of idle Always Free compute. OCI requires a payment card for signup in most regions, even though Always Free usage should not be charged; if no card or any billing risk is acceptable, no reliable hosted InsightFace option is currently verified. Render Free is below the demonstrated memory need, Hugging Face Docker Spaces require a paid plan, and Google Cloud Run requires billing with potential charges beyond the free allowance. A local computer you control with at least 8 GB RAM is a no-hosting-cost fallback, but it is not reliably available unless it remains online with secure public HTTPS access.

**Cost target:** $0/month is an estimate only if every provider stays within its free allowance, Vercel use is personal/non-commercial, no paid plan/domain is required, and neither OCI nor AWS requires an upgrade. Reserve no assumption that AWS credits pay for a particular service. The free compute candidate has capacity/availability limitations and there is no SLA.

### Model selection and compatibility audit

- `face-service/app.py` reads `FACE_MODEL_NAME`; `buffalo_l` and `buffalo_sc` are supported. Only the selected pack is loaded, CPU execution is used, and inference thread pools are constrained. The face-service example defaults to `buffalo_sc`.
- Enrollments are tagged with `User.faceEmbeddingModel`. Selfie and group recognition forward model markers, and the Python service filters out incompatible embeddings. Existing unmarked embeddings are treated as the known legacy `buffalo_l@insightface-0.7.3` implementation. Students with legacy embeddings must re-enroll before running with `buffalo_sc`; embeddings from another model ID are never compared.
- Compatibility tests exist and passed in the available local environment. They verify model-version boundaries, not face recognition accuracy or cloud memory consumption.
- `buffalo_sc` is a smaller edge pack and may be less accurate than `buffalo_l` for difficult poses, low resolution, lighting, or demographic variation. Do not loosen the match threshold arbitrarily. Calibrate using consented, ground-truth images before using records operationally.

### Current production blockers and security findings

- Student face photos are uploaded with Cloudinary `upload` delivery and are therefore public to anyone holding the URL. Profile APIs return a URL but do not return `faceEmbedding`; authentication middleware excludes embeddings from `req.user`. Do not collect real biometric data until the photo access policy, consent, retention, and deletion process are approved. Group-photo sessions use authenticated Cloudinary delivery with signed URLs; a signed link is still a bearer link.
- InsightFace pretrained model licensing is restricted to non-commercial research according to its model-zoo license. Confirm that your academic/demo use is permitted before deployment.
- OCI ARM is not yet validated for `onnxruntime`, InsightFace build dependencies, and OpenCV. A successful `linux/arm64` image build and live inference check are required before this becomes the deployment choice.
- Free hosts sleep, can cold-start slowly, and do not guarantee availability. Render-s 512 MB AI plan has already exceeded memory with `buffalo_l`; `buffalo_sc` has not been measured under that 512 MB limit.
- Group photo session save does not require FastAPI. Recognition remains a separate route. The recognition controller creates attendance records from verified matches, but its multi-record updates are not wrapped in a MongoDB transaction; a database failure partway through can leave partial records. Review that behavior before relying on large sessions.
- The old detector tests call `FaceDetector()` with no `model_name` and are stale after model configurability was introduced. The model compatibility tests are the currently relevant automated checks.

### Environment variable names (from source)

Use the checked-in examples as the exact source of names; they contain placeholders only. Never commit actual `.env` files.

- **Vercel/client:** `VITE_API_BASE_URL`.
- **Backend:** `NODE_ENV`, provider-supplied `PORT`, `CLIENT_URL`, `MONGO_URI`, `JWT_SECRET`, `FACE_SERVICE_URL`, `FACE_SERVICE_TOKEN`, `FACE_SERVICE_TIMEOUT_MS`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `CAMPUS_LATITUDE`, `CAMPUS_LONGITUDE`, `CAMPUS_RADIUS`, `BREVO_SMTP_HOST`, `BREVO_SMTP_PORT`, `BREVO_SMTP_USER`, `BREVO_SMTP_KEY`, `BREVO_FROM_EMAIL`, `BREVO_FROM_NAME`. `ADMIN_NAME`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` are needed only for the one-time admin creation command.
- **Face service:** `FACE_MODEL_NAME=buffalo_sc`, `FACE_INFERENCE_THREADS=1`, `FACE_SERVICE_TOKEN`, and provider-supplied `PORT`.

Never use `VITE_*` for credentials. Keep JWT, MongoDB, Cloudinary, Brevo, and face-service tokens in the owning server's secret store. The server validates required production variables and refuses local Mongo/face-service URLs and non-HTTPS client origins.

### Deployment preparation and checklist

No hosting-specific deployment file is checked in for Vercel, Render, or AWS. `face-service/Dockerfile` is a generic ARM-capable build context, but ARM package compatibility is unverified. Before any cloud setup:

1. Check the AWS account console for explicit no-upgrade access to the exact compute service and inspect its post-credit price. If ambiguous, do not create resources.
2. If considering OCI, confirm A1 Always Free quota and home-region capacity. Build and run the face service on actual ARM64 with `FACE_MODEL_NAME=buffalo_sc`; verify `/health`, single-face `/enroll`, and a group-photo `/recognize`. Do not move forward on an x86-only build result.
3. Use isolated least-privilege Atlas credentials, TLS, and narrow network access if possible. Render Free has no stable dedicated outbound IP; avoid broad database access unless you explicitly accept the exposure and have a strong unique password plus removal date.
4. Set backend `NODE_ENV=production`, `CLIENT_URL` to the exact frontend HTTPS origin, and `FACE_SERVICE_URL` to the private or HTTPS base URL. Share a newly generated 32+ character `FACE_SERVICE_TOKEN` between API and AI service. Render provides `PORT`; the app binds to `0.0.0.0`.
5. In Vercel set `VITE_API_BASE_URL=https://<backend-host>/api`; build command `npm run build`, output `dist`, root `client`. In Render backend set root `server`, build `npm ci`, start `npm start`, health path `/health`. Do not deploy the AI service on Render Free 512 MB.
6. Render Free blocks SMTP ports 25/465/587. Set `BREVO_SMTP_PORT=2525` only after confirming its SMTP configuration and test a password-reset email.
7. Resolve the public face-photo issue, consent, retention, and deletion policy before enrolling actual students. Verify profile APIs never expose embeddings, and test enrollment, group recognition, review, and image deletion with consenting test users.
8. Monitor MongoDB storage/transfer, Cloudinary credits, mail quotas, compute health and memory. Keep enrollment/recognition logs free of secrets and image bytes.

### Recognition, memory, and accuracy test procedure

Use only consented images and a disposable subject. This repository does not include representative face data. For local/container memory measurements (Docker required), use a Linux/ARM64 host for the OCI candidate and set `FACE_SERVICE_TOKEN` in the shell, not in command history or an image build argument:

```powershell
docker build --platform linux/arm64 -t das-face-service ./face-service
docker run -d --name das-face-service --memory=8g --cpus=2 -p 8000:7860 `
  -e PORT=7860 -e FACE_MODEL_NAME=buffalo_sc -e FACE_INFERENCE_THREADS=1 `
  -e FACE_SERVICE_TOKEN=$env:FACE_SERVICE_TOKEN das-face-service
curl.exe -sS http://localhost:8000/health
docker stats das-face-service
```

`--platform linux/arm64` on an x86 machine can use emulation and is not a dependable performance/memory test. Prefer actual A1 hardware. Record cold-start peak, one enrollment, and recognition using the largest allowed 5 MB group image. Memory cannot be concluded from a build or health check alone.

For a real accuracy measurement, enroll the consented students with the selected model, create group photos with a ground-truth list of visible IDs, run through the authenticated `/api/attendance/recognize-group` endpoint on a disposable subject, and compare actual IDs: precision = TP/(TP+FP), recall = TP/(TP+FN). Include clear frontal faces, varying distances, indoor lighting, and group sizes up to 20. Never treat a successful API response as proof that the recognition is accurate.

### Provider setup values

- **Vercel:** root `client`; build `npm run build`; output `dist`; `VITE_API_BASE_URL=https://<backend-origin>/api`.
- **Render backend:** root `server`; build `npm ci`; start `npm start`; health `/health`; free plan only for API if its latency/sleep behavior is acceptable; set the environment names listed above.
- **AI service:** prefer a verified eligible no-cost compute account with enough memory. If OCI A1 is used, use 1-2 OCPUs and up to 12 GB total memory in the home region, keep the machine within Always Free quotas, configure HTTPS/reverse proxy and firewall, and check utilization so idle-resource reclaim conditions do not hold for seven days. The model container binds to `0.0.0.0:$PORT`; expose only HTTPS publicly and keep the token secret. Do not assume AWS is eligible from credits alone.

### Shutdown after 1-2 months

1. Export only permitted demo records, then delete demo users, subjects, attendance, and face embeddings from MongoDB. Delete the cluster/database user and remove network access entries if the database is no longer needed.
2. Terminate the OCI instance (or the explicitly approved AWS resource) and delete its boot/block volumes, public IP, reserved IPs, snapshots, backups, networking, firewall rules, and any other billable attachments. Verify the provider billing console is at zero active resources. Stopping compute may leave storage resources behind.
3. Delete the Render backend and Vercel project/deployments.
4. Delete face and group assets from Cloudinary, including legacy public photos; revoke the Cloudinary API key if it was demo-only.
5. Revoke Brevo SMTP credentials, rotate `JWT_SECRET` and `FACE_SERVICE_TOKEN`, and remove demo secrets from provider settings.
6. If migrating an existing local deployment, run `npm run migrate-uploads` from `server/` while the local files still exist and with the MongoDB/Cloudinary environment variables set. Missing local files cannot be recovered by the migration script.

For an approximate monthly estimate: Vercel Hobby $0; Render Free backend $0; Atlas M0 $0 within limits; Cloudinary $0 within 25 credits; Brevo $0 within limits; OCI A1 $0 only within Always Free quota and availability; AWS compute excluded until the account explicitly confirms eligibility. This is a plan estimate, not a guarantee against provider policy, billing, or quota changes.

## Project Context

This system was developed as a final-year college project to demonstrate full-stack application development, role-based access control, database-backed workflows, email-based account recovery, geolocation checks, and applied AI face recognition for attendance management.
