package handler

import (
	"PTracker/internal/domain"
	"encoding/json"
	"net/http"
)

func (h *Handler) GetEmployees(w http.ResponseWriter, r *http.Request) {
	var employees []domain.Employee
	if err := h.db.Preload("Workplace").Order("full_name ASC").Find(&employees).Error; err != nil {
		http.Error(w, "Ошибка полученяи сотрудников"+err.Error(), http.StatusInternalServerError)
		return
	}

	var departments []string
	h.db.Model(&domain.Employee{}).Distinct("department").Order("department ASC").Pluck("department", &departments)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"employees":   employees,
		"departments": departments,
		"auth": map[string]any{
			"is_authenticated": true,
			"is_admin":         true,
		},
	})
}
