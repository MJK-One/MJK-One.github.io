---
title: "멀티 스테이지 빌드로 Spring Boot Docker 이미지 경량화하기"
description: "멀티 스테이지 Docker 빌드로 이미지 크기를 500MB에서 150MB로 줄이는 실전 가이드"
pubDate: 2026-02-14
category: "devops"
tags: ["Docker", "Spring Boot", "Java", "GitHub Actions"]
---

## 왜 멀티 스테이지 빌드인가?

단순히 `FROM openjdk:17`로 시작하면 전체 JDK가 프로덕션 이미지에 포함됩니다. 불필요하고 무겁습니다. 멀티 스테이지 빌드를 사용하면 빌드는 JDK로, 실행은 JRE만 있는 가벼운 이미지로 분리할 수 있습니다. 결과적으로 이미지 크기가 500MB에서 150MB 수준으로 줄어듭니다.

## Dockerfile

```dockerfile
# Stage 1: 빌드
FROM gradle:8.5-jdk17-alpine AS builder
WORKDIR /app
COPY build.gradle settings.gradle ./
COPY gradle ./gradle
# 의존성 먼저 캐싱
RUN gradle dependencies --no-daemon || true
COPY src ./src
RUN gradle bootJar --no-daemon -x test

# Stage 2: 실행
FROM eclipse-temurin:17-jre-alpine
WORKDIR /app

# 보안을 위해 non-root 유저 생성
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

COPY --from=builder /app/build/libs/*.jar app.jar

EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
```

## 로컬 개발용 docker-compose

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
- name: Docker 이미지 빌드 및 푸시
  uses: docker/build-push-action@v5
  with:
    context: .
    push: true
    tags: ${{ secrets.DOCKERHUB_USERNAME }}/myapp:latest
    cache-from: type=gha
    cache-to: type=gha,mode=max
```

`cache-from: type=gha` 설정이 핵심입니다. GitHub Actions에서 Docker 레이어를 캐싱해서 이후 빌드 시간이 3분에서 45초 이하로 줄어듭니다.

## 팁 정리

- 이미지 버전은 반드시 명시하세요 (`:17-alpine`, `:latest` 금지). 재현 가능성이 중요합니다.
- `.dockerignore`에 `build/`, `.git/`, `*.md` 등을 추가하면 Docker 컨텍스트 전송 시간을 줄일 수 있습니다.
- non-root 유저 설정은 간단하지만 많은 분들이 빠뜨리는 보안 강화 포인트입니다. 꼭 넣으세요.
