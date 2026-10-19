import os

from insightface.app import FaceAnalysis
import onnxruntime


class FaceDetector:
    def __init__(self, model_name):
        # Keep ONNX Runtime's CPU thread pools small on memory-constrained hosts.
        session_options = onnxruntime.SessionOptions()
        inference_threads = max(1, int(os.environ.get("FACE_INFERENCE_THREADS", "1")))
        session_options.intra_op_num_threads = inference_threads
        session_options.inter_op_num_threads = 1
        session_options.execution_mode = onnxruntime.ExecutionMode.ORT_SEQUENTIAL

        self.app = FaceAnalysis(
            name=model_name,
            providers=["CPUExecutionProvider"],
            allowed_modules=["detection", "recognition"],
            sess_options=session_options
        )

        self.app.prepare(
            ctx_id=-1,
            det_size=(640, 640)
        )

    def detect_faces(self, image):
        faces = self.app.get(image)

        return faces
