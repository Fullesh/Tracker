package main

import (
	"PTracker/internal/config"
	"PTracker/internal/handler"
	"PTracker/internal/repository"
	"PTracker/internal/seed"
	"flag"
	"log"
	"net/http"
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

	h := handler.NewHandler(db)
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
	port := ":1111"
	log.Printf("Сервер запущен на порту %s \n", port)
	// запускаем прослушивание входящих подключений
	// Если возникает ошибка, то log.Fatalf завершит программу
	if err := http.ListenAndServe(port, router); err != nil {
		log.Fatalf("Ошибка при запуске сервера: %v", err)
	}
}
