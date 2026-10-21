package handler

import (
	"PTracker/internal/domain"
	"encoding/json"
	"net/http"
	"strconv"
)

type createTaskPayload struct {
	Title       string `json:"title"`
	Description string `json:"description"`
	Creator     string `json:"creator"`
	Assignee    string `json:"assignee"`
	Workplace   any    `json:"workplace"`
	Status      string `json:"status"`
	Priority    string `json:"priority"`
	Severity    string `json:"severity"`
}

func (h *Handler) CreateTask(w http.ResponseWriter, r *http.Request) {
	var payload createTaskPayload

	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Некорректный JSON", http.StatusBadRequest)
		return
	}

	if payload.Status == "" {
		payload.Status = "open"
	}

	var wpID *uint
	switch v := payload.Workplace.(type) {
	case float64:
		id := uint(v)
		if id > 0 {
			wpID = &id
		}
	case string:
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			id := uint(n)
			wpID = &id
		}
	}

	task := domain.Task{
		Title:       payload.Title,
		Description: payload.Description,
		Creator:     payload.Creator,
		Assignee:    payload.Assignee,
		Status:      payload.Status,
		Priority:    payload.Priority,
		Severity:    payload.Severity,
		WorkplaceID: wpID,
	}

	if err := h.db.Create(&task).Error; err != nil {
		http.Error(w, "Ошибка создания задачи: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"success": true,
		"task":    task,
	})
}
