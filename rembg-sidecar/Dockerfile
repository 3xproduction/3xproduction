FROM python:3.11-slim

WORKDIR /app

# Системные зависимости для Pillow / OpenCV / onnxruntime
RUN apt-get update && \
    apt-get install -y --no-install-recommends libgl1 libglib2.0-0 ca-certificates && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download трёх моделей в образ — иначе на первом запросе rembg качает с
# github (заблокирован у YC NAT-Gateway отдельно от нашего CF-прокси).
# - isnet-general-use ~170MB — дефолт, общая модель
# - u2net ~170MB — стандартная rembg, часто лучше на «свет на свет»
# - silueta ~4MB — лёгкая, заточена под предметы
ENV U2NET_HOME=/app/models
RUN mkdir -p /app/models && \
    python -c "from rembg import new_session; \
new_session('isnet-general-use'); \
new_session('u2net'); \
new_session('silueta')"

COPY app.py .

ENV PORT=8080
EXPOSE 8080

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080"]
