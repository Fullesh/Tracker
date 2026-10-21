package main

import (
	"PTracker/internal/config"
	"PTracker/internal/domain"
	"PTracker/internal/repository"
	"PTracker/internal/seed"
	"encoding/json"
	"flag"
	"fmt"
	"html/template"
	"log"
	"net/http"
	"os"
)

// handler - обработчик
//w - Response HTTP
//r - Request HTTP

func pingHandler(w http.ResponseWriter, r *http.Request) {
	//Устанавливаем заголовок
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	// Отправляем HTTP 200
	w.WriteHeader(http.StatusOK)
	// Пишем тело ответа
	fmt.Fprintln(w, `{"status": "ok", "app": "PTracker Go", "message": "server: healthy", "db": "healthy"}`)
}

func main() {
	migrateFlag := flag.Bool("migrate", false, "migrate database")
	seedFlag := flag.Bool("seed", false, "seed database")
	flag.Parse()
	// Подключаемся к СУБД
	db, err := config.InitDB()
	if err != nil {
		log.Fatalf("Ошибка подключения к СУБД %v", err)
	}

	// Закрываем соединения при завершении работы сервера
	sqlDB, _ := db.DB()
	defer sqlDB.Close()

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
	// Привяываем статические файлы (CSS, JS)
	staticDir := "web/static"
	if _, err := os.Stat(staticDir); os.IsNotExist(err) {
		staticDir = "../../web/static"
	}
	http.Handle("/static/", http.StripPrefix("/static/", http.FileServer(http.Dir(staticDir))))
	// Привязываем URL "/ping" к обработчику
	http.HandleFunc("/ping", pingHandler)
	// Root сайта
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		var floors []domain.Floor
		var employees []domain.Employee
		db.Preload("Walls").Preload("Labels").Preload("Workplaces").Find(&floors)
		db.Find(&employees)
		configData := map[string]any{"floors": floors, "employees": employees}
		configBytes, _ := json.Marshal(configData)
		tmpl, _ := template.ParseFiles("web/templates/index.html")
		data := map[string]any{"TrackerConfigJSON": template.JS(configBytes)}
		tmpl.Execute(w, data)
	})
	log.Printf("Сервер запущен на порту %s \n", port)
	// запускаем прослушивание входящих подключений
	// Если возникает ошибка, то log.Fatal завершит программу
	if err := http.ListenAndServe(port, nil); err != nil {
		log.Fatalf("Ошибка при запуске сервера: %v", err)
	}
}
