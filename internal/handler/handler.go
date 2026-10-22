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

	// REST FLOORS
	mux.HandleFunc("POST /api/floors/{id}/save/{$}", h.RequireAdmin(h.SaveFloor))
	mux.HandleFunc("POST /api/floors/create/{$}", h.RequireAdmin(h.CreateFloor))
	mux.HandleFunc("POST /api/floors/{id}/delete/{$}", h.RequireAdmin(h.DeleteFloor))

	//REST USERS
	mux.HandleFunc("GET /api/employees/{$}", h.GetEmployees)
	mux.HandleFunc("POST /api/employees/create/{$}", h.RequireAdmin(h.CreateEmployee))
	mux.HandleFunc("POST /api/employees/{id}/update/{$}", h.RequireAdmin(h.UpdateEmployee))
	mux.HandleFunc("POST /api/auth/login/{$}", h.Login)
	mux.HandleFunc("POST /api/auth/logout/{$}", h.Logout)

	//REST TASKS
	mux.HandleFunc("POST /api/tasks/create/{$}", h.CreateTask)
	mux.HandleFunc("POST /api/tasks/{id}/update/{$}", h.UpdateTask)
	mux.HandleFunc("POST /api/tasks/{id}/delete/{$}", h.DeleteTask)

	return mux
}
