# Servicio de transcripción de DrumStudio para Hugging Face Spaces (SDK Docker, CPU).
FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends libsndfile1 && rm -rf /var/lib/apt/lists/*

# Hugging Face ejecuta el contenedor con el usuario 1000.
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user PATH=/home/user/.local/bin:$PATH \
    DRUMSTUDIO_DATA=/tmp/drumstudio \
    TORCH_HOME=/home/user/.cache/torch \
    PYTHONUNBUFFERED=1 \
    ALLOWED_ORIGINS=https://jessaran.github.io,http://localhost:5173
WORKDIR /home/user/app

COPY --chown=user requirements.txt requirements-separation.txt ./
# PyTorch solo CPU (mucho más ligero que la versión con CUDA).
RUN pip install --no-cache-dir --user torch==2.8.0 torchaudio==2.8.0 --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir --user -r requirements.txt -r requirements-separation.txt

# Descarga el modelo htdemucs al construir, para no hacerlo en la primera petición.
RUN python -c "from demucs.pretrained import get_model; get_model('htdemucs')"

COPY --chown=user app ./app

EXPOSE 7860
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "7860"]
