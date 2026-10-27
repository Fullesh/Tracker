package handler

import (
	"Tracker/internal/domain"
	"encoding/json"
	"fmt"
	"html/template"
	"net/http"
	"strings"
)

var defaultAssignees = []map[string]any{}

var defaultStatuses = []map[string]any{
	{"id": "open", "name": "Открыта"},
	{"id": "in_progress", "name": "В работе"},
	{"id": "review", "name": "На проверке"},
	{"id": "closed", "name": "Закрыта"},
}

var defaultPriorities = []map[string]any{
	{"id": "blocker", "name": "Блокер"},
	{"id": "critical", "name": "Критичный"},
	{"id": "high", "name": "Высокий"},
	{"id": "normal", "name": "Средний"},
	{"id": "low", "name": "Низкий"},
}

var defaultSeverities = []map[string]any{
	{"id": "s1", "name": "S1 · Критическая"},
	{"id": "s2", "name": "S2 · Значительная"},
	{"id": "s3", "name": "S3 · Умеренная"},
	{"id": "s4", "name": "S4 · Незначительная"},
}

func (h *Handler) Ping(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	fmt.Fprintln(w, "pong")
}

func (h *Handler) LoginPage(w http.ResponseWriter, r *http.Request) {
	auth := h.currentAuth(r)
	if isAuth, _ := auth["is_authenticated"].(bool); isAuth {
		http.Redirect(w, r, "/", http.StatusSeeOther)
		return
	}

	tmpl, err := template.ParseFiles("web/templates/login.html")
	if err != nil {
		http.Error(w, "Ошибка загрузки шаблона: "+err.Error(), http.StatusInternalServerError)
		return
	}

	tmpl.Execute(w, nil)
}

func (h *Handler) Index(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/api/") {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]any{
			"success": false,
			"error":   "API эндпойнт не найден или HTTP-метод не поддерживается",
		})
		return
	}
	auth := h.currentAuth(r)
	isAuth, _ := auth["is_authenticated"].(bool)
	if !isAuth {
		http.Redirect(w, r, "/login", http.StatusSeeOther)
		return
	}

	var floors []domain.Floor
	var employees []domain.Employee
	var tasks []domain.Task

	h.db.Order("id ASC").Find(&tasks)
	h.db.Preload("Walls").Preload("Labels").Preload("Workplaces").Find(&floors)
	h.db.Preload("Workplace").Preload("User").Preload("InventoryItems").Find(&employees)
	isAdmin, _ := auth["is_admin"].(bool)
	for i := range employees {
		employees[i].CanEdit = isAdmin
	}

	assignees := h.loadAssigneesFromDB()

	configData := map[string]any{
		"floors":      floors,
		"employees":   employees,
		"tasks":       tasks,
		"assignees":   assignees,
		"statuses":    defaultStatuses,
		"priorities":  defaultPriorities,
		"severities":  defaultSeverities,
		"departments": []string{"Разработка", "Бухгалтерия", "Продажи", "IT"},
		"auth":        auth,
	}
	configBytes, _ := json.Marshal(configData)
	tmpl, _ := template.ParseFiles("web/templates/index.html")
	data := map[string]any{"TrackerConfigJSON": template.JS(configBytes)}
	tmpl.Execute(w, data)
}

func (h *Handler) Constructor(w http.ResponseWriter, r *http.Request) {
	auth := h.currentAuth(r)
	isAdmin, _ := auth["is_admin"].(bool)
	if !isAdmin {
		http.Redirect(w, r, "/", http.StatusSeeOther)
		return
	}
	var activeFloorID uint
	var floors []domain.Floor
	var employees []domain.Employee
	h.db.Preload("Walls").Preload("Labels").Preload("Workplaces").Find(&floors)
	h.db.Find(&employees)
	if len(floors) > 0 {
		activeFloorID = floors[0].ID
	}
	constructorData := map[string]any{
		"floors":          floors,
		"active_floor_id": activeFloorID,
		"employees":       employees,
	}
	constructorBytes, _ := json.Marshal(constructorData)
	tmpl, _ := template.ParseFiles("web/templates/constructor.html")
	data := map[string]any{"ConstructorConfigJSON": template.JS(constructorBytes)}
	tmpl.Execute(w, data)
}
