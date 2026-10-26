package handler

import (
	"PTracker/internal/service"
	"net/http"
	"os"

	"gorm.io/gorm"
)

type Handler struct {
	db     *gorm.DB
	pinger *service.PingerService
	sse    *service.SSEHub
}

func NewHandler(db *gorm.DB, pinger *service.PingerService, sse *service.SSEHub) *Handler {
	return &Handler{db: db, pinger: pinger, sse: sse}
}

func (h *Handler) InitRoutes() http.Handler {
	mux := http.NewServeMux()

	// Статика (CSS, JS)
	staticDir := "web/static"
	if _, err := os.Stat(staticDir); os.IsNotExist(err) {
		staticDir = "../../web/static/"
	}
	mux.Handle("/static/", http.StripPrefix("/static/", http.FileServer(http.Dir(staticDir))))
	mux.Handle("/media/", http.StripPrefix("/media/", http.FileServer(http.Dir(staticDir+"/uploads"))))

	// Служебный пинг
	mux.HandleFunc("/ping", h.Ping)

	// HTML-страницы
	mux.HandleFunc("GET /login/{$}", h.LoginPage)
	mux.HandleFunc("GET /login", h.LoginPage)
	mux.HandleFunc("/", h.Index)
	mux.HandleFunc("/constructor/", h.RequireAuth(h.Constructor))

	// REST FLOORS
	mux.HandleFunc("POST /api/floors/{id}/save/{$}", h.RequireAdmin(h.SaveFloor))
	mux.HandleFunc("POST /api/floors/create/{$}", h.RequireAdmin(h.CreateFloor))
	mux.HandleFunc("POST /api/floors/{id}/delete/{$}", h.RequireAdmin(h.DeleteFloor))

	//REST USERS
	mux.HandleFunc("GET /api/employees/{$}", h.RequireAuth(h.GetEmployees))
	mux.HandleFunc("POST /api/employees/create/{$}", h.RequireAdmin(h.CreateEmployee))
	mux.HandleFunc("POST /api/employees/{id}/update/{$}", h.RequireAuth(h.UpdateEmployee))
	mux.HandleFunc("POST /api/auth/login/{$}", h.Login)
	mux.HandleFunc("POST /api/auth/logout/{$}", h.Logout)

	//REST TASKS
	mux.HandleFunc("POST /api/tasks/create/{$}", h.RequireAuth(h.CreateTask))
	mux.HandleFunc("POST /api/tasks/{id}/update/{$}", h.RequireAuth(h.UpdateTask))
	mux.HandleFunc("POST /api/tasks/{id}/delete/{$}", h.RequireAuth(h.DeleteTask))
	mux.HandleFunc("GET /api/tasks/events/{$}", h.TaskEvents)
	mux.HandleFunc("GET /api/tasks/events", h.TaskEvents)
	mux.HandleFunc("POST /api/tasks/upload-screenshot/{$}", h.RequireAuth(h.UploadTaskScreenshot))
	mux.HandleFunc("POST /api/tasks/upload-screenshot", h.RequireAuth(h.UploadTaskScreenshot))
	mux.HandleFunc("POST /api/tasks/delete-screenshot/{$}", h.RequireAuth(h.DeleteTaskScreenshot))
	mux.HandleFunc("POST /api/tasks/delete-screenshot", h.RequireAuth(h.DeleteTaskScreenshot))

	//REST WORKDAY
	mux.HandleFunc("GET /api/workday/status/{$}", h.RequireAuth(h.GetWorkdayStatus))
	mux.HandleFunc("POST /api/workday/start/{$}", h.RequireAuth(h.StartWorkday))
	mux.HandleFunc("POST /api/workday/pause/{$}", h.RequireAuth(h.TogglePauseWorkday))
	mux.HandleFunc("POST /api/workday/finish/{$}", h.RequireAuth(h.FinishWorkday))

	//REST INVENTORY
	mux.HandleFunc("GET /api/inventory/{$}", h.RequireMTOOrAdmin(h.GetInventory))
	mux.HandleFunc("POST /api/inventory/create/{$}", h.RequireMTOOrAdmin(h.CreateInventoryItem))
	mux.HandleFunc("POST /api/inventory/{id}/update/{$}", h.RequireMTOOrAdmin(h.UpdateInventoryItem))
	mux.HandleFunc("POST /api/inventory/{id}/delete/{$}", h.RequireMTOOrAdmin(h.DeleteInventoryItem))
	mux.HandleFunc("POST /api/inventory/batch-create/{$}", h.RequireMTOOrAdmin(h.BatchCreateInventoryItems))

	// REST PINGER SERVICE (доступен только системным администраторам и администраторам системы)
	mux.HandleFunc("GET /api/pinger/status/{$}", h.RequirePinger(h.GetPingerStatus))
	mux.HandleFunc("POST /api/pinger/config/{$}", h.RequirePinger(h.UpdatePingerConfig))
	mux.HandleFunc("POST /api/pinger/check-now/{$}", h.RequirePinger(h.TriggerPingCheck))

	//REST ROOM BOOKING & TABLET
	mux.HandleFunc("GET /tablet/room/{code}/{$}", h.TabletPage)
	mux.HandleFunc("GET /tablet/rooms/{code}/{$}", h.TabletPage)
	mux.HandleFunc("GET /api/rooms/bookings/{$}", h.GetRoomBookings)
	mux.HandleFunc("POST /api/rooms/bookings/create/{$}", h.RequireAuth(h.CreateRoomBooking))
	mux.HandleFunc("POST /api/rooms/bookings/{id}/delete/{$}", h.RequireAuth(h.DeleteRoomBooking))
	mux.HandleFunc("GET /api/rooms/tablet-info/{code}/{$}", h.GetRoomTabletInfo)
	mux.HandleFunc("GET /api/rooms/tablet-info/{code}", h.GetRoomTabletInfo)
	mux.HandleFunc("POST /api/rooms/quick-book/{$}", h.QuickBookRoom)
	mux.HandleFunc("POST /api/rooms/finish-early/{$}", h.FinishMeetingEarly)
	mux.HandleFunc("POST /api/rooms/extend/{$}", h.ExtendMeeting)

	return mux
}
