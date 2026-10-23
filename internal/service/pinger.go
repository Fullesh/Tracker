package service

import (
	"PTracker/internal/domain"
	"context"
	"fmt"
	"log"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"gorm.io/gorm"
)

type DeviceStatus struct {
	IP            string    `json:"ip"`
	Name          string    `json:"name"`
	Workplace     string    `json:"workplace"`
	IsOnline      bool      `json:"is_online"`
	LastCheckedAt time.Time `json:"last_checked_at"`
}

type PingerService struct {
	db              *gorm.DB
	mu              sync.RWMutex
	enabled         bool
	intervalMinutes int
	statuses        map[string]DeviceStatus
	stopCh          chan struct{}
}

func NewPingerService(db *gorm.DB) *PingerService {
	enabled := false
	if envVal := os.Getenv("PINGER_ENABLED"); envVal == "true" || envVal == "1" {
		enabled = true
	}

	interval := 10
	var setting domain.Setting
	if err := db.Where("key = ?", "pinger_interval").First(&setting).Error; err == nil {
		if n, err := strconv.Atoi(setting.Value); err == nil && n >= 1 {
			interval = n
		}
	}
	if err := db.Where("key = ?", "pinger_enabled").First(&setting).Error; err == nil {
		enabled = setting.Value == "true" || setting.Value == "1"
	}
	return &PingerService{
		db:              db,
		enabled:         enabled,
		intervalMinutes: interval,
		statuses:        make(map[string]DeviceStatus),
		stopCh:          make(chan struct{}),
	}
}

func (p *PingerService) Start() {
	go func() {
		log.Printf("[pinger] Мониторинг запущен (интервал: %d мин, авто-создание задач: %v)", p.intervalMinutes, p.enabled)
		p.CheckAll()
		for {
			p.mu.RLock()
			interval := time.Duration(p.intervalMinutes) * time.Minute
			p.mu.RUnlock()
			select {
			case <-time.After(interval):
				p.CheckAll()
			case <-p.stopCh:
				return
			}
		}
	}()
}

func (p *PingerService) PingIP(ip string) bool {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.CommandContext(ctx, "ping", "-n", "1", "-w", "1000", ip)
	} else {
		cmd = exec.CommandContext(ctx, "ping", "-c", "1", "-W", "1", ip)
	}

	err := cmd.Run()
	return err == nil
}

func (p *PingerService) CheckAll() {
	p.mu.RLock()
	autoCreateTasks := p.enabled
	p.mu.RUnlock()

	type target struct {
		ip     string
		name   string
		wpCode string
		wpID   *uint
	}

	var targets []target

	var items []domain.InventoryItem
	p.db.Where("ip IS NOT NULL AND ip != '' AND status != 'decomissioned'").Find(&items)
	for _, it := range items {
		targets = append(targets, target{
			ip:     it.IP,
			name:   it.Name,
			wpCode: it.WorkplaceCode,
		})
	}

	var places []domain.Workplace
	p.db.Where("ip IS NOT NULL AND ip != ''").Find(&places)
	for _, wp := range places {
		id := wp.ID
		label := wp.Label
		if label == "" {
			label = wp.Label
		}
		targets = append(targets, target{
			ip:     strings.TrimSpace(wp.IP),
			name:   label,
			wpCode: wp.Code,
			wpID:   &id,
		})
	}

	newStatuses := make(map[string]DeviceStatus)
	for _, t := range targets {
		if t.ip == "" {
			continue
		}
		online := p.PingIP(t.ip)
		newStatuses[t.name] = DeviceStatus{
			IP:            t.ip,
			Name:          t.name,
			Workplace:     t.wpCode,
			IsOnline:      online,
			LastCheckedAt: time.Now(),
		}
		if !online && autoCreateTasks {
			p.ensureAlertTask(t.name, t.ip, t.wpCode, t.wpID)
		}
	}

	p.mu.Lock()
	p.statuses = newStatuses
	p.mu.Unlock()
}

func (p *PingerService) ensureAlertTask(name, ip, wpCode string, wpID *uint) {
	var count int64
	p.db.Model(&domain.Task{}).
		Where("creator = ? AND status != ? AND description LIKE?", "pinger", "closed", "%"+ip+"%").
		Count(&count)
	if count > 0 {
		return
	}

	if wpID == nil && wpCode != "" && wpCode != "STOCK" {
		var wp domain.Workplace
		if err := p.db.Where("code = ?", wpCode).First(&wp).Error; err == nil {
			id := wp.ID
			wpID = &id
		}
	}

	task := domain.Task{
		Title:       fmt.Sprintf("Недоступно оборудование %s (%s)", name, ip),
		Description: fmt.Sprintf("Система мониторинга зафиксировала потерю сетевой доступности устройства %s (UP: %s, стойка/место: %s).", name, ip, wpCode),
		Creator:     "pinger",
		Assignee:    "1",
		Status:      "open",
		Priority:    "high",
		Severity:    "s2",
		WorkplaceID: wpID,
	}

	if err := p.db.Create(&task).Error; err != nil {
		log.Printf("[pinger] Ошибка создания задачи для %s: %v", name, err)
	} else {
		log.Printf("[pinger] Создана задача #%d о недоступности %s (%s)", task.ID, name, ip)
	}
}

func (p *PingerService) GetStatus() map[string]any {
	p.mu.RLock()
	defer p.mu.RUnlock()

	devices := make([]DeviceStatus, 0, len(p.statuses))
	for _, s := range p.statuses {
		devices = append(devices, s)
	}

	return map[string]any{
		"enabled":          p.enabled,
		"interval_minutes": p.intervalMinutes,
		"devices":          devices,
	}
}

func (p *PingerService) UpdateConfig(enabled *bool, interval *int) {
	p.mu.Lock()
	if enabled != nil {
		p.enabled = *enabled
		val := "false"
		if *enabled {
			val = "true"
		}
		p.db.Save(&domain.Setting{Key: "pinger_enabled", Value: val, UpdatedAt: time.Now()})
	}
	if interval != nil && *interval >= 1 {
		p.intervalMinutes = *interval
		p.db.Save(&domain.Setting{Key: "pinger_interval", Value: strconv.Itoa(*interval), UpdatedAt: time.Now()})
	}
	p.mu.Unlock()
}
