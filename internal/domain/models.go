package domain

import "time"

type Wall struct {
	ID      uint `gorm:"primaryKey" json:"id"`
	FloorID uint `gorm:"not null; index" json:"floor_id"`

	X1 int `gorm:"not null" json:"x1"`
	Y1 int `gorm:"not null" json:"y1"`
	X2 int `gorm:"not null" json:"x2"`
	Y2 int `gorm:"not null" json:"y2"`
}

type RoomLabel struct {
	ID      uint   `gorm:"primaryKey" json:"id"`
	FloorID uint   `gorm:"not null;index" json:"floor_id"`
	Text    string `gorm:"size:100;not null;index" json:"text"`
	X       int    `gorm:"not null" json:"x"`
	Y       int    `gorm:"not null" json:"y"`
}

type Floor struct {
	ID     uint   `gorm:"primaryKey" json:"id"`
	Name   string `gorm:"size:100;not null" json:"name"`
	Order  int    `gorm:"default:1;not null" json:"order"`
	Width  int    `gorm:"default:1000;not null" json:"width"`
	Height int    `gorm:"default:600;not null" json:"height"`

	Walls      []Wall      `gorm:"constraint:OnDelete:CASCADE;" json:"walls,omitempty"`
	Labels     []RoomLabel `gorm:"constraint:OnDelete:CASCADE;" json:"labels,omitempty"`
	Workplaces []Workplace `gorm:"constraint:OnDelete:CASCADE;" json:"workplaces,omitempty"`
}

type Workplace struct {
	ID       uint   `gorm:"primaryKey" json:"id"`
	FloorID  uint   `gorm:"not null;index" json:"floor_id"`
	Code     string `gorm:"size:20;uniqueIndex;not null" json:"code"`
	Kind     string `gorm:"size:20;default:'pc';not null" json:"kind"`
	Employee string `gorm:"size:150" json:"employee"`
	Label    string `gorm:"size:150" json:"label"`
	Room     string `gorm:"size:150" json:"room"`
	X        int    `gorm:"not null" json:"x"`
	Y        int    `gorm:"not null" json:"y"`
	Tasks    []Task `gorm:"constraint:OnDelete:CASCADE;" json:"tasks,omitempty"`
}

type Employee struct {
	ID          uint       `gorm:"primaryKey" json:"id"`
	User        *User      `gorm:"foreignKey:EmployeeID" json:"user,omitempty"`
	FullName    string     `gorm:"size:200;not null;index" json:"full_name"`
	Photo       string     `gorm:"size:255" json:"photo_url"`
	Position    string     `gorm:"size:150" json:"position"`
	Department  string     `gorm:"size:150;not null;index" json:"department"`
	WorkPhone   string     `gorm:"size:50" json:"work_phone"`
	Email       string     `gorm:"size:255" json:"email"`
	WorkplaceID *uint      `gorm:"constraint:OnDelete:SET NULL;" json:"workplace_id,omitempty"`
	Workplace   *Workplace `gorm:"foreignKey:WorkplaceID" json:"workplace,omitempty"`
	Equipment   string     `gorm:"type:text" json:"equipment"`
	CanEdit     bool       `gorm:"-" json:"can_edit"`
	CreatedAt   time.Time  `gorm:"default:CURRENT_TIMESTAMP" json:"created_at"`
	UpdatedAt   time.Time  `gorm:"default:CURRENT_TIMESTAMP" json:"updated_at"`
}

type Task struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	WorkplaceID *uint     `gorm:"index;constraint:OnDelete:SET NULL;" json:"workplace"`
	Creator     string    `gorm:"size:150" json:"creator"`
	Assignee    string    `gorm:"size:50" json:"assignee"`
	Title       string    `gorm:"size:255;not null" json:"title"`
	Description string    `gorm:"type:text" json:"description"`
	Status      string    `gorm:"size:50;default:'created';not null;index" json:"status"`
	Priority    string    `gorm:"size:50;default:'urgent';not null;index" json:"priority"`
	Severity    string    `gorm:"size:50;default:'minor';not null;index" json:"severity"`
	CreatedAt   time.Time `gorm:"default:CURRENT_TIMESTAMP" json:"created_at"`
	UpdatedAt   time.Time `gorm:"default:CURRENT_TIMESTAMP" json:"updated_at"`
}

type User struct {
	ID           uint      `gorm:"primaryKey" json:"id"`
	EmployeeID   *uint     `gorm:"index;constraint:OnDelete:SET NULL;" json:"employee_id,omitempty"`
	Employee     *Employee `gorm:"foreignKey:EmployeeID" json:"employee"`
	Username     string    `gorm:"size:20;uniqueIndex;not null" json:"username"`
	PasswordHash string    `gorm:"size:255;not null" json:"-"`
	IsAdmin      bool      `gorm:"default:false" json:"is_admin"`
	CreatedAt    time.Time `gorm:"default:CURRENT_TIMESTAMP" json:"created_at"`
}

type WorkSession struct {
	ID             uint       `gorm:"primaryKey" json:"id"`
	UserID         uint       `gorm:"index;not null" json:"user_id"`
	User           *User      `gorm:"foreignKey:UserID" json:"user,omitempty"`
	Status         string     `gorm:"size:20;default:'active';not null;index" json:"status"` // "active", "paused", "finished
	StartedAt      time.Time  `gorm:"not null" json:"started_at"`
	PausedAt       *time.Time `json:"paused_at,omitempty"`
	PausedDuration int        `gorm:"default:0;not null" json:"paused_duration"` //накопленная пауза в секундах
	FinishedAt     *time.Time `json:"finished_at,omitempty"`
	CreatedAt      time.Time  `gorm:"default:CURRENT_TIMESTAMP" json:"created_at"`
	UpdatedAt      time.Time  `gorm:"default:CURRENT_TIMESTAMP" json:"updated_at"`
}

type InventoryItem struct {
	ID              uint      `gorm:"primaryKey" json:"id"`
	InventoryNumber string    `gorm:"size:100;uniqueIndex;notnull" json:"inventory_number"`
	Name            string    `gorm:"size:200;notnull" json:"name"`
	Category        string    `gorm:"size:50;notnull;index" json:"category"`
	TypeCode        string    `gorm:"size:10;notnull" json:"type_code"`
	Status          string    `gorm:"size:50;default:'assigned';not null;index" json:"status"`
	WorkplaceCode   string    `gorm:"size:50" json:"workplace_code"`
	EmployeeID      *uint     `gorm:"index;constraint:OnDelete:SET NULL;" json:"employee_id,omitempty"`
	Employee        *Employee `gorm:"foreignKey:EmployeeID" json:"employee,omitempty"`
	Notes           string    `gorm:"type:text" json:"notes"`
	CreatedAt       time.Time `gorm:"default:CURRENT_TIMESTAMP" json:"created_at"`
	UpdatedAt       time.Time `gorm:"default:CURRENT_TIMESTAMP" json:"updated_at"`
}
