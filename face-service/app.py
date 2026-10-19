import hmac
import importlib.metadata
import logging
import os
import re
from threading import Lock
import time
import uuid

# Keep native CPU libraries from creating large default thread pools on the
# Render Free instance. These values are set before NumPy/OpenCV imports.
try:
    FACE_INFERENCE_THREADS = max(1, int(os.environ.get("FACE_INFERENCE_THREADS", "1")))
except ValueError as error:
    raise RuntimeError("FACE_INFERENCE_THREADS must be a positive integer.") from error

for thread_variable in (
    "OMP_NUM_THREADS",
    "OPENBLAS_NUM_THREADS",
    "MKL_NUM_THREADS",
    "NUMEXPR_NUM_THREADS",
):
    os.environ[thread_variable] = str(FACE_INFERENCE_THREADS)
os.environ.setdefault("OPENCV_IO_MAX_IMAGE_PIXELS", "20000000")

from fastapi import FastAPI, UploadFile, File, HTTPException, Form, Header, Depends, Request
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool
import cv2
import numpy as np

from services.face_detector import FaceDetector
from services.face_recognizer import FaceRecognizer
from services.embedding_compatibility import (
    is_embedding_compatible,
    make_embedding_model_id,
)

logger = logging.getLogger("face-service")
inference_lock = Lock()
SUPPORTED_FACE_MODELS = {"buffalo_l", "buffalo_sc"}
MAX_IMAGE_BYTES = 5 * 1024 * 1024
FACE_MODEL_NAME = os.environ.get("FACE_MODEL_NAME", "buffalo_l").strip()
if FACE_MODEL_NAME not in SUPPORTED_FACE_MODELS:
    raise RuntimeError(
        "FACE_MODEL_NAME must be one of: " + ", ".join(sorted(SUPPORTED_FACE_MODELS))
    )
FACE_MODEL_ID = make_embedding_model_id(
    FACE_MODEL_NAME,
    importlib.metadata.version("insightface"),
)


def safe_error_detail(error):
    detail = str(error)
    detail = re.sub(
        r"(?i)(token|secret|password|authorization)\s*[:=]\s*[^\s,;]+",
        r"\1=[redacted]",
        detail
    )
    return detail[:240]


def detect_faces_serially(image):
    # Keep the shared InsightFace model instance serialized across requests.
    with inference_lock:
        return detector.detect_faces(image)

app = FastAPI(
    title="Face Attendance AI Service",
    version="1.0.0"
)


@app.middleware("http")
async def log_face_request(request: Request, call_next):
    if request.url.path not in ("/enroll", "/recognize"):
        return await call_next(request)

    supplied_id = request.headers.get("x-request-id", "")
    request_id = supplied_id if re.fullmatch(r"[0-9a-fA-F-]{36}", supplied_id) else str(uuid.uuid4())
    request.state.request_id = request_id
    started_at = time.perf_counter()
    logger.info(
        "Face request received request_id=%s method=%s path=%s",
        request_id,
        request.method,
        request.url.path
    )

    try:
        response = await call_next(request)
    except Exception as error:
        logger.error(
            "Face request raised request_id=%s elapsed_ms=%d error_type=%s error_detail=%s",
            request_id,
            round((time.perf_counter() - started_at) * 1000),
            type(error).__name__,
            safe_error_detail(error)
        )
        raise

    response.headers["X-Request-ID"] = request_id
    logger.info(
        "Face request completed request_id=%s status=%d elapsed_ms=%d",
        request_id,
        response.status_code,
        round((time.perf_counter() - started_at) * 1000)
    )
    return response


def require_backend_token(x_face_service_token: str | None = Header(default=None)):
    expected_token = os.environ.get("FACE_SERVICE_TOKEN")
    if not expected_token:
        raise HTTPException(
            status_code=503,
            detail="Face service authentication is not configured."
        )
    if not x_face_service_token or not hmac.compare_digest(
        x_face_service_token,
        expected_token
    ):
        raise HTTPException(
            status_code=401,
            detail="Invalid face service credentials."
        )


# Load exactly one configured pack once. FaceDetector loads only detection and
# recognition modules, avoiding unused landmark and age/gender models.
logger.info("Initializing InsightFace model model_id=%s", FACE_MODEL_ID)
detector = FaceDetector(model_name=FACE_MODEL_NAME)
recognizer = FaceRecognizer()
logger.info("InsightFace model ready model_id=%s", FACE_MODEL_ID)


class StudentEmbedding(BaseModel):
    studentId: str
    embedding: list[float]


class RecognitionRequest(BaseModel):
    students: list[StudentEmbedding]


@app.get("/health")
def health_check():
    return {
        "status": "success",
        "message": "Face Recognition Service is running",
        "modelName": FACE_MODEL_NAME,
        "modelId": FACE_MODEL_ID,
    }


async def decode_uploaded_image(file: UploadFile, request_id: str):
    image_bytes = await file.read(MAX_IMAGE_BYTES + 1)
    if len(image_bytes) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image file must be 5 MB or smaller.")
    if not image_bytes:
        raise HTTPException(status_code=400, detail="Image file is empty.")

    image_array = np.frombuffer(image_bytes, dtype=np.uint8)
    try:
        image = cv2.imdecode(image_array, cv2.IMREAD_COLOR)
    except cv2.error as error:
        logger.info("Image decode rejected request_id=%s error_type=%s", request_id, type(error).__name__)
        raise HTTPException(status_code=400, detail="Invalid or oversized image file.") from error
    finally:
        del image_bytes
        del image_array

    if image is None:
        raise HTTPException(status_code=400, detail="Invalid image file.")
    return image


@app.post("/enroll", dependencies=[Depends(require_backend_token)])
async def enroll_face(request: Request, file: UploadFile = File(...)):
    request_id = request.state.request_id
    started_at = time.perf_counter()
    logger.info("Face enrollment processing started request_id=%s", request_id)

    image = await decode_uploaded_image(file, request_id)

    # Detect faces
    inference_started_at = time.perf_counter()
    logger.info("InsightFace inference started request_id=%s", request_id)
    try:
        faces = await run_in_threadpool(detect_faces_serially, image)
    except Exception as error:
        logger.error(
            "InsightFace inference failed request_id=%s elapsed_ms=%d error_type=%s error_detail=%s",
            request_id,
            round((time.perf_counter() - inference_started_at) * 1000),
            type(error).__name__,
            safe_error_detail(error)
        )
        raise HTTPException(
            status_code=500,
            detail="Face detection failed. Please try again with a clear photo."
        ) from error

    inference_elapsed_ms = round((time.perf_counter() - inference_started_at) * 1000)
    logger.info(
        "InsightFace inference completed request_id=%s elapsed_ms=%d face_count=%d",
        request_id,
        inference_elapsed_ms,
        len(faces)
    )

    # No face
    if len(faces) == 0:
        raise HTTPException(
            status_code=400,
            detail="No face detected in the image."
        )

    # More than one face
    if len(faces) > 1:
        raise HTTPException(
            status_code=400,
            detail=(
                "Multiple faces detected. "
                "Please upload a photo containing only one face."
            )
        )

    # Get 512-dimensional embedding
    embedding = faces[0].embedding

    logger.info(
        "Face enrollment processing completed request_id=%s elapsed_ms=%d embedding_length=%d",
        request_id,
        round((time.perf_counter() - started_at) * 1000),
        len(embedding)
    )
    del image

    return {
        "status": "success",
        "message": "Face enrolled successfully.",
        "modelName": FACE_MODEL_NAME,
        "modelId": FACE_MODEL_ID,
        "embedding": embedding.tolist()
    }


@app.post("/recognize", dependencies=[Depends(require_backend_token)])
async def recognize_faces(
    request: Request,
    file: UploadFile = File(...),
    students_json: str = Form(..., description="JSON string of enrolled students with their embeddings")
):
    request_id = request.state.request_id
    started_at = time.perf_counter()
    logger.info("Face recognition processing started request_id=%s", request_id)

    image = await decode_uploaded_image(file, request_id)

    # Parse enrolled students
    import json

    try:
        students_data = json.loads(students_json)
    except json.JSONDecodeError:
        raise HTTPException(
            status_code=400,
            detail="Invalid students data."
        )

    if not students_data:
        raise HTTPException(
            status_code=400,
            detail="No enrolled student embeddings provided."
        )

    compatible_students = [
        student for student in students_data
        if isinstance(student, dict)
        and is_embedding_compatible(student, FACE_MODEL_ID)
        and isinstance(student.get("embedding"), list)
        and len(student["embedding"]) == 512
    ]
    incompatible_count = len(students_data) - len(compatible_students)
    if not compatible_students:
        raise HTTPException(
            status_code=409,
            detail="No enrolled faces use the active recognition model. Students must re-enroll their face photos.",
        )
    if incompatible_count:
        logger.warning(
            "Incompatible face embeddings skipped request_id=%s count=%d active_model_id=%s",
            request_id,
            incompatible_count,
            FACE_MODEL_ID,
        )

    # Detect faces in group photo
    inference_started_at = time.perf_counter()
    logger.info("InsightFace inference started request_id=%s", request_id)
    faces = await run_in_threadpool(detect_faces_serially, image)
    logger.info(
        "InsightFace inference completed request_id=%s elapsed_ms=%d face_count=%d",
        request_id,
        round((time.perf_counter() - inference_started_at) * 1000),
        len(faces),
    )
    del image

    if len(faces) == 0:
        return {
            "status": "success",
            "message": "No faces detected.",
            "matches": [],
            "modelName": FACE_MODEL_NAME,
            "modelId": FACE_MODEL_ID,
            "incompatibleStudentCount": incompatible_count,
        }

    matches = []

    # Compare every detected face
    for face_index, face in enumerate(faces):

        detected_embedding = face.embedding

        best_match = None
        best_similarity = -1.0

        for student in compatible_students:

            student_id = student.get("studentId")
            enrolled_embedding = student.get("embedding")

            if not student_id or not enrolled_embedding:
                continue

            is_match, similarity = recognizer.is_match(
                detected_embedding,
                enrolled_embedding
            )

            if similarity > best_similarity:
                best_similarity = similarity
                best_match = {
                    "studentId": student_id,
                    "similarity": similarity,
                    "match": is_match
                }

        # Add only if a student was compared
        if best_match:
            matches.append({
                "faceIndex": face_index,
                "studentId": best_match["studentId"],
                "similarity": best_match["similarity"],
                "match": best_match["match"]
            })

    return {
        "status": "success",
        "message": "Face recognition completed.",
        "modelName": FACE_MODEL_NAME,
        "modelId": FACE_MODEL_ID,
        "facesDetected": len(faces),
        "matches": matches,
        "incompatibleStudentCount": incompatible_count,
        "elapsedMs": round((time.perf_counter() - started_at) * 1000),
    }
