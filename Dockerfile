# syntax=docker/dockerfile:1

# Этап 1: Сборка приложения
FROM golang:1.24-alpine AS builder

WORKDIR /build

# Системные зависимости для сборки
RUN apk add --no-cache ca-certificates tzdata

# Кэширование зависимостей Go
COPY go.mod go.sum ./
RUN go mod download

# Копирование исходного кода
COPY . .

# Компиляция статического бинарного файла для Linux
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /build/ptracker ./cmd/server/main.go

# Этап 2: Финальный легковесный образ
FROM alpine:3.21

WORKDIR /app

# Установка корневых сертификатов, часового пояса и iputils (ping для сервиса мониторинга)
RUN apk add --no-cache ca-certificates tzdata iputils

# Копирование бинарного файла из этапа сборки
COPY --from=builder /build/ptracker /app/ptracker

# Копирование статических файлов и шаблонов
COPY web /app/web

# Создание директории для пользовательских загрузок (скриншоты задач)
RUN mkdir -p /app/web/static/uploads/tasks && chmod -R 777 /app/web/static/uploads

# Порт веб-приложения
EXPOSE 1111

# Точка входа
ENTRYPOINT ["/app/ptracker"]
