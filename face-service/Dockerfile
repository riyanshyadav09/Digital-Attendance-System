FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=7860 \
    FACE_MODEL_NAME=buffalo_sc \
    FACE_INFERENCE_THREADS=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# InsightFace 0.7.3 builds its Python package from source; ONNX Runtime needs
# libgomp at runtime. Keep the builder tools out of the final image layer.
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./requirements.txt
RUN python -m pip install --upgrade pip setuptools wheel Cython \
    && python -m pip install -r requirements.txt

COPY app.py ./app.py
COPY services ./services

EXPOSE 7860
CMD ["sh", "-c", "exec uvicorn app:app --host 0.0.0.0 --port ${PORT:-7860} --workers 1"]
