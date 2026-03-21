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

# ADK API server — makes the agent available over HTTP
CMD ["adk", "api_server", "--port", "8080", "curiosity_agent"]
