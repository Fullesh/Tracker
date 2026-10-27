package handler

import (
	"Tracker/internal/domain"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type AssigneeItem struct {
	ID         string `json:"id"`
	EmployeeID *uint  `json:"employee_id,omitempty"`
	Name       string `json:"name"`
	Role       string `json:"role"`
	PhotoURL   string `json:"photo_url"`
}

func (h *Handler) loadAssigneesFromDB() []AssigneeItem {
	var assignees []AssigneeItem
	var setting domain.Setting
	if err := h.db.Where("key = ?", "assignees").First(&setting).Error; err == nil && setting.Value != "" {
		_ = json.Unmarshal([]byte(setting.Value), &assignees)
	}

	if assignees == nil {
		assignees = []AssigneeItem{}
	}

	// Обогащаем актуальными фото и должностями из таблицы сотрудников
	if len(assignees) > 0 {
		var employees []domain.Employee
		h.db.Find(&employees)
		empMap := make(map[uint]domain.Employee)
		empNameMap := make(map[string]domain.Employee)
		for _, emp := range employees {
			empMap[emp.ID] = emp
			empNameMap[strings.ToLower(strings.TrimSpace(emp.FullName))] = emp
		}

		for i, a := range assignees {
			var emp *domain.Employee
			if a.EmployeeID != nil && *a.EmployeeID > 0 {
				if e, exists := empMap[*a.EmployeeID]; exists {
					emp = &e
				}
			}
			if emp == nil {
				if e, exists := empNameMap[strings.ToLower(strings.TrimSpace(a.Name))]; exists {
					emp = &e
				}
			}
			if emp != nil {
				if assignees[i].PhotoURL == "" && emp.Photo != "" {
					assignees[i].PhotoURL = emp.Photo
				}
				if assignees[i].Role == "" && emp.Position != "" {
					assignees[i].Role = emp.Position
				}
			}
		}
	}

	return assignees
}

func (h *Handler) saveAssigneesToDB(assignees []AssigneeItem) error {
	data, err := json.Marshal(assignees)
	if err != nil {
		return err
	}
	var setting domain.Setting
	if err := h.db.Where("key = ?", "assignees").First(&setting).Error; err != nil {
		setting = domain.Setting{
			Key:   "assignees",
			Value: string(data),
		}
		return h.db.Create(&setting).Error
	}
	setting.Value = string(data)
	setting.UpdatedAt = time.Now()
	return h.db.Save(&setting).Error
}

func (h *Handler) GetAssignees(w http.ResponseWriter, r *http.Request) {
	assignees := h.loadAssigneesFromDB()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"success":   true,
		"assignees": assignees,
	})
}

func (h *Handler) CreateAssignee(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		EmployeeID *uint  `json:"employee_id"`
		Name       string `json:"name"`
		Role       string `json:"role"`
		PhotoURL   string `json:"photo_url"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Некорректный JSON", http.StatusBadRequest)
		return
	}

	if payload.EmployeeID == nil || *payload.EmployeeID == 0 {
		http.Error(w, "Не выбран сотрудник", http.StatusBadRequest)
		return
	}

	var emp domain.Employee
	if err := h.db.First(&emp, *payload.EmployeeID).Error; err != nil {
		http.Error(w, "Сотрудник не найден в базе данных", http.StatusNotFound)
		return
	}

	name := emp.FullName
	role := emp.Position
	if role == "" {
		role = emp.Department
	}
	if role == "" {
		role = "Исполнитель"
	}
	photo := emp.Photo

	assignees := h.loadAssigneesFromDB()

	// Проверяем, не добавлен ли уже этот сотрудник
	for _, a := range assignees {
		if a.EmployeeID != nil && *a.EmployeeID == emp.ID {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]any{
				"success":   true,
				"assignees": assignees,
				"message":   "Сотрудник уже находится в списке исполнителей",
			})
			return
		}
	}

	item := AssigneeItem{
		ID:         strconv.Itoa(int(emp.ID)),
		EmployeeID: &emp.ID,
		Name:       name,
		Role:       role,
		PhotoURL:   photo,
	}

	assignees = append(assignees, item)
	if err := h.saveAssigneesToDB(assignees); err != nil {
		http.Error(w, "Ошибка сохранения исполнителя: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"success":   true,
		"assignees": assignees,
		"created":   item,
	})
}

func (h *Handler) DeleteAssignee(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "Не указан ID исполнителя", http.StatusBadRequest)
		return
	}

	assignees := h.loadAssigneesFromDB()
	updated := make([]AssigneeItem, 0)
	found := false
	for _, a := range assignees {
		if a.ID == id || (a.EmployeeID != nil && strconv.Itoa(int(*a.EmployeeID)) == id) {
			found = true
			continue
		}
		updated = append(updated, a)
	}

	if !found {
		http.Error(w, "Исполнитель не найден", http.StatusNotFound)
		return
	}

	if err := h.saveAssigneesToDB(updated); err != nil {
		http.Error(w, "Ошибка сохранения изменений: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"success":   true,
		"assignees": updated,
	})
}
