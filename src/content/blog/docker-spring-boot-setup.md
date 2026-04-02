---
title: "Dockerizing a Spring Boot App with Multi-Stage Builds"
description: "A practical guide to containerizing Spring Boot with a slim production image using multi-stage Docker builds."
pubDate: 2026-02-14
category: "devops"
tags: ["Docker", "Spring Boot", "DevOps", "Java"]
---

## Why Bother with Multi-Stage Builds?

A naive `FROM openjdk:17` image ships your entire JDK into production — bloated and unnecessary. Multi-stage builds let you compile with a full JDK and run with a lean JRE. The result: images that drop from ~500MB to ~150MB.

## The Dockerfile

```dockerfile
# Stage 1: Build
FROM gradle:8.5-jdk17-alpine AS builder
WORKDIR /app
COPY build.gradle settings.gradle ./
COPY gradle ./gradle
# Cache dependencies first
RUN gradle dependencies --no-daemon || true
COPY src ./src
RUN gradle bootJar --no-daemon -x test

# Stage 2: Run
FROM eclipse-temurin:17-jre-alpine
WORKDIR /app

# Non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

COPY --from=builder /app/build/libs/*.jar app.jar

EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
```

## docker-compose for Local Dev

```yaml
version: '3.8'

services:
  app:
    build: .
    ports:
      - "8080:8080"
    environment:
      SPRING_DATASOURCE_URL: jdbc:postgresql://db:5432/mydb
      SPRING_DATASOURCE_USERNAME: postgres
      SPRING_DATASOURCE_PASSWORD: password
      SPRING_REDIS_HOST: redis
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_started

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: mydb
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: password
    volumes:
      - pg_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

volumes:
  pg_data:
```

## GitHub Actions CI/CD

```yaml
- name: Build and push Docker image
  uses: docker/build-push-action@v5
  with:
    context: .
    push: true
    tags: ${{ secrets.DOCKERHUB_USERNAME }}/myapp:latest
    cache-from: type=gha
    cache-to: type=gha,mode=max
```

The `cache-from: type=gha` line is crucial — it caches Docker layers in GitHub Actions, cutting build times from ~3 minutes to under 45 seconds on subsequent runs.

## Tips

- Always specify exact image versions (`:17-alpine`, not `:latest`) for reproducibility
- Use `.dockerignore` to exclude `build/`, `.git/`, `*.md` — shaves time off the Docker context transfer
- The non-root user (`appuser`) is a simple security hardening step most people skip; don't skip it
