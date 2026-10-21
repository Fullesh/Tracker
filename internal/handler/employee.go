package handler

import (
	"PTracker/internal/domain"
	"encoding/json"
	"net/http"
	"strconv"
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
		"auth":        h.currentAuth(r),
	})
}

func (h *Handler) UpdateEmployee(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	employeeID, err := strconv.Atoi(idStr)
	if err != nil {
		http.Error(w, "Некорректный ID сотрудника", http.StatusBadRequest)
		return
	}

	if err := r.ParseMultipartForm(10 << 20); err != nil {
		http.Error(w, "Ошибка чтения формы", http.StatusBadRequest)
		return
	}

	var emp domain.Employee
	if err := h.db.First(&emp, employeeID).Error; err != nil {
		http.Error(w, "Сотрудник не найден", http.StatusNotFound)
		return
	}

	emp.FullName = r.FormValue("full_name")
	emp.Position = r.FormValue("position")
	emp.Department = r.FormValue("department")
	emp.WorkPhone = r.FormValue("work_phone")
	emp.Email = r.FormValue("email")
	emp.Equipment = r.FormValue("equipment")

	wpStr := r.FormValue("workplace_id")
	if wpStr == "" {
		emp.WorkplaceID = nil
	} else if wpID, err := strconv.Atoi(wpStr); err == nil {
		id := uint(wpID)
		emp.WorkplaceID = &id
	}

	if err := h.db.Save(&emp).Error; err != nil {
		http.Error(w, "Ошибка сохранения: "+err.Error(), http.StatusInternalServerError)
		return
	}

	h.db.Preload("Workplace").First(&emp, employeeID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"success":  true,
		"employee": emp,
	})
}
