package handler

import (
	"PTracker/internal/domain"
	"encoding/json"
	"fmt"
	"html/template"
	"net/http"
)

var defaultAssignees = []map[string]any{
	{"id": "1", "name": "Иван Иванов", "role": "Системный администратор"},
	{"id": "2", "name": "Сергей Сергеев", "role": "Системный администратор"},
	{"id": "3", "name": "Анатолий Анатольев", "role": "Специалист по МТО"},
}

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

func (h *Handler) Index(w http.ResponseWriter, r *http.Request) {
	auth := h.currentAuth(r)
	var floors []domain.Floor
	var employees []domain.Employee
	var tasks []domain.Task
	h.db.Order("id ASC").Find(&tasks)
	h.db.Preload("Walls").Preload("Labels").Preload("Workplaces").Find(&floors)
	h.db.Find(&employees)
	isAdmin, _ := auth["is_admin"].(bool)
	for i := range employees {
		employees[i].CanEdit = isAdmin
	}
	configData := map[string]any{
		"floors":      floors,
		"employees":   employees,
		"tasks":       tasks,
		"assignees":   defaultAssignees,
		"statuses":    defaultStatuses,
		"priorities":  defaultPriorities,
		"severities":  defaultSeverities,
		"departments": []string{"Разработка", "Бухгалтерия", "Продажи", "IT"},
		"auth":        h.currentAuth(r),
	}
	configBytes, _ := json.Marshal(configData)
	tmpl, _ := template.ParseFiles("web/templates/index.html")
	data := map[string]any{"TrackerConfigJSON": template.JS(configBytes)}
	tmpl.Execute(w, data)
}

func (h *Handler) Constructor(w http.ResponseWriter, r *http.Request) {
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
