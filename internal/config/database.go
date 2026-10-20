package config

import (
	"context"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// DB содержит пул соединений с базой данных
type DB struct {
	Pool *pgxpool.Pool
}

// NewDBPool инициализирует и возвращает новый пул соединений
func NewDBPool(ctx context.Context) (*DB, error) {
	// Собираем строку подключения (DSN) из переменных окружения
	// Пример формата: postgres://username:password@localhost:5432/database_name?sslmode=disable
	dsn := fmt.Sprintf("postgres://%s:%s@%s:%s/%s?sslmode=%s",
		getEnv("DB_USER", "postgres"),
		getEnv("DB_PASSWORD", "password"),
		getEnv("DB_HOST", "localhost"),
		getEnv("DB_PORT", "5432"),
		getEnv("DB_NAME", "my_db"),
		getEnv("DB_SSLMODE", "disable"),
	)

	// Создаем базовую конфигурацию из строки DSN
	config, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("не удалось распарсить строку подключения: %w", err)
	}

	// Кастомизация настроек пула соединений
	config.MaxConns = 25                      // Максимальное количество открытых соединений
	config.MinConns = 5                       // Минимальное количество удерживаемых соединений
	config.MaxConnLifetime = 30 * time.Minute // Максимальное время жизни одного соединения
	config.MaxConnIdleTime = 15 * time.Minute // Время, через которое простаивающее соединение закроется

	// Создаем пул соединений
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, fmt.Errorf("не удалось создать пул соединений: %w", err)
	}

	// Проверяем подключение с помощью Ping
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("база данных недоступна: %w", err)
	}

	log.Println("Успешное подключение к PostgreSQL")
	return &DB{Pool: pool}, nil
}

// Close безопасно закрывает пул соединений
func (db *DB) Close() {
	if db.Pool != nil {
		db.Pool.Close()
		log.Println("Подключение к PostgreSQL успешно закрыто")
	}
}

// Вспомогательная функция для получения переменных окружения с дефолтным значением
func getEnv(key, defaultValue string) string {
	if value, exists := os.LookupEnv(key); exists {
		return value
	}
	return defaultValue
}
