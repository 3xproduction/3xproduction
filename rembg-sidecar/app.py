"""rembg micro-service для удаления фона.

Endpoint POST /remove-bg принимает multipart файл `photo` и опциональный
form-field `model` (`isnet-general-use` (default), `u2net`, `silueta`).
Возвращает JPEG с белым фоном. Защищён form-field `secret`.

Поддерживаемые модели pre-loaded'ятся при старте — словарь _SESSIONS.
Если запрошен неизвестный model — fallback на `isnet-general-use`.

Deploy: Yandex Serverless Container, образ ~660 МБ
(Python + ONNX + 3 модели). Cold-start ~10-15с, warm ~1-3с/фото.
"""
import io
import os
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from PIL import Image, ImageOps
from rembg import remove, new_session

# Pre-load всех поддерживаемых моделей при старте — чтобы первое фото на любую
# из них не платило 5-10с за загрузку ONNX. Если какая-то модель не загрузилась
# (нет онкс-файла в /app/models, нет интернета) — её просто нет в словаре.
SUPPORTED_MODELS = ("isnet-general-use", "u2net", "silueta")
DEFAULT_MODEL = "isnet-general-use"

_SESSIONS = {}
for _name in SUPPORTED_MODELS:
    try:
        _SESSIONS[_name] = new_session(_name)
        print(f"[startup] loaded model: {_name}")
    except Exception as e:  # noqa: BLE001
        print(f"[startup] FAILED to load {_name}: {e}")

if DEFAULT_MODEL not in _SESSIONS:
    raise RuntimeError(f"Default model {DEFAULT_MODEL} failed to load — refusing to start")

# Секрет для бэкенда — без него endpoint 401. Yandex SC `allow-unauthenticated`
# нужен (мы ходим без IAM-токена), но фактический gate — наш form-field.
_SECRET = os.environ.get("INTERNAL_SECRET", "")

app = FastAPI(title="rembg-sidecar", version="1.8")


@app.get("/health")
def health():
    return {
        "ok": True,
        "default_model": DEFAULT_MODEL,
        "loaded_models": list(_SESSIONS.keys()),
    }


@app.get("/warm")
def warm():
    """Лёгкий ping для прогрева. Backend keep-alive дёргает раз в 4 минуты,
    фронт — при открытии модалки добавления, чтобы к моменту submit'а
    sidecar был warm (cold-start с ~15с до <300мс)."""
    return {"ok": True, "default_model": DEFAULT_MODEL, "warm": True}


@app.post("/remove-bg")
async def remove_bg(
    photo: UploadFile = File(...),
    secret: str = Form(""),
    model: str = Form(""),
):
    # YC Serverless Container иногда режет custom X-*-headers до контейнера.
    # Секрет шлём form-field'ом — гарантированно проходит.
    if _SECRET and secret != _SECRET:
        raise HTTPException(status_code=401, detail="bad_secret")

    raw = await photo.read()
    if not raw:
        raise HTTPException(status_code=400, detail="empty_photo")
    if len(raw) > 20 * 1024 * 1024:  # 20MB лимит
        raise HTTPException(status_code=413, detail="too_large")

    try:
        img = Image.open(io.BytesIO(raw))
        img.load()
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"bad_image: {e}")

    # Авто-поворот по EXIF (rembg сам не делает)
    try:
        img = ImageOps.exif_transpose(img)
    except Exception:  # noqa: BLE001
        pass

    # Выбор модели. Неизвестные/пустые — на default. Возвращаем фактически
    # использованную модель в `X-Bg-Model-Used` header — фронту видно через
    # DevTools какая модель отработала.
    requested_model = (model or "").strip() or DEFAULT_MODEL
    session = _SESSIONS.get(requested_model) or _SESSIONS[DEFAULT_MODEL]
    used_model = requested_model if requested_model in _SESSIONS else DEFAULT_MODEL

    cutout = remove(img, session=session)

    # Composite на белый фон → JPEG q90.
    if cutout.mode == "RGBA":
        bg = Image.new("RGB", cutout.size, (255, 255, 255))
        bg.paste(cutout, mask=cutout.split()[3])
    else:
        bg = cutout.convert("RGB")

    out = io.BytesIO()
    bg.save(out, format="JPEG", quality=90, optimize=True)
    out.seek(0)
    return Response(
        content=out.getvalue(),
        media_type="image/jpeg",
        headers={"X-Bg-Model-Used": used_model},
    )
