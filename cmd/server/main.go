package main

import (
	"Tracker/internal/config"
	"Tracker/internal/domain"
	"Tracker/internal/handler"
	"Tracker/internal/repository"
	"Tracker/internal/seed"
	"Tracker/internal/service"
	"flag"
	"log"
	"net/http"
	"os"
	"strings"
)

func main() {
	migrateFlag := flag.Bool("migrate", false, "migrate database")
	seedFlag := flag.Bool("seed", false, "seed database")
	resetFlag := flag.Bool("reset", false, "reset database (drop tables, migrate, and seed)")
	flag.Parse()
	// Подключаемся к СУБД
	db, err := config.InitDB()
	if err != nil {
		log.Fatalf("Ошибка подключения к СУБД %v", err)
	}

	// Закрываем соединения при завершении работы сервера
	sqlDB, _ := db.DB()
	defer sqlDB.Close()

	// Применяем актуальные миграции (добавление новых колонок)
	if err := repository.Migrate(db); err != nil {
		log.Printf("Предупреждение при авто-миграции БД: %v", err)
	}

	// Автоматическое наполнение базы данных при первом запуске (если таблица пользователей пуста)
	var userCount int64
	if err := db.Model(&domain.User{}).Count(&userCount).Error; err == nil && userCount == 0 {
		log.Println("База данных пуста. Запуск первичного наполнения (seed)...")
		if err := seed.Seed(db); err != nil {
			log.Printf("Предупреждение при первичном сидировании: %v", err)
		} else {
			log.Println("Первичное наполнение БД успешно завершено")
		}
	}

	sseHub := service.NewSSEHub()
	pingerSvc := service.NewPingerService(db, sseHub)
	pingerSvc.Start()
	h := handler.NewHandler(db, pingerSvc, sseHub)
	router := h.InitRoutes()

	if *resetFlag {
		log.Println("Полный сброс БД (удаление таблиц и миграция)...")
		if err := repository.Reset(db); err != nil {
			log.Fatalf("Ошибка сброса БД: %v", err)
		}
		log.Println("Таблицы пересозданы. Запуск наполнения БД...")
		if err := seed.Seed(db); err != nil {
			log.Fatalf("Ошибка сидирования: %v", err)
		}
		log.Println("Сброс и сидирование БД успешно завершены!")
		return
	}
	if *migrateFlag {
		log.Println("Запуск миграции БД")
		if err := repository.Migrate(db); err != nil {
			log.Fatalf("Ошибка миграции БД: %v", err)
		}
		log.Println("Миграции успешно применены")
		return
	}
	if *seedFlag {
		log.Println("Запуск наполнения БД")
		if err := seed.Seed(db); err != nil {
			log.Fatalf("Ошибка сидирования: %v", err)
		}
		return
	}
	port := os.Getenv("PORT")
	if port == "" {
		port = "1111"
	}
	if !strings.HasPrefix(port, ":") {
		port = ":" + port
	}
	log.Printf("Сервер запущен на порту %s \n", port)
	// запускаем прослушивание входящих подключений
	// Если возникает ошибка, то log.Fatalf завершит программу
	if err := http.ListenAndServe(port, router); err != nil {
		log.Fatalf("Ошибка при запуске сервера: %v", err)
	}
}
