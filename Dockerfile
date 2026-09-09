FROM python:3.12-alpine
WORKDIR /app
COPY server.py network_check.py gateway.py ./
COPY tor/reader.py ./reader.py
COPY dist ./dist
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 BIND_ADDRESS=0.0.0.0
USER 10001:10001
EXPOSE 8787
CMD ["python", "server.py"]
