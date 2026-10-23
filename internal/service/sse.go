package service

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"
)

// SSEHub управляет активными соединениями Server-Sent Events и рассылает события клиентам
type SSEHub struct {
	mu         sync.RWMutex
	clients    map[chan []byte]bool
	register   chan chan []byte
	unregister chan chan []byte
	broadcast  chan []byte
}

func NewSSEHub() *SSEHub {
	hub := &SSEHub{
		clients:    make(map[chan []byte]bool),
		register:   make(chan chan []byte),
		unregister: make(chan chan []byte),
		broadcast:  make(chan []byte, 100),
	}
	go hub.run()
	return hub
}

func (h *SSEHub) run() {
	ticker := time.NewTicker(25 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case ch := <-h.register:
			h.mu.Lock()
			h.clients[ch] = true
			h.mu.Unlock()

		case ch := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[ch]; ok {
				delete(h.clients, ch)
				close(ch)
			}
			h.mu.Unlock()

		case msg := <-h.broadcast:
			h.mu.RLock()
			for ch := range h.clients {
				select {
				case ch <- msg:
				default:
					// Клиент медленный или отключился
				}
			}
			h.mu.RUnlock()

		case <-ticker.C:
			// Отправляем keep-alive комментарий для предотвращения обрыва соединения прокси/браузером
			pingMsg := []byte(": keep-alive\n\n")
			h.mu.RLock()
			for ch := range h.clients {
				select {
				case ch <- pingMsg:
				default:
				}
			}
			h.mu.RUnlock()
		}
	}
}

// Broadcast рассылает событие всем подключенным клиентам
func (h *SSEHub) Broadcast(eventType string, data any) {
	bytes, err := json.Marshal(data)
	if err != nil {
		log.Printf("[sse] Ошибка сериализации данных события %s: %v", eventType, err)
		return
	}
	formatted := fmt.Sprintf("event: %s\ndata: %s\n\n", eventType, string(bytes))
	h.broadcast <- []byte(formatted)
}

// ServeHTTP обрабатывает входящее SSE-подключение клиента
func (h *SSEHub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Потоковая передача не поддерживается", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	msgChan := make(chan []byte, 32)
	h.register <- msgChan

	// Отправляем первичное событие подтверждения подключения
	fmt.Fprintf(w, "event: connected\ndata: {\"status\":\"ok\"}\n\n")
	flusher.Flush()

	notify := r.Context().Done()
	go func() {
		<-notify
		h.unregister <- msgChan
	}()

	for msg := range msgChan {
		_, err := w.Write(msg)
		if err != nil {
			break
		}
		flusher.Flush()
	}
}
