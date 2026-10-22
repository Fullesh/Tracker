package seed

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"PTracker/internal/domain"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

type fngResponse struct {
	Data []struct {
		Name struct {
			Full string `json:"full"`
		} `json:"name"`
		Email string `json:"email"`
		Phone struct {
			Number string `json:"number"`
		} `json:"phone"`
		Occupation string `json:"occupation"`
		Company    string `json:"company"`
		Portrait   struct {
			UrlJPG string `json:"url_jpg"`
		} `json:"portrait"`
	} `json:"data"`
}

type roomDef struct {
	Name string
	Kind string
	X1   int
	Y1   int
	X2   int
	Y2   int
}

// Seed — главная точка входа для наполнения базы первичными данными
func Seed(db *gorm.DB) error {
	// 1. Проверяем и генерируем сотрудников
	if err := seedEmployees(db); err != nil {
		return fmt.Errorf("ошибка наполнения сотрудников: %w", err)
	}

	// 2. Проверяем и генерируем этажи, стены и столы
	if err := seedFloors(db); err != nil {
		return fmt.Errorf("ошибка наполнения этажей: %w", err)
	}

	if err := seedAdmin(db); err != nil {
		return fmt.Errorf("Ошибка создания админа: %w", err)
	}

	if err := seedTasks(db); err != nil {
		return fmt.Errorf("Ошибка создания задач: %w", err)
	}

	log.Println("Наполнение базы данных успешно завершено!")
	return nil
}

func seedEmployees(db *gorm.DB) error {
	var count int64
	if err := db.Model(&domain.Employee{}).Count(&count).Error; err != nil {
		return err
	}

	if count > 0 {
		log.Printf("В базе уже есть %d сотрудников, пропускаем генерацию из API", count)
		return nil
	}

	apiKey := os.Getenv("FNG_API_KEY")
	if apiKey == "" {
		apiKey = "fng_live..."
	}

	client := &http.Client{Timeout: 30 * time.Second}
	url := "https://www.fakenamegenerator.com/api/v1/identities?count=20&country=ru-cyrl&name_set=russian"

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)

	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("не удалось отправить запрос к API: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("API вернул статус %d", resp.StatusCode)
	}

	var apiResult fngResponse
	if err := json.NewDecoder(resp.Body).Decode(&apiResult); err != nil {
		return fmt.Errorf("ошибка декодирования ответа API: %w", err)
	}

	var employees []domain.Employee
	for _, p := range apiResult.Data {
		emp := domain.Employee{
			FullName:   p.Name.Full,
			Photo:      p.Portrait.UrlJPG,
			Position:   p.Occupation,
			Department: p.Company,
			WorkPhone:  p.Phone.Number,
			Email:      p.Email,
		}
		employees = append(employees, emp)
	}

	if len(employees) > 0 {
		if err := db.Create(&employees).Error; err != nil {
			return fmt.Errorf("ошибка сохранения сотрудников в БД: %w", err)
		}
		log.Printf("Успешно сохранено %d сотрудников в PostgreSQL!", len(employees))
	}

	return nil
}

func seedFloors(db *gorm.DB) error {
	var floorCount int64
	if err := db.Model(&domain.Floor{}).Count(&floorCount).Error; err != nil {
		return err
	}

	if floorCount > 0 {
		log.Printf("В базе уже есть %d этажей, пропускаем генерацию карт", floorCount)
		return nil
	}

	// Загружаем всех сотрудников из базы для рассадки за столы
	var allEmployees []domain.Employee
	db.Order("id asc").Find(&allEmployees)
	empIndex := 0

	// Описываем 2 этажа со своими планировками
	floorsPlan := []struct {
		Name   string
		Order  int
		Width  int
		Height int
		Rooms  []roomDef
	}{
		{
			Name:   "1 этаж (Главный офис)",
			Order:  1,
			Width:  1200,
			Height: 700,
			Rooms: []roomDef{
				{Name: "Отдел продаж", Kind: "pc", X1: 70, Y1: 70, X2: 430, Y2: 320},
				{Name: "Бухгалтерия и кадры", Kind: "pc", X1: 490, Y1: 70, X2: 830, Y2: 320},
				{Name: "Кабинет директора", Kind: "pc", X1: 890, Y1: 70, X2: 1130, Y2: 320},
				{Name: "Зона отдыха и кухня", Kind: "meeting", X1: 70, Y1: 400, X2: 390, Y2: 630},
				{Name: "Большая переговорная", Kind: "meeting", X1: 450, Y1: 400, X2: 830, Y2: 630},
				{Name: "Серверная стойка", Kind: "server", X1: 890, Y1: 400, X2: 1130, Y2: 630},
			},
		},
		{
			Name:   "2 этаж (Разработка и IT)",
			Order:  2,
			Width:  1200,
			Height: 700,
			Rooms: []roomDef{
				{Name: "Frontend & Mobile", Kind: "pc", X1: 70, Y1: 70, X2: 450, Y2: 320},
				{Name: "Backend & DevOps", Kind: "pc", X1: 510, Y1: 70, X2: 870, Y2: 320},
				{Name: "Серверная комната #2", Kind: "server", X1: 930, Y1: 70, X2: 1130, Y2: 320},
				{Name: "Отдел QA и тестирование", Kind: "pc", X1: 70, Y1: 400, X2: 510, Y2: 630},
				{Name: "Малая переговорная", Kind: "meeting", X1: 570, Y1: 400, X2: 850, Y2: 630},
				{Name: "Техническая поддержка", Kind: "pc", X1: 910, Y1: 400, X2: 1130, Y2: 630},
			},
		},
	}

	for _, fp := range floorsPlan {
		// 1. Создаем этаж
		floor := domain.Floor{
			Name:   fp.Name,
			Order:  fp.Order,
			Width:  fp.Width,
			Height: fp.Height,
		}
		if err := db.Create(&floor).Error; err != nil {
			return fmt.Errorf("ошибка создания этажа %s: %w", fp.Name, err)
		}
		log.Printf("Создан этаж: %s (ID: %d)", floor.Name, floor.ID)

		// 2. Создаем 4 внешние стены здания
		outerWalls := []domain.Wall{
			{FloorID: floor.ID, X1: 40, Y1: 40, X2: fp.Width - 40, Y2: 40},
			{FloorID: floor.ID, X1: fp.Width - 40, Y1: 40, X2: fp.Width - 40, Y2: fp.Height - 40},
			{FloorID: floor.ID, X1: fp.Width - 40, Y1: fp.Height - 40, X2: 40, Y2: fp.Height - 40},
			{FloorID: floor.ID, X1: 40, Y1: fp.Height - 40, X2: 40, Y2: 40},
		}
		if err := db.Create(&outerWalls).Error; err != nil {
			return err
		}

		deskNumber := 1

		// 3. Создаем каждый кабинет
		for _, room := range fp.Rooms {
			// Стены кабинета (4 перегородки)
			roomWalls := []domain.Wall{
				{FloorID: floor.ID, X1: room.X1, Y1: room.Y1, X2: room.X2, Y2: room.Y1},
				{FloorID: floor.ID, X1: room.X2, Y1: room.Y1, X2: room.X2, Y2: room.Y2},
				{FloorID: floor.ID, X1: room.X2, Y1: room.Y2, X2: room.X1, Y2: room.Y2},
				{FloorID: floor.ID, X1: room.X1, Y1: room.Y2, X2: room.X1, Y2: room.Y1},
			}
			if err := db.Create(&roomWalls).Error; err != nil {
				return err
			}

			// Подпись кабинета по центру
			label := domain.RoomLabel{
				FloorID: floor.ID,
				Text:    room.Name,
				X:       (room.X1 + room.X2) / 2,
				Y:       room.Y1 + 30,
			}
			if err := db.Create(&label).Error; err != nil {
				return err
			}

			// 4. Расстановка столов строго ВНУТРИ стен кабинета
			stepX := 95
			stepY := 85

			for y := room.Y1 + 75; y <= room.Y2-55; y += stepY {
				for x := room.X1 + 65; x <= room.X2-55; x += stepX {
					code := fmt.Sprintf("%d-%02d", floor.Order, deskNumber)
					deskNumber++

					wp := domain.Workplace{
						FloorID: floor.ID,
						Code:    code,
						Kind:    room.Kind,
						Room:    room.Name,
						X:       x,
						Y:       y,
					}

					// Если комната рабочая и есть сотрудники в пуле — сажаем сотрудника
					if room.Kind == "pc" && empIndex < len(allEmployees) {
						emp := &allEmployees[empIndex]
						wp.Employee = emp.FullName
						//wp.Label = emp.Position

						if err := db.Create(&wp).Error; err != nil {
							return err
						}

						// Привязываем сотрудника к созданному столу
						emp.WorkplaceID = &wp.ID
						db.Model(emp).Update("workplace_id", wp.ID)
						empIndex++
					} else {
						if room.Kind == "server" {
							wp.Label = "Стойка"
						} else if room.Kind == "meeting" {
							wp.Label = "Место переговоров"
						}
						if err := db.Create(&wp).Error; err != nil {
							return err
						}
					}
				}
			}
		}

		// Добавляем принтер в центральный коридор этажа
		printerWP := domain.Workplace{
			FloorID: floor.ID,
			Code:    fmt.Sprintf("%d-PRN", floor.Order),
			Kind:    "printer",
			Label:   "МФУ Kyocera",
			Room:    "Коридор",
			X:       fp.Width / 2,
			Y:       fp.Height / 2,
		}
		db.Create(&printerWP)
	}

	log.Printf("Карты этажей, стены, подписи и рабочие места успешно сгенерированы!")
	return nil
}

func seedAdmin(db *gorm.DB) error {
	var count int64
	db.Model(&domain.User{}).Where("username = ?", "admin").Count(&count)
	if count > 0 {
		return nil
	}
	hash, err := bcrypt.GenerateFromPassword([]byte("admin"), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	admin := domain.User{
		Username:     "admin",
		PasswordHash: string(hash),
		IsAdmin:      true,
	}
	if err := db.Create(&admin).Error; err != nil {
		return err
	}
	return nil
}

func seedTasks(db *gorm.DB) error {
	var count int64
	db.Model(&domain.Task{}).Count(&count)
	if count > 0 {
		return nil
	}
	var workplaces []domain.Workplace
	db.Order("id ASC").Limit(10).Find(&workplaces)

	wpID := func(index int) *uint {
		if index < len(workplaces) {
			return &workplaces[index].ID
		}
		return nil
	}

	tasks := []domain.Task{
		{
			Title:       "Перегрев стойки R2",
			Description: "Температура на входе 34°C, сработал алерт мониторинга.",
			Creator:     "system",
			Assignee:    "2",
			Status:      "in_progress",
			Priority:    "blocker",
			Severity:    "s1",
			WorkplaceID: wpID(0),
		},
		{
			Title:       "Не печатает МФУ",
			Description: "Ошибка «Замятие бумаги», хотя бумаги внутри нет.",
			Creator:     "system",
			Assignee:    "1",
			Status:      "open",
			Priority:    "high",
			Severity:    "s2",
			WorkplaceID: wpID(1),
		},
		{
			Title:       "Нет доступа к 1С",
			Description: "После обновления пароля не пускает в базу.",
			Creator:     "system",
			Assignee:    "1",
			Status:      "open",
			Priority:    "critical",
			Severity:    "s2",
			WorkplaceID: wpID(2),
		},
		{
			Title:       "Мерцает монитор",
			Description: "Периодически гаснет экран при шевелении провода HDMI.",
			Creator:     "system",
			Assignee:    "2",
			Status:      "open",
			Priority:    "normal",
			Severity:    "s3",
			WorkplaceID: wpID(3),
		},
		{
			Title:       "Не работает ВКС в «Казани»",
			Description: "Камера не определяется в Телемосте.",
			Creator:     "system",
			Assignee:    "2",
			Status:      "review",
			Priority:    "high",
			Severity:    "s3",
			WorkplaceID: wpID(4),
		},
		{
			Title:       "Установить второй монитор",
			Description: "Запрос от руководителя для работы с таблицами.",
			Creator:     "system",
			Assignee:    "1",
			Status:      "open",
			Priority:    "low",
			Severity:    "s4",
			WorkplaceID: wpID(5),
		},
		{
			Title:       "Заменить клавиатуру",
			Description: "Залипает клавиша пробел.",
			Creator:     "system",
			Assignee:    "1",
			Status:      "closed",
			Priority:    "low",
			Severity:    "s4",
			WorkplaceID: wpID(6),
		},
	}

	if err := db.Create(&tasks).Error; err != nil {
		return err
	}
	log.Println("Демо-задачи успешно созданы")
	return nil
}
