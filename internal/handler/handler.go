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

	//REST WORKDAY
	mux.HandleFunc("GET /api/workday/status/{$}", h.GetWorkdayStatus)
	mux.HandleFunc("POST /api/workday/start/{$}", h.StartWorkday)
	mux.HandleFunc("POST /api/workday/pause/{$}", h.TogglePauseWorkday)
	mux.HandleFunc("POST /api/workday/finish/{$}", h.FinishWorkday)

	//REST INVENTORY
	mux.HandleFunc("GET /api/inventory/{$}", h.RequireMTOOrAdmin(h.GetInventory))
	mux.HandleFunc("POST /api/inventory/create/{$}", h.RequireMTOOrAdmin(h.CreateInventoryItem))
	mux.HandleFunc("POST /api/inventory/{id}/update/{$}", h.RequireMTOOrAdmin(h.UpdateInventoryItem))
	mux.HandleFunc("POST /api/inventory/{id}/delete/{$}", h.RequireMTOOrAdmin(h.DeleteInventoryItem))

	return mux
}
