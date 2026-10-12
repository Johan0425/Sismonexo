FROM python:3.14-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY api/app ./api/app
# Los datos se montan como volúmenes de solo lectura (ver docker-compose.yml).
ENV SISMONEXO_DATA_DIR=/srv/data/processed SISMONEXO_WEB_DATA_DIR=/srv/web-data
RUN useradd --system --no-create-home sismonexo
USER sismonexo
WORKDIR /srv/api
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health')"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
