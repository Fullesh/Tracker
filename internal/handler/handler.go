package handler

import (
	"net/http"
	"os"

	"gorm.io/gorm"
)

type Handler struct {
	db *gorm.DB
}

func NewHandler(db *gorm.DB) *Handler {
	return &Handler{db: db}
}

func (h *Handler) InitRoutes() http.Handler {
	mux := http.NewServeMux()

	// Статика (CSS, JS)
	staticDir := "web/static"
	if _, err := os.Stat(staticDir); os.IsNotExist(err) {
		staticDir = "../../web/static/"
	}
	mux.Handle("/static/", http.StripPrefix("/static/", http.FileServer(http.Dir(staticDir))))

	// Служебный пинг
	mux.HandleFunc("/ping", h.Ping)

	// HTML-страницы
	mux.HandleFunc("/", h.Index)
	mux.HandleFunc("/constructor/", h.Constructor)

	// REST
	mux.HandleFunc("POST /api/floors/{id}/save/", h.SaveFloor)
	mux.HandleFunc("POST /api/floors/create/", h.CreateFloor)

	return mux
}
