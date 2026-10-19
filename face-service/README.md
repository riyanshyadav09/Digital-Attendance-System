# Face service container

This is a generic Docker build context for the FastAPI/InsightFace service. It is not tied to a specific cloud provider. The image loads one CPU model pack (`buffalo_sc` by default), starts one Uvicorn worker, and binds to `0.0.0.0:$PORT`.

## Configuration

Set these variables in the runtime secret/configuration store:

- `FACE_MODEL_NAME=buffalo_sc`
- `FACE_INFERENCE_THREADS=1`
- `FACE_SERVICE_TOKEN`: high-entropy token shared with the Express backend; never bake it into the image or pass it as a Docker build argument.
- `PORT`: supplied by the hosting provider. The image defaults to `7860`; OCI can set `8000` if desired.

`GET /health` reports the configured model ID. `POST /enroll` and `POST /recognize` require the `X-Face-Service-Token` header.

## Build and local runtime check

```sh
docker build -t das-face-service ./face-service
docker run --rm -p 8000:7860 -e PORT=7860 -e FACE_MODEL_NAME=buffalo_sc \
  -e FACE_INFERENCE_THREADS=1 -e FACE_SERVICE_TOKEN="$FACE_SERVICE_TOKEN" \
  das-face-service
```

For an OCI Ampere A1 deployment, test the actual ARM64 image and all three endpoints on an ARM64 host before relying on the service. A successful build on x86, including emulated ARM builds, does not prove ARM package support, runtime compatibility, memory use, or recognition quality. The repository has not been verified on OCI A1.
