package handler

import (
	"PTracker/internal/domain"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
)

type inventoryPayload struct {
	Name            string `json:"name"`
	Category        string `json:"category"`
	TypeCode        string `json:"type_code"`
	Status          string `json:"status"`
	WorkplaceCode   string `json:"workplace_code"`
	EmployeeID      *uint  `json:"employee_id"`
	Notes           string `json:"notes"`
	InventoryNumber string `json:"inventory_number"`
}

func (h *Handler) GetInventory(w http.ResponseWriter, r *http.Request) {
	var items []domain.InventoryItem

	query := h.db.Model(&domain.InventoryItem{}).Preload("Employee")

	searchQuery := r.URL.Query().Get("q")
	if searchQuery != "" {
		pattern := fmt.Sprintf("%%%s%%", searchQuery)
		query = query.Where("inventory_number ILIKE ? OR name ILIKE ? OR workplace_code ILIKE ?", pattern, pattern, pattern)
	}

	statusFilter := r.URL.Query().Get("status")
	if statusFilter != "" && statusFilter != "all" {
		query = query.Where("status = ?", statusFilter)
	}

	if err := query.Order("id DESC").Find(&items).Error; err != nil {
		http.Error(w, "Ошибка получения инвентаря: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"items": items,
		"total": len(items),
	})
}

func (h *Handler) CreateInventoryItem(w http.ResponseWriter, r *http.Request) {
	var payload inventoryPayload
	var wpCode string

	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Некорректный JSON в теле запроса", http.StatusBadRequest)
		return
	}

	if strings.TrimSpace(payload.WorkplaceCode) != "" {
		wpCode = strings.ToUpper(strings.TrimSpace(payload.WorkplaceCode))
	} else {
		wpCode = "STOCK"
	}

	if strings.TrimSpace(payload.Name) == "" {
		http.Error(w, "Не указано наименование оборудования", http.StatusBadRequest)
		return
	}
	if strings.TrimSpace(payload.TypeCode) == "" {
		http.Error(w, "Не указан тип оборудования", http.StatusBadRequest)
		return
	}

	typeCode := strings.ToUpper(strings.TrimSpace(payload.TypeCode))
	prefix := fmt.Sprintf("INV_%s_%s", typeCode, wpCode)

	invNumber := strings.ToUpper(strings.TrimSpace(payload.InventoryNumber))
	if invNumber == "" {
		var count int64
		h.db.Model(&domain.InventoryItem{}).Where("inventory_number LIKE ?", prefix+"%").Count(&count)
		invNumber = fmt.Sprintf("%s_%02d", prefix, count+1)
	}

	status := strings.TrimSpace(payload.Status)
	if status == "" {
		if wpCode != "STOCK" {
			status = "assigned"
		} else {
			status = "storage"
		}
	}

	item := domain.InventoryItem{
		InventoryNumber: invNumber,
		Name:            strings.TrimSpace(payload.Name),
		Category:        payload.Category,
		TypeCode:        typeCode,
		Status:          status,
		WorkplaceCode:   wpCode,
		EmployeeID:      payload.EmployeeID,
		Notes:           payload.Notes,
	}
	if err := h.db.Create(&item).Error; err != nil {
		http.Error(w, "Ошибка сохранения оборудования: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"success": true,
		"item":    item,
	})
}

func (h *Handler) UpdateInventoryItem(w http.ResponseWriter, r *http.Request) {
	return
}

func (h *Handler) DeleteInventoryItem(w http.ResponseWriter, r *http.Request) {
	return
}
