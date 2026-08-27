FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    OLFARIA_HOST=0.0.0.0 \
    PORT=8000

WORKDIR /olfaria

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
WORKDIR /olfaria/app

EXPOSE 8000

CMD ["python", "olfaria_api.py"]
