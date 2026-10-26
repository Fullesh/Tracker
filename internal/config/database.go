package config

import (
	"fmt"
	"log"
	"os"
	"time"

	"github.com/joho/godotenv"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// InitDB загружает переменные из .env и подключается к PSQL через GORM
func InitDB() (*gorm.DB, error) {
	// Загружаем переменные из .env при наличии
	if err := godotenv.Load(".env"); err != nil {
		log.Println("Файл .env не найден")
	}
	// Собираем строку подключения
	dsn := fmt.Sprintf(
		"host=%s user=%s password=%s dbname=%s port=%s sslmode=%s TimeZone=Europe/Moscow",
		getEnv("DB_HOST", "localhost"),
		getEnv("DB_USER", "postgres"),
		getEnv("DB_PASSWORD", "root"),
		getEnv("DB_NAME", "config"),
		getEnv("DB_PORT", "5432"),
		getEnv("DB_SSLMODE", "disable"),
	)

	// Открываем соединение через GORM
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Info),
	})
	if err != nil {
		return nil, fmt.Errorf("Не удалось подключиться к БД: %w", err)
	}

	// Настраиваем пул соединений PostgreSQL
	sqlDB, err := db.DB()
	if err != nil {
		return nil, fmt.Errorf("Ошибка получения пула базы: %w", err)
	}

	sqlDB.SetMaxOpenConns(60)                  // Максимум одновременных подключений
	sqlDB.SetMaxIdleConns(5)                   // Держать готовым в простое
	sqlDB.SetConnMaxLifetime(30 * time.Minute) // Время жизни подключения

	log.Println("Выполнено подключение к БД")
	return db, nil
}

func getEnv(key, defaultValue string) string {
	if value, exists := os.LookupEnv(key); exists && value != "" {
		return value
	}
	return defaultValue
}
