package handler

import (
	"Tracker/internal/domain"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
)

type inventoryPayload struct {
	Name            string `json:"name"`
	Category        string `json:"category"`
	TypeCode        string `json:"type_code"`
	IP              string `json:"ip"`
	Status          string `json:"status"`
	WorkplaceCode   string `json:"workplace_code"`
	EmployeeID      *uint  `json:"employee_id"`
	Notes           string `json:"notes"`
	InventoryNumber string `json:"inventory_number"`
}

type batchInventoryItemPayload struct {
	Name            string `json:"name"`
	Category        string `json:"category"`
	TypeCode        string `json:"type_code"`
	IP              string `json:"ip"`
	Status          string `json:"status"`
	WorkplaceCode   string `json:"workplace_code"`
	EmployeeID      *uint  `json:"employee_id"`
	Notes           string `json:"notes"`
	InventoryNumber string `json:"inventory_number"`
	Quantity        int    `json:"quantity"`
}

type batchCreateInventoryPayload struct {
	InvoiceNumber string                      `json:"invoice_number"`
	Items         []batchInventoryItemPayload `json:"items"`
}

func (h *Handler) resolveWorkplaceCode(employeeID *uint, fallbackCode string) string {
	if employeeID != nil && *employeeID > 0 {
		var emp domain.Employee
		if err := h.db.Preload("Workplace").First(&emp, *employeeID).Error; err == nil {
			if emp.Workplace != nil && strings.TrimSpace(emp.Workplace.Code) != "" {
				return strings.ToUpper(strings.TrimSpace(emp.Workplace.Code))
			}
		}
		return "STOCK"
	}
	code := strings.ToUpper(strings.TrimSpace(fallbackCode))
	if code != "" {
		return code
	}
	return "STOCK"
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

	wpCode = h.resolveWorkplaceCode(payload.EmployeeID, payload.WorkplaceCode)

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
		IP:              strings.TrimSpace(payload.IP),
		Status:          status,
		WorkplaceCode:   wpCode,
		EmployeeID:      payload.EmployeeID,
		Notes:           payload.Notes,
	}
	if err := h.db.Create(&item).Error; err != nil {
		http.Error(w, "Ошибка сохранения оборудования: "+err.Error(), http.StatusInternalServerError)
		return
	}
	h.db.Preload("Employee").First(&item, item.ID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"success": true,
		"item":    item,
	})
}

func (h *Handler) UpdateInventoryItem(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	inventoryID, err := strconv.Atoi(idStr)
	if err != nil {
		http.Error(w, "Некорректный ID оборудования", http.StatusBadRequest)
		return
	}
	var payload inventoryPayload
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Некорректный JSON в теле запроса", http.StatusBadRequest)
		return
	}
	var item domain.InventoryItem
	if err := h.db.First(&item, inventoryID).Error; err != nil {
		http.Error(w, "Оборудование с таким ID не найдено", http.StatusNotFound)
		return
	}

	if payload.Name != "" {
		item.Name = payload.Name
	}
	if payload.Category != "" {
		item.Category = payload.Category
	}
	if payload.TypeCode != "" {
		item.TypeCode = payload.TypeCode
	}
	if payload.Status != "" {
		item.Status = payload.Status
	}
	if payload.InventoryNumber != "" {
		item.InventoryNumber = payload.InventoryNumber
	}

	item.EmployeeID = payload.EmployeeID
	item.WorkplaceCode = h.resolveWorkplaceCode(item.EmployeeID, payload.WorkplaceCode)
	item.Notes = payload.Notes
	item.IP = strings.TrimSpace(payload.IP)

	if err := h.db.Save(&item).Error; err != nil {
		http.Error(w, "Ошибка обновления оборудования: "+err.Error(), http.StatusInternalServerError)
		return
	}

	h.db.Preload("Employee").First(&item, item.ID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"success": true,
		"item":    item,
	})
}

func (h *Handler) DeleteInventoryItem(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	inventoryID, err := strconv.Atoi(idStr)
	if err != nil {
		http.Error(w, "Некорректный ID оборудования", http.StatusBadRequest)
		return
	}
	res := h.db.Delete(&domain.InventoryItem{}, inventoryID)
	if res.Error != nil {
		http.Error(w, "Ошибка при удалении оборудования: "+res.Error.Error(), http.StatusInternalServerError)
		return
	}
	if res.RowsAffected == 0 {
		http.Error(w, "Оборудование не найдено", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"success": true,
	})
}

func (h *Handler) BatchCreateInventoryItems(w http.ResponseWriter, r *http.Request) {
	var payload batchCreateInventoryPayload
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Некорректный JSON в теле запроса", http.StatusBadRequest)
		return
	}

	if len(payload.Items) == 0 {
		http.Error(w, "Список позиций для добавления пуст", http.StatusBadRequest)
		return
	}

	tx := h.db.Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	var createdItems []domain.InventoryItem
	for _, item := range payload.Items {
		name := strings.TrimSpace(item.Name)
		if name == "" {
			continue
		}
		typeCode := strings.ToUpper(strings.TrimSpace(item.TypeCode))
		if typeCode == "" {
			typeCode = "DEV"
		}
		category := strings.TrimSpace(item.Category)
		if category == "" {
			category = "Оборудование"
		}
		wpCode := h.resolveWorkplaceCode(item.EmployeeID, item.WorkplaceCode)

		qty := item.Quantity
		if qty <= 0 {
			qty = 1
		}
		if qty > 50 {
			qty = 50
		}

		status := strings.TrimSpace(item.Status)
		if status == "" {
			if item.EmployeeID != nil && *item.EmployeeID > 0 {
				status = "assigned"
			} else {
				status = "in_stock"
			}
		}

		notes := strings.TrimSpace(item.Notes)
		if payload.InvoiceNumber != "" {
			if notes != "" {
				notes = fmt.Sprintf("Накладная: %s. %s", payload.InvoiceNumber, notes)
			} else {
				notes = fmt.Sprintf("Накладная: %s", payload.InvoiceNumber)
			}
		}

		for k := 0; k < qty; k++ {
			prefix := fmt.Sprintf("INV_%s_%s", typeCode, wpCode)
			invNumber := strings.ToUpper(strings.TrimSpace(item.InventoryNumber))

			if invNumber == "" || qty > 1 {
				var count int64
				tx.Model(&domain.InventoryItem{}).
					Where("inventory_number LIKE ?", prefix+"%").Count(&count)
				invNumber = fmt.Sprintf("%s_%02d", prefix, count+1)
			}

			newItem := domain.InventoryItem{
				InventoryNumber: invNumber,
				Name:            name,
				Category:        category,
				TypeCode:        typeCode,
				IP:              strings.TrimSpace(item.IP),
				Status:          status,
				WorkplaceCode:   wpCode,
				EmployeeID:      item.EmployeeID,
				Notes:           notes,
			}

			if err := tx.Create(&newItem).Error; err != nil {
				tx.Rollback()
				http.Error(w, "Ошибка сохранения инвентаря: "+err.Error(), http.StatusInternalServerError)
				return
			}

			createdItems = append(createdItems, newItem)
		}
	}

	if err := tx.Commit().Error; err != nil {
		tx.Rollback()
		http.Error(w, "Ошибка фиксации транзакции: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"success": true,
		"count":   len(createdItems),
		"items":   createdItems,
	})
}
