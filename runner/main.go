package main

import (
	"context" // <--- CHANGE 1: Import context
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"time" // <--- CHANGE 2: Import time
)

type ExecutionRequest struct {
	Language string `json:"language"`
	Code     string `json:"code"`
}

type ExecutionResponse struct {
	Output string `json:"output"`
	Error  string `json:"error,omitempty"`
}

func executeHandler(w http.ResponseWriter, r *http.Request) {
	var req ExecutionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", 400)
		return
	}

	tmpFile, err := os.CreateTemp("", "usercode-*.py")
	if err != nil {
		http.Error(w, "Could not create file", 500)
		return
	}
	defer os.Remove(tmpFile.Name())

	if _, err := tmpFile.WriteString(req.Code); err != nil {
		http.Error(w, "Could not write to file", 500)
		return
	}
	tmpFile.Close()

	// --- CHANGE 3: The Safety Mechanism ---
	
	// Create a "Context" with a 2-second timeout.
	// This creates a timer. If the timer hits 2s, the context "dies".
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel() // Clean up the timer when we are done

	// We use CommandContext instead of Command
	// This attaches the timer to the Docker process.
	cmd := exec.CommandContext(ctx, "docker", "run", "--rm",
		"-v", fmt.Sprintf("%s:/app/script.py", tmpFile.Name()),
		"python:3.9-alpine",
		"python", "/app/script.py",
	)

	output, err := cmd.CombinedOutput()

	// If there was an error, we check IF it was caused by the timeout
	if ctx.Err() == context.DeadlineExceeded {
		fmt.Println("Process timed out!") // Log to server console
		output = []byte("Error: Execution timed out (Limit: 2 seconds)")
	}

	// --------------------------------------

	resp := ExecutionResponse{
		Output: string(output),
	}
	if err != nil && ctx.Err() != context.DeadlineExceeded {
		resp.Error = err.Error()
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func main() {
	http.HandleFunc("/execute", executeHandler)
	fmt.Println("Runner Service starting on :8080...")
	if err := http.ListenAndServe(":8080", nil); err != nil {
		fmt.Println("Server failed:", err)
	}
}