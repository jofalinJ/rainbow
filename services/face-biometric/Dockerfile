FROM python:3.12.14-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 FACE_DATA_DIR=/data FACE_MODEL_DIR=/app/models
WORKDIR /app
RUN groupadd --gid 10001 faceworker && useradd --uid 10001 --gid 10001 --no-create-home faceworker
COPY requirements*.txt ./
# The official CPU index avoids installing CUDA libraries on Linux.
RUN pip install --no-cache-dir pip==26.2.1 \
    && pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch==2.14.1 \
    && pip install --no-cache-dir -r requirements.txt
COPY . .
RUN python download_models.py && mkdir -p /data && chown -R 10001:10001 /data /app/models
USER 10001:10001
EXPOSE 8080
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1", "--limit-concurrency", "16", "--no-access-log"]
