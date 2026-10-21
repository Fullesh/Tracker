package main

import (
	"fmt"
	"log"
	"net/http"

	"PTracker/internal/config"
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
	// Подключаемся к СУБД
	db, err := config.InitDB()
	if err != nil {
		log.Fatalf("Ошибка подключения к СУБД %v", err)
	}

	// Закрываем соединения при завершении работы сервера
	sqlDB, _ := db.DB()
	defer sqlDB.Close()

	port := ":1111"
	// Привязываем URL "/ping" к обработчику
	http.HandleFunc("/ping", pingHandler)
	// Root сайта
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintln(w, "Добро пожаловать")
	})
	log.Printf("Сервер запущен на порту %s \n", port)
	// запускаем прослушивание входящих подключений
	// Если возникает ошибка, то log.Fatal завершит программу
	if err := http.ListenAndServe(port, nil); err != nil {
		log.Fatalf("Ошибка при запуске сервера: %v", err)
	}
}
