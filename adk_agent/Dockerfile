FROM python:3.13-slim

WORKDIR /app

# Install dependencies first (layer cache)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy project files
COPY . .

# Ensure generated output directory exists
RUN mkdir -p generated

# Cloud Run default port
EXPOSE 8080

# FastAPI bridge server — serves the custom React frontend API
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8080"]
